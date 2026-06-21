import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { getProfile } from "@/lib/services/profile";
import { getActivePlan, persistPlan } from "@/lib/services/plan";
import { generateStructured, OpenRouterError } from "@/lib/services/openrouter";
import { PLAN_JSON_SCHEMA } from "@/lib/plan-schema";
import { buildPlanMessages, nextMonday, toPlanInsert, toSessionInserts, validateGeneratedPlan } from "@/lib/plan";
import { json, MAX_GENERATION_ATTEMPTS, GENERATION_BUDGET_MS } from "@/lib/services/generation";

export const prerender = false;

/**
 * POST /api/plans/generate — idempotent first-plan generation.
 *
 * Flow: auth gate → if an active plan exists, return it (no LLM call) → else
 * load the profile, generate via OpenRouter, validate, and on success persist
 * parent-first under RLS. A `persistPlan` 23505 race re-queries and returns the
 * existing plan. On exhausted retries or transport failure, return a generic
 * error (no provider/constraint leakage).
 */
export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return json({ error: "Not authenticated" }, 401);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "Service unavailable" }, 500);
  }

  // Idempotency: a user only ever has one active plan (S-02 does not regenerate).
  let existing;
  try {
    existing = await getActivePlan(supabase, user.id);
  } catch {
    return json({ error: "Could not load your plan. Please try again." }, 500);
  }
  if (existing) {
    return json({ plan: existing }, 200);
  }

  // Need the profile to build the prompt and snapshot the *_at_generation columns.
  let profile;
  try {
    profile = await getProfile(supabase, user.id);
  } catch {
    return json({ error: "Could not load your profile. Please try again." }, 500);
  }
  if (!profile) {
    // No profile → onboarding hasn't completed; nothing to generate from.
    return json({ error: "Profile not found. Please complete onboarding first." }, 409);
  }

  const { system, user: userMessage } = buildPlanMessages(profile);

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

    const validation = validateGeneratedPlan(result.content, profile);
    if (!validation.ok) {
      // Semantic failure (bad equipment unit / unavailable day / over cap / …) —
      // retryable, never coerced or persisted.
      continue;
    }

    const planInsert = toPlanInsert(profile, startDate, { model: result.model, usage: result.usage });
    const persisted = await persistPlan(supabase, planInsert, (planId) =>
      toSessionInserts(planId, validation.plan, startDate),
    );
    if ("error" in persisted) {
      return json({ error: "Could not save your plan. Please try again." }, 500);
    }
    return json({ plan: persisted.plan }, 200);
  }

  // Every attempt either failed transport or produced an invalid plan.
  return json({ error: "We couldn't generate a valid plan right now. Please try again." }, 502);
};
