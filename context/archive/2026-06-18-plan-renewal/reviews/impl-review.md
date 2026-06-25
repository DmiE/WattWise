<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Plan Renewal (S-05)

- **Plan**: context/changes/plan-renewal/plan.md
- **Scope**: All 5 phases (full plan)
- **Date**: 2026-06-25
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

All 12 planned changes implemented as specified (MATCH) — no DRIFT, no MISSING. The two
riskiest areas verified clean: the atomic supersede RPC (correct superseded-before-active
ordering, single plpgsql transaction, respects the non-deferrable `one_active_plan_per_user`
partial index — cannot leave 0 or 2 active plans) and the FTP/equipment trust boundary
(enforced server-side in depth across schema → route → derivation; client cannot inject
`ftp_source`/`fitness_level`/`equipment_type`). `npm run lint` ✅, `npm run build` ✅.

## Findings

### F1 — Shared generation JSON schema changed (unplanned, touches first-plan path)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/lib/plan-schema.ts:96-176 (committed in p3, d224f4d)
- **Detail**: `minimum`/`maximum` keywords were stripped from every `integer` field in the shared `PLAN_JSON_SCHEMA` (used by BOTH the renew path and the first-plan generate path). The plan's guardrail said "Not changing the first-plan path." Justified — the Anthropic provider 400s strict integer schemas with min/max; ranges moved to field `description`s and hard bounds remain enforced by the zod `planSchema` trust boundary. Necessary for renewal generation (shared pipeline) to work at all. Code is correct; the change silently widened the diff beyond the plan.
- **Fix**: Add an addendum to plan.md recording the plan-schema.ts min/max removal as a discovered-scope shared-pipeline fix. No code change needed.
- **Decision**: FIXED — added `## Addenda` section to plan.md documenting the shared-schema fix.

### F2 — Profile update commits before plan persist (documented divergence window)

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (Data safety)
- **Location**: src/pages/api/plans/renew.ts:134-148
- **Detail**: `updateProfileForRenewal` commits before `persistPlan`. If the supersede RPC then fails, the user has new profile values but the old stale plan stays active until retry. This is the ordering the plan deliberately chose and documented (plan.md:49) — recoverable, retry-safe (eligibility guard still passes), and reversing it would be worse (409 lock-out, stale FTP unfixable). Faithfully implemented as planned.
- **Fix**: None required — accepted tradeoff, correctly implemented. Airtight alternative (out of scope): fold the profile UPDATE into the supersede RPC so profile+supersede+activate share one transaction.
- **Decision**: SKIPPED (accepted tradeoff, implemented as planned)

### F3 — Middleware adds a getActivePlan read on every protected request

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Performance
- **Location**: src/middleware.ts:46
- **Detail**: The renewal gate adds a sequential `getActivePlan` read after the existing `getProfile` read on every onboarded-user protected request (same row re-read in renewal.astro and renew.ts — up to 3 reads per renewal navigation). Explicitly anticipated and accepted in the plan (Performance Considerations, plan.md:316) as MVP-acceptable and a later optimization candidate.
- **Fix**: None now — documented MVP tradeoff. Candidate for later: combine the two reads or short-circuit the plan read on non-gating routes.
- **Decision**: SKIPPED (documented MVP tradeoff, implemented as planned)

## Notes

- Phase 4 was reviewed separately (reviews/impl-review-phase-4.md); its observations (duplicated presentational helpers; `window.location.assign` vs `.href`) were already triaged there as benign/convention-matching and are not repeated.
- Both review sub-agents independently confirmed: all planned items MATCH, no MISSING/DRIFT, no CRITICAL safety issues. The atomic supersede correctness and FTP trust boundary — the two highest-risk areas — are sound.
