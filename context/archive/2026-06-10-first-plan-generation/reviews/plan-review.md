<!-- PLAN-REVIEW-REPORT -->
# Plan Review: First Plan Generation (S-02)

- **Plan**: context/changes/first-plan-generation/plan.md
- **Mode**: Deep
- **Date**: 2026-06-12
- **Verdict**: REVISE → SOUND (after triage: F1/F3/F4 fixed, F2 skipped)
- **Findings**: 1 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | FAIL → PASS (F1 fixed) |
| Lean Execution | WARNING → PASS (F4 fixed) |
| Architectural Fitness | PASS |
| Blind Spots | WARNING (F3 fixed; F2 skipped) |
| Plan Completeness | PASS |

## Grounding

11/11 paths ✓ (all referenced source/config/migration files exist; `src/pages/api/plans/` correctly absent), symbols ✓ (`getProfile`, `toProfileInsert`, `envField`), `ui/progress.tsx` + `components/hooks/` exist (validates the plan's `Progress` reference and hook convention), Progress section well-formed (5/5 phases match, every success-criterion bullet has an `N.M` entry — parses for `/10x-implement`), brief↔plan consistent. Schema nuance verified: `scheduled_date` has no DB CHECK tying it to `start_date + day_index - 1` (app-enforced only) — the plan handles this correctly in `toSessionInserts`, not a defect.

## Findings

### F1 — Prompt never tells the model which weekday day_index 1 is, but availability validation is weekday-relative

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: End-State Alignment
- **Location**: Phase 2 (#2 validator, #3 buildPlanMessages); Critical Implementation Details → "Availability mapping"
- **Detail**: The validator asserts each session's `day_index`→weekday is in `available_days` (plan.md:55, Phase 2 #2), and that mapping is relative to `start_date`'s weekday ("day_index 1 = start_date's weekday"). But the prompt builder is `buildPlanMessages(profile)` (plan.md:137) — it does NOT receive `start_date`, and `start_date` is chosen separately as "today" in `toPlanInsert` (plan.md:145). The model is told only "place sessions on available_days" with no weekday anchor for `day_index`. If `start_date` is any weekday other than the one the model implicitly assumes (likely Monday), the validator rejects the plan — ~6 of 7 onboarding days. Every attempt fails → bounded retries exhaust → user gets the friendly-error path instead of a plan. The feature works only when onboarding lands on the model's assumed start weekday.
- **Fix A ⭐ Recommended**: Anchor day_index 1 to Monday deterministically — set `start_date` to the next Monday in `toPlanInsert`/route so `day_index 1 = 'mon'` always; state that anchor in the prompt. Validator already maps relative to `start_date` → stays consistent.
  - Strength: Deterministic; model reasons in fixed mon–sun weeks; no per-request weekday plumbing into the prompt.
  - Tradeoff: Plan can start up to 6 days out (product nuance, not a bug).
  - Confidence: HIGH — removes the weekday ambiguity entirely.
  - Blind spot: Product may explicitly want "starts today."
- **Fix B**: Pass `start_date` into the prompt and have the model align weekdays — `buildPlanMessages(profile, startDate)`; tell the model "day_index 1 falls on <weekday>; map subsequent indices accordingly."
  - Strength: Plan starts immediately (`start_date = today`).
  - Tradeoff: Prompt carries weekday math; model weekday reasoning is an extra error source → may still misplace → more retries.
  - Confidence: MED — depends on the model reliably doing date arithmetic.
  - Blind spot: Server "today" (workerd UTC) vs user-local date can shift `start_date`'s weekday by a day.
- **Decision**: FIXED via Fix A — anchored day_index 1 to next Monday in toPlanInsert/route + stated anchor in prompt (plan.md Availability mapping, Phase 2 #3, Phase 2 #4).

### F2 — "One call comfortably fits Worker limits" is unverified; the sync-vs-async decision rests on it

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details → "Worker duration"; Performance Considerations; "What We're NOT Doing" (async)
- **Detail**: The plan asserts "One low-temperature structured call comfortably fits Worker CPU/duration limits" with no measurement, and uses it to justify excluding async/polling. Two corrections: (a) CPU time is NOT the constraint — time awaiting a fetch subrequest doesn't count against the Worker CPU limit, so that framing is misleading; (b) the real risk is wall-clock latency: a 28-day strict-JSON generation can take tens of seconds, and "retry up to N times" plus optional `route:"fallback"` multiply that sequentially. Bounded `max_tokens` sized "to the plan size" also risks truncating the strict JSON (~20 sessions × segments), which retries won't fix since the cap is unchanged.
- **Fix**: Pin a small retry cap (e.g. 2) with a per-attempt AbortController timeout; size `max_tokens` generously for the full plan (not minimal) to avoid truncation; add a Phase 5 success criterion that records end-to-end latency on the paid model before committing to sync.
  - Strength: Bounds worst-case latency; makes the sync choice evidence-backed.
  - Tradeoff: A hard timeout surfaces the friendly-error path more often on slow models.
  - Confidence: MED — paid-model latency for 28-day strict JSON is unmeasured.
  - Blind spot: If measured latency is poor, async (explicitly out of scope) becomes the real fallback.
- **Decision**: SKIPPED

### F3 — Idempotency is read-then-write; concurrent generate-on-load hits the unique index and returns 500, not the existing plan

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 (#2 route flow, #1 persistPlan); Phase 4 (#2 island)
- **Detail**: The route's idempotency is "if getActivePlan → return it, else generate and insert" (plan.md:187) — a read-then-write with no lock. The plan says this "sidesteps any conflict" (plan.md:34), but two near-simultaneous requests both read null, both generate, both insert → the second hits `one_active_plan_per_user` (PG 23505) and falls through to a generic 500. Realistic for a generate-on-load island: React 19 StrictMode double-invokes effects in dev, and multi-tab / rapid reload do it in prod. `persistPlan` handles orphan cleanup on session-insert failure but not the plan-insert unique violation as an idempotent win.
- **Fix**: Treat a plans-insert 23505 as an idempotent win — re-query `getActivePlan` and return it 200 instead of 500; and guard the island's generate-on-load against double-fire (in-flight ref/abort, disable the trigger while running).
  - Strength: Closes the TOCTOU race incl. StrictMode double-effect and multi-tab; cheap, localized.
  - Tradeoff: A little more error-branch code in the route.
  - Confidence: HIGH — standard idempotent-recovery pattern.
  - Blind spot: None significant.
- **Decision**: FIXED — plans-insert 23505 treated as idempotent win (re-query + 200) in persistPlan & route flow (Phase 3 #1/#2); island guarded against double-fire (Phase 4 #2).

### F4 — "Multi-stage progress indicator" implies progress a single opaque fetch can't report

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 4 (#2 PlanView island)
- **Detail**: Generation is a single synchronous POST with no streaming/events, so there are no real stages to report. A "multi-stage" indicator either fakes stages or implies progress signals that don't exist.
- **Fix**: A single indeterminate animated indicator + reassuring copy satisfies the "continuous visible feedback" NFR; drop the staging.
- **Decision**: FIXED — Phase 4 #2 now specifies a single indeterminate indicator + reassuring copy, no staging.
