import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { onboardingInputSchema } from "@/lib/onboarding-schema";
import { toProfileInsert } from "@/lib/onboarding";
import { getProfile, upsertProfile } from "@/lib/services/profile";

export const prerender = false;

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return json({ error: "Not authenticated" }, 401);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "Service unavailable" }, 500);
  }

  // Onboarding is once per account. Without this guard the route is a full-row
  // upsert reachable by anyone holding a session, so an already-onboarded
  // cyclist could rewrite the columns `profileEditSchema` deliberately withholds
  // — equipment_type, the FTP trio, max_hr — which the other two write paths
  // treat as a trust boundary (`renewal.ts:10`, `services/profile.ts:35-39`).
  // The damage is not a duplicate write: changing `equipment_type` while a plan
  // is active desyncs it from the frozen `equipment_at_generation` snapshot the
  // legend renders from, while the segment targets keep the kind they were
  // generated with — Risk #3 reached through the write path. Later profile
  // changes belong to PATCH /api/profile (the six FR-010 fields) or to renewal
  // (the FTP trio). The middleware does not cover this: its keep-out-of-
  // onboarding redirect keys on `pathname.startsWith("/onboarding")`
  // (`middleware.ts:28`) and PROTECTED_ROUTES never matches `/api/onboarding`.
  //
  // Fails closed — a profile we cannot read refuses the write rather than
  // allowing an overwrite. See test-plan §7 (B3).
  try {
    if ((await getProfile(supabase, user.id)) !== null) {
      return json({ error: "You have already completed onboarding." }, 409);
    }
  } catch {
    return json({ error: "Could not verify your profile. Please try again." }, 500);
  }

  let raw: unknown;
  try {
    raw = await context.request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const result = onboardingInputSchema.safeParse(raw);
  if (!result.success) {
    const { fieldErrors } = z.flattenError(result.error);
    return json({ error: "Validation failed", fieldErrors }, 400);
  }

  // Derive authoritative FTP / ftp_source / fitness_level / max_hr server-side
  // so a tampered body can never violate the profiles CHECK constraints.
  const insert = toProfileInsert(result.data, user.id);
  const { error } = await upsertProfile(supabase, insert);
  if (error) {
    // Generic message — don't leak constraint names to the client.
    return json({ error: "Could not save your profile. Please try again." }, 500);
  }

  return json({ ok: true }, 200);
};
