<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Profile Editing (FR-010 / S-04)

- **Plan**: context/changes/profile-editing/plan.md
- **Scope**: Phases 1–2 of 2 (full plan)
- **Date**: 2026-06-17
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Every planned change is present and faithful to its contract. `npm run lint` and `npm run build` both pass. Authz/RLS is double-layered (session-derived `user.id` filter + `profiles_update_own` RLS policy). The partial-column update provably cannot touch FTP/equipment columns: zod's `commonFields` strips unknown keys and `api/profile.ts` writes `result.data` (parsed), not the raw body. No drift, nothing skipped, no dangerous decisions.

## Findings

### O1 — no-misused-promises disabled for .astro frontmatter

- **Severity**: 🟦 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: eslint.config.js:72
- **Detail**: `@typescript-eslint/no-misused-promises` is set to `off` inside the `astroConfig` block. Verified: that block is scoped via `files: ["**/*.astro"]`, and `baseConfig` (no `files:` key) keeps the rule at `error` for all .ts/.tsx. The inline comment's claim ("still applies to all .ts/.tsx") is TRUE — the disable is correctly narrowed to the documented astro-eslint-parser crash workaround on top-level `return Astro.redirect(...)`. Residual exposure: a genuine misused-promise in .astro frontmatter would now go unflagged (low — frontmatter is top-level await-capable server code).
- **Fix**: None required. Optionally extend the comment to note that real .astro misused-promises are also silenced, so a future reader doesn't assume zero coverage loss.
- **Decision**: PENDING

### O2 — Form helpers duplicated from OnboardingWizard

- **Severity**: 🟦 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/profile/ProfileForm.tsx
- **Detail**: `toNum`, `NumberField`, `FieldError`, `OptionRow`, label maps, and `toggleDay` are re-declared rather than shared with `OnboardingWizard.tsx`. Intentional and commented (the forms diverge — ProfileForm adds a dirty-compare and order-stable `available_days` rebuild). Noted only as a future drift risk between the two sibling forms.
- **Fix**: None now. If a third consumer appears, extract shared form primitives to `src/components/`.
- **Decision**: PENDING

### O3 — Extra "← Dashboard" back-link and note placement

- **Severity**: 🟦 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/pages/profile.astro:38-44
- **Detail**: A back-link to `/dashboard` was added — not in the plan, but a reasonable nav affordance with no contract impact. Separately, the "Changes apply to your next plan; your current plan stays as-is." note sits in the form header rather than directly beside goal/availability (cosmetic; intent satisfied).
- **Fix**: None required — benign addition.
- **Decision**: PENDING
