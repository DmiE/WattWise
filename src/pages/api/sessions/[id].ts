import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { sessionStatusUpdateSchema } from "@/lib/session-schema";
import { setSessionStatus } from "@/lib/services/session";

export const prerender = false;

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/**
 * POST /api/sessions/[id] — mark one session done/skipped/pending.
 *
 * Flow (mirrors `onboarding.ts`): auth gate → reject a non-UUID id → validate
 * the body (log required + range-checked only on `done`) → call the RLS-scoped
 * service. The service maps the RPC's 0-row raise (P0002) to `notFound`, which
 * becomes a 404 here so a caller can never tell "doesn't exist" from "not
 * yours". No payload is returned — the client already holds optimistic state.
 */
export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return json({ error: "Not authenticated" }, 401);
  }

  const id = context.params.id;
  if (!id || !z.uuid().safeParse(id).success) {
    return json({ error: "Invalid session id" }, 400);
  }

  let raw: unknown;
  try {
    raw = await context.request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const result = sessionStatusUpdateSchema.safeParse(raw);
  if (!result.success) {
    const { fieldErrors } = z.flattenError(result.error);
    return json({ error: "Validation failed", fieldErrors }, 400);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "Service unavailable" }, 500);
  }

  const outcome = await setSessionStatus(supabase, id, result.data);
  if ("error" in outcome) {
    if (outcome.notFound) {
      return json({ error: "Session not found" }, 404);
    }
    // Generic message — don't leak constraint/provider details to the client.
    return json({ error: "Could not update the session. Please try again." }, 500);
  }

  return json({ ok: true }, 200);
};
