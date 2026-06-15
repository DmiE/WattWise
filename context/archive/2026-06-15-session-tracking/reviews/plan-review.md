<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Session Tracking (done / skipped + log)

- **Plan**: context/changes/session-tracking/plan.md
- **Mode**: Deep
- **Date**: 2026-06-15
- **Verdict**: SOUND (fix F1 during implementation)
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | PASS |

## Grounding

10/10 paths ✓, symbols ✓, brief↔plan ✓, Progress↔Phase ✓.

RPC RLS linchpin verified: `plan_sessions_update_own` (init_mvp_schema.sql:196, owner USING + WITH CHECK) and all four `session_logs` policies (select/insert/update/delete for `authenticated`) exist, so the SECURITY INVOKER RPC's update→upsert/delete chain runs correctly under the caller's RLS and a 0-row update on a non-owned/missing session is the right 404 signal. CHECK ranges match the zod contract exactly (`actual_duration_min` 1–600, `rating` 1–5, `km_ridden` >0 and <500). PRD confirms bike-field removed (FR-008) and skip-as-UX-copy (Open Question #1). Route/service patterns match `onboarding.ts` / `generate.ts` / `plan.ts`. Blast radius of the `PlanWithSessions.sessions` type change is confined to `PlanView.tsx` + `dashboard.astro`, both touched/transparent. No existing `.rpc()` usage — this is the first, but it follows the migration house style.

## Findings

### F1 — Embedded log is an object, not an array

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1, item 5 — Extend plan read to embed logs
- **Detail**: The plan says to "normalize the embedded array to a single `log: SessionLog | null`" from `select("*, session_logs(*)")`. But `session_logs.plan_session_id` is both the FK and the PRIMARY KEY (init_mvp_schema.sql:227) — i.e. unique. PostgREST detects a unique FK as a to-one relationship and returns the embed as a single object or null, NOT a single-element array. If the implementer follows the wording literally and writes `row.session_logs[0] ?? null`, indexing an object yields `undefined` → log is always null → done sessions silently render no logged values. Manual check 3.3 would eventually catch it, but only after the UI is built. The brief (line 54) already flags this as an unverified assumption — it should be resolved in the plan, not left to discovery.
- **Fix**: Change the contract to treat the embed as object-or-null (`log: row.session_logs ?? null`), and have the implementer confirm the actual shape against generated types after `npm run db:types` (the regenerated embed type states object-vs-array authoritatively). Drop the word "array".
- **Decision**: FIXED — Phase 1 item 5 contract rewritten to to-one (object-or-null), `[0]` indexing removed, type-verification note added.

### F2 — numeric(5,2) rounding can defeat the zod range guard

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1, item 3 — Session input schema (km_ridden)
- **Detail**: `km_ridden` is `numeric(5,2)` with CHECK `> 0 and < 500`. The zod contract mirrors the CHECK as positive `< 500`. But a value like 499.999 passes zod yet rounds to 500.00 at the column → CHECK violation → the RPC raises a non-P0002 error → the route returns a generic 500 instead of a clean 400. Same at the low edge (0.004 → 0.00). Vanishingly rare via the UI's km input, but it's a zod/DB mismatch.
- **Fix**: Round/clamp km to 2 decimals in the schema (e.g. `.multipleOf(0.01)` or a transform) so the zod boundary matches what the column will actually store.
- **Decision**: FIXED — Phase 1 item 3 contract now rounds `km_ridden` to 2 decimals before the `> 0 && < 500` refine.
