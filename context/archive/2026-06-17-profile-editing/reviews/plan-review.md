<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Profile Editing Implementation Plan

- **Plan**: context/changes/profile-editing/plan.md
- **Mode**: Deep
- **Date**: 2026-06-17
- **Verdict**: SOUND (after triage — all 3 findings fixed; was REVISE)
- **Findings**: 0 critical, 2 warnings, 1 observation — all FIXED

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING → PASS (F1 fixed) |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING → PASS (F2, F3 fixed) |
| Plan Completeness | PASS |

## Grounding

9/9 existing paths ✓, 4/4 new paths absent ✓, 6/6 symbols ✓, migration constraints + RLS update policy + updated_at trigger verified ✓, brief↔plan consistent ✓. Confirmed: `commonFields` is module-private at `onboarding-schema.ts:24` (plan correctly says "add export"); `getProfile` throws on read error (`services/profile.ts:15-18`); the three cross-field CHECK constraints touch only `ftp_*`/`fitness_level`/`max_hr`/`equipment_type`, none in the editable set — partial-update safety holds.

## Findings

### F1 — Save can't "re-disable after save" against an immutable prop

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 2 §3 (ProfileForm contract) vs. Success Criterion 2.5 / Progress 2.5
- **Detail**: The contract defines the dirty flag as "state differs from initial `profile`", but `profile` is the server-rendered prop and never changes during the island's life. Success criterion 2.5 requires Save to "re-disable after a successful save." An implementer following the contract literally leaves Save enabled after save, because the baseline (prop) still holds old values while local state holds new ones. The plan never specifies how the baseline resets. `dashboard.astro`/`generate.ts` solve the analogous problem via full reload on success; this plan has no equivalent.
- **Fix A ⭐ Recommended**: Reset an in-memory baseline on save success
  - Strength: No reload flash; keeps the single-page island feel. After a 200, copy current editable state into the baseline used by the dirty check (e.g. a `savedSnapshot` state seeded from `profile`, updated on success).
  - Tradeoff: One more piece of state to keep in sync.
  - Confidence: HIGH — standard controlled-form pattern.
  - Blind spot: None significant.
- **Fix B**: Reload the page on save success (mirror generate.ts)
  - Strength: Dead simple; re-derives baseline from a fresh prop; matches an existing in-repo pattern.
  - Tradeoff: Full-page reload on every save — heavier than the single-page form the plan deliberately chose.
  - Confidence: HIGH — generate.ts already does this.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A (savedSnapshot baseline reset on save success)

### F2 — profile.astro doesn't handle getProfile() throwing

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 §2 (profile.astro contract)
- **Detail**: The contract handles only `getProfile → null` (redirect to /onboarding), but `getProfile` throws on a real read error (`services/profile.ts:15-18`). `dashboard.astro:21-29` wraps its read in try/catch specifically to avoid 500-ing on a transient failure; profile.astro has no such guard, so a transient read error renders Astro's 500 page. The null branch is also largely unreachable — middleware already redirects null-profile users off /profile to /onboarding — so the throw path is the one that matters and is omitted. Fallback isn't obvious: redirecting a transient error to /onboarding would wrongly bounce an onboarded user.
- **Fix**: Wrap getProfile in try/catch in the contract. On a thrown read error (not null), redirect to /dashboard rather than /onboarding (onboarded user hit a blip, not a missing profile). Keep null → /onboarding as defensive cover for the middleware-fell-open edge.
  - Strength: Matches dashboard.astro's deliberate fail-open posture; avoids misrouting onboarded users.
  - Tradeoff: Slightly more branching in page frontmatter.
  - Confidence: HIGH — throw behavior and dashboard precedent both verified in-repo.
  - Blind spot: None significant.
- **Decision**: FIXED (try/catch getProfile; thrown error → /dashboard, null → /onboarding)

### F3 — Dirty check on available_days (an array) needs care

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 §3 (dirty-flag gating)
- **Detail**: Five editable fields are scalars (cheap `!==`), but available_days is a string[]. A naive reference or JSON.stringify compare is order-sensitive: toggling a day off then on can reorder the array vs. the DB value and falsely mark the form dirty (or miss a change). Low risk if the array is rebuilt by filtering DAY_CODES order, but the plan doesn't say so.
- **Fix**: Compare available_days order-independently (sorted copies, or rebuild selection by iterating DAY_CODES so order is canonical). Worth one line in the contract.
- **Decision**: FIXED (rebuild available_days in canonical DAY_CODES order for an order-stable dirty compare)
