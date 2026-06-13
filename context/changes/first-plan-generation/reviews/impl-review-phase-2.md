<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: First Plan Generation (S-02)

- **Plan**: context/changes/first-plan-generation/plan.md
- **Scope**: Phase 2 of 5 (Plan Contract & Generation Logic)
- **Date**: 2026-06-13
- **Verdict**: APPROVED (minor cleanup recommended before Phase 3)
- **Findings**: 0 critical, 1 warning, 3 observations

## Verification (run live)

- `npm run lint` → PASS (exit 0)
- `npm run build` → PASS (server built in 4.78s)
- Date math → verified: `nextMonday` snaps to Monday (stays put if already Monday); `day_index 1` = start_date, `day_index 28` = start_date + 27 (Sunday); 28-day window satisfies `plans_28_day_window` (criterion 2.6 ✓)
- Scope → only the two planned files changed (`src/lib/plan-schema.ts`, `src/lib/plan.ts`); no scope creep
- Weekday codes (`mon`..`sun`) in validator match the `profiles_available_days_valid` DB CHECK exactly

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Segment durations not checked against planned_duration_min

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/plan.ts:59-113 (validateGeneratedPlan)
- **Detail**: The prompt (system rule 3, plan.ts:161) and the JSON-Schema description (plan-schema.ts:137) both assert "planned_duration_min must equal the sum of segment durations," but `validateGeneratedPlan` — the stated enforced trust boundary — never checks it. The duration-cap guardrail (line 92) and the dashboard UI both key off `planned_duration_min`, so a plan where the model emits `planned_duration_min=60` while its segments sum to 90 passes validation, persists, and under-reports a workout that's actually over cap. This is exactly the model-output-drift class the zod boundary exists to catch. (Strictly the Phase-2 validator contract listed only guardrails a–d, so this is not a plan violation — but it is an internal inconsistency within this phase's own work.)
- **Fix**: Add a per-session check inside the existing loop — sum `session.structure.segments[].duration_min` and push a `"duration_mismatch"` issue if it ≠ `planned_duration_min`. Reuses the existing `issues[]` mechanism; ~4 lines, retryable like the other guardrails.
  - Strength: Closes a latent correctness gap with the machinery already present; makes the trust boundary match what the prompt promises.
  - Tradeoff: Adds a fifth issue code; need to extend the `PlanValidationIssue["code"]` union.
  - Confidence: HIGH — the loop already iterates segments per session.
  - Blind spot: None significant.
- **Decision**: FIXED — added `duration_mismatch` issue code + per-session sum check in `validateGeneratedPlan` (src/lib/plan.ts); lint + build pass, behavioral check confirms a 60min session whose segments sum to 60 matches.

### F2 — Intensity range ordering (low ≤ high) not validated

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/plan-schema.ts:21-32 (wattsTarget, hrZoneTarget)
- **Detail**: `low_watts`/`high_watts` and `low_bpm`/`high_bpm` are each bounded individually (0–2000, 30–230) but nothing asserts `low ≤ high`. A reversed range (e.g. low_watts=300, high_watts=200) passes zod and renders as a nonsense target in the dashboard.
- **Fix**: Add a `.refine()` to `wattsTarget`/`hrZoneTarget` asserting `low_* <= high_*`. Optional for Phase 2 if deferred — note it.
- **Decision**: FIXED — added a `.refine()` on `targetSchema` (the union, keeping members plain objects) asserting `low_watts ≤ high_watts` / `low_bpm ≤ high_bpm` (src/lib/plan-schema.ts); behavioral check confirms reversed ranges are rejected and rpe/valid ranges pass.

### F3 — toSessionInserts signature drops the planned `profile` param

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/plan.ts:243
- **Detail**: Plan contract specified `toSessionInserts(planId, profile, validatedPlan, startDate)`; implemented as `toSessionInserts(planId, validatedPlan, startDate)`. Benign — the validated plan is self-contained, so `profile` isn't needed for session rows. Flagged only so the Phase-3 route author calls it with the correct arity.
- **Fix**: None needed — accept the leaner signature (arguably better).
- **Decision**: PENDING

### F4 — JSON-Schema `description` is `required`; zod marks it `.optional()`

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/plan-schema.ts:59 vs :164
- **Detail**: `sessionSchema` has `description: z.string().optional()`, but `PLAN_JSON_SCHEMA` lists `"description"` in `required` (line 164). Correct, not a bug — OpenRouter strict mode requires every property in `required`, so the model always emits a description, which always satisfies the looser zod optional. Consistent in practice (criterion 2.3 holds). Noted so the divergence is recognized as intentional.
- **Fix**: None needed — optionally add a one-line comment noting the strict-mode reason so a future reader doesn't "fix" the mismatch.
- **Decision**: PENDING
