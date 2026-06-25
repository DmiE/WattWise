<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Plan Renewal (S-05)

- **Plan**: context/changes/plan-renewal/plan.md
- **Scope**: Phase 4 of 5
- **Date**: 2026-06-25
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS (2 observations) |
| Success Criteria | PASS |

## Findings

### F1 — Page comment asserts a PROTECTED_ROUTES state Phase 5 hasn't created yet

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/renewal.astro:8-9
- **Detail**: The header comment says "/renewal is in PROTECTED_ROUTES". As of Phase 4, /renewal is NOT yet in PROTECTED_ROUTES (middleware.ts:5 lists only /dashboard, /onboarding, /profile — Phase 5's job). Becomes true once Phase 5 lands. No exposure: the page guards on `if (user)`, so an unauthenticated hit never calls getProfile and falls through to redirect("/onboarding"). Sequencing artifact, not a bug.
- **Fix**: Leave as-is — Phase 5 (next) makes the comment accurate.
- **Decision**: SKIPPED (self-resolves in Phase 5)

### F2 — Presentational helpers duplicated between ProfileForm and RenewalForm

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/renewal/RenewalForm.tsx:280-370
- **Detail**: Section, OptionRow, NumberField, FieldError, toNum, GOAL_LABELS, DAY_LABELS are copied verbatim from ProfileForm.tsx. Consistent with the plan's explicit "copy and adapt — do not import" directive and the existing per-form-local-helpers convention (OnboardingWizard.tsx does the same). Acceptable; flagged only as a future-extraction candidate if a third form appears.
- **Fix**: Leave as-is. Revisit shared extraction only if/when a third consumer emerges.
- **Decision**: SKIPPED (matches existing convention)

## Notes

- All planned items implemented as specified (MATCH).
- `window.location.assign("/dashboard")` substitutes the plan's `window.location.href = "/dashboard"` — equivalent, and required by the repo's `react-hooks/immutability` lint rule. Sound deviation.
- Correctly omits a dirty-gate (unlike ProfileForm): renewal is a confirm-or-update flow, so submitting unchanged values is valid.
- Correctly omits a "← Dashboard" escape link: renewal is a hard gate (plan: "Not making the gate dismissible").
- Success criteria: build ✅, lint ✅, dev-serve ✅ (302, no crash); manual 4.4–4.7 confirmed by user.
