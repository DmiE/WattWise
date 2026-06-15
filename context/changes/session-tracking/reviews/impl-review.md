<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Session Tracking (done / skipped + log)

- **Plan**: context/changes/session-tracking/plan.md
- **Scope**: All 3 phases (full plan)
- **Date**: 2026-06-15
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Every planned change is implemented and matches intent — no drift, no skipped items, no scope creep. `npm run lint` and `npm run build` both pass. Manual criteria checked off in plan.md with commit shas (7eeed09, b8bad27, 4e8cec4).

## Findings

### F1 — Optimistic rollback can restore unconfirmed state

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/components/plan/PlanView.tsx:126-150
- **Detail**: `setStatus` captures `snapshot` from the current `sessions` value and lists `[sessions, mutate]` as deps. If a second mutation on the same session fired before the first resolved, the second snapshot would already hold the first's optimistic (unconfirmed) state, so a rollback could restore a wrong value rather than true server state. Mitigated in practice: every action button carries `disabled={pending}` (lines 375, 386, 397, 466, 476, 497, 507) and `pending` stays true for the whole in-flight window (useSessionStatus.ts:18-38), blocking concurrent clicks on one session today.
- **Fix**: Capture the snapshot inside the functional updater — `setSessions((prev) => { snapshot = prev.find(...); ... })` — so rollback always references the latest committed state, and drop `sessions` from the dep array.
  - Strength: Removes the race structurally instead of relying on the pending-gate invariant holding forever; survives future changes that might enable concurrent mutations.
  - Tradeoff: Minor refactor of the handler; behavior is identical today.
  - Confidence: HIGH — standard React optimistic-update pattern.
  - Blind spot: None significant.
- **Decision**: FIXED — snapshot now captured inside the setSessions updater; `sessions` dropped from deps (PlanView.tsx:126-152). Lint + build pass.

### F2 — Reset/skip silently deletes a prior "done" log

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Data safety)
- **Location**: supabase/migrations/20260615210417_add_set_session_status_rpc.sql:44
- **Detail**: Any non-`done` transition unconditionally deletes the session_log. Intended (plan specifies skip/reset clears the log) and matches the "Reset to planned" UI affordance, but it is irreversible loss of a previously logged duration/rating/km. Consistent with plan and PRD; awareness only.
- **Fix**: None — intended behavior. Note for S-06 (history) if logged values should ever survive a reset.
- **Decision**: ACCEPTED — intended behavior; no change.

### F3 — "done" with null log args would surface as a generic 500

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: supabase/migrations/20260615210417_add_set_session_status_rpc.sql:35-42
- **Detail**: session_logs.{actual_duration_min,rating,km_ridden} are NOT NULL. A `done` call with null log args would hit a NOT NULL violation → generic 500. Cannot happen via the API route: the discriminated union (session-schema.ts) requires `log` on `done`, and the service only forwards log values on `done`. The DB is correctly the last line of defense.
- **Fix**: None — defense-in-depth already correct.
- **Decision**: ACCEPTED — intended behavior; no change.
