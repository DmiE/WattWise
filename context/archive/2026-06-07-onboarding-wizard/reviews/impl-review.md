<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Onboarding Wizard

- **Plan**: context/changes/onboarding-wizard/plan.md
- **Scope**: All 4 phases
- **Date**: 2026-06-09
- **Verdict**: NEEDS ATTENTION → RESOLVED (all 4 findings fixed in triage 2026-06-09)
- **Findings**: 0 critical, 2 warnings, 2 observations — all FIXED

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Build (`npm run build`) and lint (`npm run lint`) both green. 11 of 12 planned items MATCH, 1 DRIFT (F2), no missing files. Authz at the API boundary, server-side field derivation (W/kg 2.0/2.8/3.7 pinned), and idempotent upsert-on-`user_id` are correctly in place.

## Findings

### F1 — getProfile swallows DB errors → misroutes onboarded users

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/profile.ts:11-14 (called middleware.ts:27)
- **Detail**: getProfile destructures only `{ data }` and returns `data ?? null`, discarding `error`. New middleware gating treats null as "no profile", so a transient read failure bounces an already-onboarded user from /dashboard back to /onboarding (self-correcting next request, but a visible flap). The `await`ed call has no try/catch, so a thrown rejection 500s the protected route. This getProfile call is the reliability surface this change newly introduced. The pre-existing unguarded `getUser()` at middleware.ts:11-13 shares the shape but predates this change — out of scope, worth a separate follow-up.
- **Fix**: In getProfile, treat a query error as a propagated/distinguishable failure; wrap the middleware getProfile call so a read failure fails *open* to the requested route rather than silently redirecting to /onboarding.
  - Strength: Removes the misroute flap and the 500-on-every-protected-request failure mode; keeps an onboarded user where they are.
  - Tradeoff: A few lines in two files; must pick the fail-open policy deliberately (don't trap a real profile-less user out of onboarding).
  - Confidence: HIGH — data path and call site are both small and clear.
  - Blind spot: Supabase JS usually resolves with {data,error} rather than rejecting, so the 500 path is the less-likely of the two.
- **Decision**: FIXED — getProfile now throws on read error; middleware wraps the gating block in try/catch and fails open to the requested route.

### F2 — Wizard step order swapped vs. plan (body before equipment)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/onboarding/OnboardingWizard.tsx:56
- **Detail**: Plan specifies steps (1) goal → (2) equipment → (3) body+availability → (4) review. Implementation ships (1) goal → (2) body+availability → (3) equipment → (4) review (STEP_TITLES line 56; stepErrors maps step 2→bodyStepSchema, step 3→equipmentStepSchema, lines 121-123). Functionally sound and arguably better: HRM max-HR prefill `defaultMaxHr(age)` needs `age`, now collected before the equipment step, so the 220−age prefill works without a fallback. All required sub-fields/branches present and correct. Contradicts only the literal plan ordering.
- **Fix**: Update the plan's Phase 3 step ordering to match (body-before-equipment), recording the age-prefill rationale.
- **Decision**: FIXED — plan Phase 3 contract reordered to goal → body → equipment → review with the age-prefill rationale noted inline.

### F3 — Stale step-number comments in the schema

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/onboarding-schema.ts:44, :53
- **Detail**: `bodyStepSchema` is commented "Step 3" and `equipmentStepSchema` "Step 2", but the wizard wires step 2→body and step 3→equipment (consistent with F2's actual ordering). The wiring is correct; only the comments are stale.
- **Fix**: Swap the two step-number comments to match the shipped order.
- **Decision**: FIXED — bodyStepSchema comment now "Step 2", equipmentStepSchema "Step 3".

### F4 — Unplanned src/lib/supabase.ts change

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/lib/supabase.ts
- **Detail**: Diff parameterizes the client as createServerClient<Database>(...) and adds `import type { Database }`. Not in the plan's file list, but necessary: without the generic, getProfile/upsertProfile and `.from("profiles")` would be untyped (any), defeating the typed contracts in Phases 2/4. Two-line, type-only, no runtime change. Justified enabler.
- **Fix**: None needed — note in the plan as an addendum that the SSR client was generically typed to support the profile service.
- **Decision**: FIXED — plan "Addenda" section records the generically-typed SSR client. No code change.
