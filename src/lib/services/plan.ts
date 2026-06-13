import type { createClient } from "@/lib/supabase";
import type { Plan, PlanInsert, PlanSessionInsert, PlanSessionView, PlanWithSessions } from "@/types";

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

/** A plan with its sessions ordered by day_index, or null when the plan is absent. */
export async function getPlanWithSessions(supabase: SupabaseClient, planId: string): Promise<PlanWithSessions | null> {
  const { data: plan, error: planError } = await supabase.from("plans").select("*").eq("id", planId).maybeSingle();
  if (planError) {
    throw new Error(`getPlanWithSessions (plan) failed: ${planError.message}`);
  }
  if (!plan) {
    return null;
  }

  const { data: sessions, error: sessionsError } = await supabase
    .from("plan_sessions")
    .select("*")
    .eq("plan_id", planId)
    .order("day_index", { ascending: true });
  if (sessionsError) {
    throw new Error(`getPlanWithSessions (sessions) failed: ${sessionsError.message}`);
  }

  // `structure` is `Json` at the DB layer; every persisted session passed
  // `validateGeneratedPlan`, so narrowing to the segment union here is sound.
  return { plan, sessions: sessions as PlanSessionView[] };
}

export type PersistPlanResult = { plan: Plan } | { error: string };

/**
 * Parent-first persist under RLS: insert the `plans` row, then build and insert
 * its sessions from the new plan id. Two correctness guards:
 *
 *   - If session insertion fails after the plan row lands, delete the orphan
 *     plan so the idempotent `getActivePlan` check never returns a sessionless
 *     active plan (see plan.md "Critical Implementation Details").
 *   - A `plans`-insert unique violation (23505 on `one_active_plan_per_user`)
 *     means another request won the race to create the active plan. That's an
 *     idempotent win, not an error: re-query and return the existing plan so a
 *     lost-the-race caller still gets the plan, closing the TOCTOU window
 *     between the route's `getActivePlan` read and this insert.
 */
export async function persistPlan(
  supabase: SupabaseClient,
  planInsert: PlanInsert,
  sessionInsertsFactory: (planId: string) => PlanSessionInsert[],
): Promise<PersistPlanResult> {
  const { data: plan, error: planError } = await supabase.from("plans").insert(planInsert).select().single();

  if (planError) {
    if (planError.code === PG_UNIQUE_VIOLATION) {
      // Lost the race — another request already created the active plan.
      const existing = await getActivePlan(supabase, planInsert.user_id);
      if (existing) {
        return { plan: existing };
      }
    }
    return { error: `plan insert failed: ${planError.message}` };
  }

  const sessionInserts = sessionInsertsFactory(plan.id);
  const { error: sessionsError } = await supabase.from("plan_sessions").insert(sessionInserts);
  if (sessionsError) {
    // Roll back the orphan parent so no sessionless active plan survives.
    await supabase.from("plans").delete().eq("id", plan.id);
    return { error: `session insert failed: ${sessionsError.message}` };
  }

  return { plan };
}
