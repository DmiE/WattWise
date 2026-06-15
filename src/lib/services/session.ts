import type { createClient } from "@/lib/supabase";
import type { SessionStatusUpdate } from "@/types";

// Thin session-status data-access layer, mirroring `plan.ts`/`profile.ts`: the
// caller's SSR client is injected so the `set_session_status` RPC runs under
// their Supabase RLS session — never a service-role client. The RPC does the
// atomic update→upsert/delete (see the migration); this wrapper only maps the
// DTO to its args and the not-found raise to a 404 signal.

type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;

// SQLSTATE raised by the RPC when the status update matches 0 rows — i.e. the
// session doesn't exist or RLS hid it because the caller doesn't own it. We map
// it to `notFound` so the route can answer 404 instead of a generic 500.
const PG_NOT_FOUND = "P0002";

export type SetSessionStatusResult = { ok: true } | { error: string; notFound?: boolean };

/** Apply a status transition (and, on `done`, the log) to one session atomically. */
export async function setSessionStatus(
  supabase: SupabaseClient,
  sessionId: string,
  input: SessionStatusUpdate,
): Promise<SetSessionStatusResult> {
  const log = input.status === "done" ? input.log : null;
  const { error } = await supabase.rpc("set_session_status", {
    p_session_id: sessionId,
    p_status: input.status,
    p_actual_duration_min: log?.actual_duration_min ?? undefined,
    p_rating: log?.rating ?? undefined,
    p_km_ridden: log?.km_ridden ?? undefined,
  });
  if (error) {
    if (error.code === PG_NOT_FOUND) {
      return { error: error.message, notFound: true };
    }
    return { error: error.message };
  }
  return { ok: true };
}
