import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { getProfile, updateProfileForRenewal } from "@/lib/services/profile";
import { getActivePlan, isPlanExpired, persistPlan } from "@/lib/services/plan";
import { generateStructured, OpenRouterError } from "@/lib/services/openrouter";
import { PLAN_JSON_SCHEMA } from "@/lib/plan-schema";
import { buildPlanMessages, nextMonday, toPlanInsert, toSessionInserts, validateGeneratedPlan } from "@/lib/plan";
import { json, MAX_GENERATION_ATTEMPTS, GENERATION_BUDGET_MS } from "@/lib/services/generation";
import { renewalInputSchema } from "@/lib/renewal-schema";
import { applyRenewal } from "@/lib/renewal";

export const prerender = false;

/**
 * POST /api/plans/renew — synchronous plan renewal.
 *
 * Flow: auth gate → validate the check-in → load profile → eligibility guard
 * (an active plan must exist AND be expired) → power-meter FTP guard → derive
 * the merged profile → regenerate via OpenRouter (same budget/retry caps as
 * generate.ts) → on a valid plan, persist the profile update THEN the new plan
 * with atomic supersede.
 *
 * Generation-before-mutation ordering is deliberate (see plan.md Critical
 * Implementation Details): a generation failure writes nothing, leaving the old
 * plan active and the profile untouched. A persist failure after the profile
 * update leaves the old plan active+expired, so the eligibility guard still
 * passes and a retry regenerates from the same merged profile.
 */
export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return json({ error: "Not authenticated" }, 401);
  }

  let raw: unknown;
  try {
    raw = await context.request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const result = renewalInputSchema.safeParse(raw);
  if (!result.success) {
    const { fieldErrors } = z.flattenError(result.error);
    return json({ error: "Validation failed", fieldErrors }, 400);
  }
  const input = result.data;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "Service unavailable" }, 500);
  }

  // Need the profile for equipment gating, prompt building, and the snapshot.
  let profile;
  try {
    profile = await getProfile(supabase, user.id);
  } catch {
    return json({ error: "Could not load your profile. Please try again." }, 500);
  }
  if (!profile) {
    return json({ error: "Profile not found. Please complete onboarding first." }, 409);
  }

  // Eligibility guard: renewal only applies to an existing, expired active plan.
  const todayIso = new Date().toISOString().slice(0, 10);
  let active;
  try {
    active = await getActivePlan(supabase, user.id);
  } catch {
    return json({ error: "Could not load your plan. Please try again." }, 500);
  }
  if (!active) {
    return json({ error: "You have no plan to renew." }, 409);
  }
  if (!isPlanExpired(active, todayIso)) {
    return json({ error: "Your plan hasn't expired yet." }, 409);
  }

  // FTP trust boundary: equipment_type comes from the stored profile, and FTP is
  // required only for power-meter users (the schema keeps it optional).
  if (profile.equipment_type === "power_meter" && input.ftp_watts == null) {
    return json(
      { error: "Validation failed", fieldErrors: { ftp_watts: ["FTP is required for power-meter users."] } },
      400,
    );
  }

  const { mergedProfile, update } = applyRenewal(profile, input);

  const { system, user: userMessage } = buildPlanMessages(mergedProfile);

  // day_index 1 is anchored to the next Monday so the prompt's fixed mon–sun
  // frame and the validator agree (see plan.ts `nextMonday`).
  const startDate = nextMonday(new Date());

  const deadline = Date.now() + GENERATION_BUDGET_MS;

  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
    // Stop before starting another attempt once the shared budget is spent.
    if (Date.now() >= deadline) {
      break;
    }

    let result;
    try {
      result = await generateStructured({
        system,
        user: userMessage,
        jsonSchema: PLAN_JSON_SCHEMA,
        schemaName: "training_plan",
        deadline,
      });
    } catch (err) {
      if (err instanceof OpenRouterError && err.code === "missing_api_key") {
        // Misconfiguration, not transient — fail fast with a generic message.
        return json({ error: "Plan generation is unavailable. Please try again later." }, 500);
      }
      // Transport failure after the client's own retries — try once more if we can.
      continue;
    }

    const validation = validateGeneratedPlan(result.content, mergedProfile);
    if (!validation.ok) {
      // Semantic failure (bad equipment unit / unavailable day / over cap / …) —
      // retryable, never coerced or persisted.
      continue;
    }

    // Generation succeeded: now mutate. Profile update first, then the new plan
    // with atomic supersede. Both failures leave the old plan active (recoverable
    // — eligibility guard still passes on retry).
    const { error: profileError } = await updateProfileForRenewal(supabase, user.id, update);
    if (profileError) {
      return json({ error: "Could not save your profile. Please try again." }, 500);
    }

    const planInsert = toPlanInsert(mergedProfile, startDate, { model: result.model, usage: result.usage });
    const persisted = await persistPlan(
      supabase,
      planInsert,
      (planId) => toSessionInserts(planId, validation.plan, startDate),
      { supersede: true },
    );
    if ("error" in persisted) {
      return json({ error: "Could not save your plan. Please try again." }, 500);
    }
    return json({ plan: persisted.plan }, 200);
  }

  // Every attempt either failed transport or produced an invalid plan.
  return json({ error: "We couldn't generate a valid plan right now. Please try again." }, 502);
};
