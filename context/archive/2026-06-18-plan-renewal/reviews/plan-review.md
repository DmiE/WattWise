<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Plan Renewal (S-05)

- **Plan**: `context/changes/plan-renewal/plan.md`
- **Mode**: Deep
- **Date**: 2026-06-18
- **Verdict**: REVISE
- **Findings**: 0 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS (2 observations) |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

14/14 paths ✓, symbols ✓ (persistPlan/getActivePlan/nextMonday/updateProfileFields/commonFields), `db:types` script ✓, Progress↔Phase ✓ (5/5 phases, all N.M bullets match success criteria), brief↔plan ✓. No `context/foundation/lessons.md` and no `docs/reference/contract-surfaces.md` — those checks skipped.

## Strengths (context for the warnings)

- The central design risk is correctly identified and solved: the `one_active_plan_per_user` partial unique index, `persistPlan`'s `23505` idempotent-win short-circuit, and the "supersede-first, activate-second" ordering inside a non-deferrable index.
- `persistPlan`'s optional `opts` arg is a clean, zero-blast-radius extension (only caller: `generate.ts:113`).
- `mergedProfile` is threaded consistently through `buildPlanMessages` → `validateGeneratedPlan` → `toPlanInsert`. The validator checks `available_days`/`equipment_type`/duration caps against the profile, so it must see the merged one — the plan gets this right.
- Progress section is well-formed and parseable.

## Findings

### F1 — Phase 4 "reuse" of usePlanGeneration / progress UI is not drop-in

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 4 — Renewal form island
- **Detail**: The contract says "reuse usePlanGeneration" and "reuse the dashboard's generating-progress UX / progress component." But `usePlanGeneration` (`usePlanGeneration.ts:25,54,63`) hardcodes the `/api/plans/generate` endpoint, `window.location.reload()` on success, and a module-level sessionStorage flag `wattwise:plan-generated` — none parameterized. The progress UI is an un-exported local `PlanGenerating()` inside `PlanView.tsx:38-72`, not a standalone component. Renewal needs a different endpoint (`/api/plans/renew`) and a different success nav (`window.location.href="/dashboard"`, not reload), and a shared flag risks collision. "Reuse" as written underspecifies real work.
- **Fix A ⭐ Recommended**: Copy — renewal-local submit + progress. Own in-flight ref + fetch to `/renew` + nav to `/dashboard`; adapt `PlanGenerating`'s spinner/error markup into `RenewalForm`.
  - Strength: Leaves the generate flow untouched — honors the plan's own "Not changing the first-plan path" boundary; zero blast radius.
  - Tradeoff: Some markup duplication between PlanView and RenewalForm.
  - Confidence: HIGH — the pieces are small and self-contained.
  - Blind spot: None significant.
- **Fix B**: Extract — parameterize the hook (`usePlanGeneration(endpoint, onSuccess, flagKey)`) + lift the progress component into a shared `<Generating/>` used by both PlanView and RenewalForm.
  - Strength: No duplication; one source of truth for the progress UX.
  - Tradeoff: Touches the working generate path (PlanView, dashboard) — blast radius the plan otherwise avoids; needs its own re-test.
  - Confidence: MED — extraction is clean but widens the change surface.
- **Decision**: FIXED via Fix A (copy-and-adapt; generate flow untouched)

### F2 — "Profile unchanged on failure" only holds for generation failure

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Desired End State + Critical Implementation Details + Phase 3 step 9
- **Detail**: The plan claims a failure "leaves the old plan active and the profile unchanged." True for a *generation* failure (step 8). But step 9 runs `updateProfileForRenewal` BEFORE `persistPlan({supersede})`. If the profile update succeeds and the persist RPC then fails, the profile is changed (new goal/FTP) while the old plan stays active — profile changed, plan un-renewed. The stated invariant is imprecise. The ordering itself is defensible and recoverable: the old plan stays active+expired, so the eligibility guard still passes and a retry regenerates from the same merged profile. (Reversing to plan-then-profile would be worse — a profile-update failure after a successful supersede leaves the new plan active+non-expired, so the eligibility guard returns 409 and the now-stale FTP can't be fixed via renewal, and FTP isn't editable in the profile editor.)
- **Fix**: Keep the ordering; correct the wording. State the real invariant — "a generation failure leaves old plan + profile untouched; a post-generation persist failure may update the profile but leaves the old plan active and is recoverable by retrying renewal." Add a manual-verification step (3.x) for the persist-failure case (force the RPC to error after the profile update) confirming the old plan stays active and a retry succeeds.
- **Decision**: FIXED (clarified invariant in Critical Implementation Details; added manual check 3.7)

### F3 — Per-request middleware plan read not accounted for

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 5 — Middleware gate; Performance Considerations
- **Detail**: Phase 5 adds `getActivePlan` to middleware, which runs on every request to every protected route. Combined with the existing per-request `getProfile` (`middleware.ts:24-40`), every onboarded user's protected navigation now does two sequential Supabase reads in the worker. Performance Considerations covers only the synchronous renew call, not this added steady-state per-request cost.
- **Fix**: Note the added per-request read in Performance Considerations — acceptable at MVP scale and mirrors the existing fail-open profile read, flagged as a later caching/short-circuit candidate.
- **Decision**: FIXED (added "Steady-state middleware cost" note to Performance Considerations)

### F4 — generate.ts json()/budget constants are module-private ("reuse"=copy)

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 3 — Renew route
- **Detail**: Phase 3 says "reuse the json() helper, constants, and error copy from generate.ts," but `json()` (`generate.ts:11-15`), `MAX_GENERATION_ATTEMPTS` (`:21`), and `GENERATION_BUDGET_MS` (`:28`) are all module-private. "Reuse" means duplicating them, so the budget/retry caps can silently diverge between the two routes.
- **Fix**: Extract these to a shared module imported by both routes, or accept the duplication with a comment cross-referencing the source of truth.
- **Decision**: FIXED via extract (new Phase 3 sub-item 2: `src/lib/services/generation.ts`, generate.ts imports it)

### F5 — New RPC contract differs from the precedent it claims to "mirror exactly"

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 — supersede RPC
- **Detail**: Phase 1 says the RPC follows "the exact declaration style" of `set_session_status`, but that precedent is `returns void`, scopes ownership purely via RLS (no `auth.uid()`), and signals failure by raising. The new RPC is `returns plans` and adds explicit `where user_id = auth.uid()` filters. That's fine (arguably more explicit) — but the mirror applies to the boilerplate (plpgsql / `security invoker` / `search_path=''` / revoke-from-public + grant-to-authenticated), not the contract.
- **Fix**: State the contract differs intentionally; keep the boilerplate mirror, and confirm `auth.uid()` resolves under `search_path=''` (it lives in the auth schema and is already qualified, so it should).
- **Decision**: FIXED (clarified boilerplate-vs-contract in Phase 1; added search_path verify-note)
