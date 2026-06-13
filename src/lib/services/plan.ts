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

  // Phase 3: activate as the last step. The one_active_plan_per_user index is
  // enforced here, so a caller that lost the race hits 23505 — drop our pending
  // plan and return the winner's active plan (idempotent win), closing the
  // TOCTOU window between the route's getActivePlan read and this write.
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
