import type { createClient } from "@/lib/supabase";
import type {
  Plan,
  PlanInsert,
  PlanSessionInsert,
  PlanSessionView,
  PlanSessionWithLog,
  PlanWithSessions,
} from "@/types";

export type { PlanWithSessions };

// Thin plan data-access layer, mirroring `profile.ts`: the caller's SSR client
// is injected as the first arg so every query runs under their Supabase RLS
// session — never a service-role client. RLS on `plan_sessions` walks up via
// EXISTS to `plans.user_id = auth.uid()`, so the parent `plans` row MUST be
// inserted before its sessions (see `persistPlan`).

type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;

// Postgres unique-violation SQLSTATE. The partial unique index
// `one_active_plan_per_user on (user_id) where status='active'` raises this when
// a second active plan is inserted for the same user — which we treat as an
// idempotent win, not an error (see `persistPlan`).
const PG_UNIQUE_VIOLATION = "23505";

/** The caller's current active plan, or null when they have none. */
export async function getActivePlan(supabase: SupabaseClient, userId: string): Promise<Plan | null> {
  const { data, error } = await supabase
    .from("plans")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (error) {
    throw new Error(`getActivePlan failed: ${error.message}`);
  }
  return data ?? null;
}

/**
 * Pure predicate: has `plan` expired relative to the calendar day `todayIso`?
 *
 * `todayIso` is a `YYYY-MM-DD` string; callers pass the server UTC date via
 * `new Date().toISOString().slice(0, 10)`. A plan is expired once its last day
 * (`end_date`) is strictly before today. Lexicographic string comparison is
 * correct for zero-padded ISO dates. Used by both the middleware renewal gate
 * and the renew route's eligibility guard.
 */
export function isPlanExpired(plan: Plan, todayIso: string): boolean {
  return plan.end_date < todayIso;
}

/** A plan with its sessions ordered by day_index, or null when the plan is absent. */
export async function getPlanWithSessions(supabase: SupabaseClient, planId: string): Promise<PlanWithSessions | null> {
  const { data: plan, error: planError } = await supabase.from("plans").select("*").eq("id", planId).maybeSingle();
  if (planError) {
    throw new Error(`getPlanWithSessions (plan) failed: ${planError.message}`);
  }
  if (!plan) {
    return null;
  }

  // Embed each session's log so a `done` session can render its logged values
  // on server load. `session_logs.plan_session_id` is both the FK and the PK
  // (unique), so PostgREST detects a to-one relationship and returns the embed
  // as a single object or null — NOT an array; normalize directly, never `[0]`.
  const { data: sessions, error: sessionsError } = await supabase
    .from("plan_sessions")
    .select("*, session_logs(*)")
    .eq("plan_id", planId)
    .order("day_index", { ascending: true });
  if (sessionsError) {
    throw new Error(`getPlanWithSessions (sessions) failed: ${sessionsError.message}`);
  }

  // `structure` is `Json` at the DB layer; every persisted session passed
  // `validateGeneratedPlan`, so narrowing to the segment union here is sound.
  // The `session_logs` embed is a to-one (isOneToOne) so PostgREST returns it
  // as a single object — and `null` at runtime for an unlogged session, which
  // the `PlanSessionWithLog.log` type (`SessionLog | null`) reflects.
  const withLogs: PlanSessionWithLog[] = sessions.map(({ session_logs, ...session }) => ({
    ...(session as PlanSessionView),
    log: session_logs,
  }));
  return { plan, sessions: withLogs };
}

/**
 * Every `done` session belonging to the caller, across ALL their plans
 * (current and past), newest first — with each session's log embedded.
 *
 * No `user_id`/`plan_id` filter is needed or wanted: RLS on `plan_sessions`
 * walks up via EXISTS to `plans.user_id = auth.uid()`, so omitting any plan
 * filter returns exactly the caller's own sessions across every plan they own.
 *
 * Ordered by `scheduled_date` desc, then `day_index` desc as a deterministic
 * tiebreaker — two plans (e.g. after a renewal) can share a `scheduled_date`,
 * and without the secondary key same-date rows reshuffle between loads.
 *
 * The `session_logs` embed is a to-one (FK is also the PK), so PostgREST
 * returns it as a single object or null — normalize directly, never `[0]`.
 * A `done` session always has a log (the `set_session_status` RPC upserts one),
 * so `log` is non-null in practice for these rows.
 */
export async function getCompletedSessions(supabase: SupabaseClient): Promise<PlanSessionWithLog[]> {
  const { data: sessions, error } = await supabase
    .from("plan_sessions")
    .select("*, session_logs(*)")
    .eq("status", "done")
    .order("scheduled_date", { ascending: false })
    .order("day_index", { ascending: false });
  if (error) {
    throw new Error(`getCompletedSessions failed: ${error.message}`);
  }

  return sessions.map(({ session_logs, ...session }) => ({
    ...(session as PlanSessionView),
    log: session_logs,
  }));
}

export type PersistPlanResult = { plan: Plan } | { error: string };

/**
 * Parent-first persist under RLS, in three crash-safe phases:
 *
 *   1. Insert the `plans` row as `status='pending'` — invisible to both
 *      `getActivePlan` and the `one_active_plan_per_user` partial index.
 *   2. Insert its sessions from the new plan id; on failure delete the pending
 *      parent (FK cascade clears partial sessions). Nothing became active.
 *   3. Flip the row to `status='active'` as the last step. Because every prior
 *      failure (including a crash between phases) leaves a non-active row, a
 *      sessionless active plan can never be served (see plan.md F1).
 *
 * The `one_active_plan_per_user` unique index is enforced at phase 3, so a
 * caller that lost the race hits 23505 there: an idempotent win, not an error —
 * we drop our pending plan, re-query, and return the winner's active plan,
 * closing the TOCTOU window between the route's `getActivePlan` read and this
 * write.
 */
export async function persistPlan(
  supabase: SupabaseClient,
  planInsert: PlanInsert,
  sessionInsertsFactory: (planId: string) => PlanSessionInsert[],
  opts?: { supersede?: boolean },
): Promise<PersistPlanResult> {
  // Phase 1: insert the parent as 'pending' so it is invisible to both
  // getActivePlan (status='active' only) and the one_active_plan_per_user
  // partial index until its sessions have landed. This makes the whole persist
  // crash-safe: a failure at any point below leaves a non-active row that is
  // never served and never blocks regeneration.
  const { data: plan, error: planError } = await supabase
    .from("plans")
    .insert({ ...planInsert, status: "pending" })
    .select()
    .single();
  if (planError) {
    return { error: `plan insert failed: ${planError.message}` };
  }

  // Phase 2: insert sessions; on failure drop the pending parent (FK cascade
  // clears any partial sessions) — nothing ever became active.
  const sessionInserts = sessionInsertsFactory(plan.id);
  const { error: sessionsError } = await supabase.from("plan_sessions").insert(sessionInserts);
  if (sessionsError) {
    await supabase.from("plans").delete().eq("id", plan.id);
    return { error: `session insert failed: ${sessionsError.message}` };
  }

  // Phase 3 (renewal / supersede mode): retire the caller's current active plan
  // and activate this pending one in a single transaction via the RPC. Because
  // the swap is atomic and ordered (old→superseded before new→active), it never
  // trips one_active_plan_per_user, so the 23505 idempotent-win branch below is
  // intentionally NOT used here. On RPC error, drop the pending row (mirroring
  // the activation-failure cleanup) and surface the error.
  if (opts?.supersede) {
    const { data: superseded, error: supersedeError } = await supabase
      .rpc("supersede_and_activate_plan", { p_new_plan_id: plan.id })
      .single();
    if (supersedeError) {
      await supabase.from("plans").delete().eq("id", plan.id);
      return { error: `plan supersede failed: ${supersedeError.message}` };
    }
    return { plan: superseded };
  }

  // Phase 3 (first-plan mode): activate as the last step. The
  // one_active_plan_per_user index is enforced here, so a caller that lost the
  // race hits 23505 — drop our pending plan and return the winner's active plan
  // (idempotent win), closing the TOCTOU window between the route's
  // getActivePlan read and this write.
  const { data: active, error: activateError } = await supabase
    .from("plans")
    .update({ status: "active" })
    .eq("id", plan.id)
    .select()
    .single();
  if (activateError) {
    await supabase.from("plans").delete().eq("id", plan.id);
    if (activateError.code === PG_UNIQUE_VIOLATION) {
      const existing = await getActivePlan(supabase, planInsert.user_id);
      if (existing) {
        return { plan: existing };
      }
    }
    return { error: `plan activation failed: ${activateError.message}` };
  }

  return { plan: active };
}
