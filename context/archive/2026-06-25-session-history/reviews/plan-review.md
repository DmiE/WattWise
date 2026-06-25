<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Session History (S-06)

- **Plan**: context/changes/session-history/plan.md
- **Mode**: Deep
- **Date**: 2026-06-25
- **Verdict**: REVISE
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING |
| Lean Execution | WARNING |
| Architectural Fitness | PASS |
| Blind Spots | PASS (1 observation) |
| Plan Completeness | PASS (1 observation) |

## Grounding

7/7 paths ✓ (existing files present; new files history.astro / format.ts / components/history correctly absent), symbols ✓ (scheduled_date column, session_logs(*) to-one embed, PROTECTED_ROUTES, formatDate, log fields actual_duration_min/rating/km_ridden), Progress↔Phase consistency ✓ (3 phases, all success-criteria bullets mapped to N.M checkboxes), brief↔plan ✓.

## Findings

### F1 — Expired-plan users have no way to reach /history

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 3 — Routing & navigation
- **Detail**: The plan exempts /history from the renewal gate so "a user with an expired plan can review past work without being forced to renew first" (brief, Key Decisions). But the only nav affordance added is a link on the dashboard (Phase 3 #2). An expired-plan user is redirected /dashboard → /renewal by `middleware.ts:48`, and `renewal.astro` has no top bar / no link to /history (verified — renders only RenewalForm). So the intended audience can reach /history only by typing the URL. The exemption ships but its stated purpose is not delivered via UI.
- **Fix A ⭐ Recommended**: Add a "View history" link to renewal.astro
  - Strength: Closes the loop — exemption becomes reachable for its intended audience; small additive change to one page.
  - Tradeoff: Touches a 4th file in Phase 3 (still trivial).
  - Confidence: HIGH — renewal.astro is a static Astro page; a link is a one-line add next to RenewalForm.
  - Blind spot: Renewal page has no top bar; link needs a sensible placement.
- **Fix B**: Accept URL-only access; drop the exemption's stated rationale
  - Strength: No extra work; exemption still prevents an accidental bounce on a deep-link to /history.
  - Tradeoff: "Review past work while expired" goal not delivered via UI — latent gap.
  - Confidence: MED — depends on whether that goal is must-have.
  - Blind spot: Whether PRD/FR-009 treats expired-plan access as required vs nice-to-have.
- **Decision**: Fixed via Fix A — added Phase 3 #3 (renewal.astro "View history" link) + success criterion 3.7.

### F2 — New formatSessionDate duplicates PlanView's private formatDate

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 2 #1 — Shared date formatter
- **Detail**: Phase 2 adds `formatSessionDate` in a new `src/lib/format.ts` but explicitly leaves PlanView's private `formatDate` (`PlanView.tsx:106`) in place ("Refactoring PlanView.tsx … is optional and out of scope unless trivial"). Both are UTC-safe `Date.UTC(...)` parsers; the only real difference is output ("Mon, Jun 15" vs "Jun 15"). Result: two near-identical helpers ship, and the "or export the existing one" wording leaves the implementer to decide whether duplication lands.
- **Fix**: Make format.ts the single home — one helper taking format options (or two thin wrappers over one UTC parser) — and point PlanView's 3 call sites (168×2, 326) at it. The PlanView refactor is trivial here; resolve the "optional" ambiguity toward consolidation now.
- **Decision**: Fixed — Phase 2 #1 now mandates `format.ts` as the single UTC parser (weekday opt) and deletes PlanView's `formatDate`, repointing its 3 call sites.

### F3 — Order-by scheduled_date only → unstable ties across plans

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — getCompletedSessions
- **Detail**: `(plan_id, day_index)` is unique but scheduled_date is not, so two plans (e.g. after a renewal) can share a date. Ordering by scheduled_date alone leaves same-date rows in nondeterministic order that can reshuffle between loads. Also: `plan_sessions_plan_scheduled_idx` is keyed on (plan_id, …) so it does not serve this cross-plan ORDER BY — the plan's "single indexed-by-RLS query" wording is slightly overstated (irrelevant at ~20–40 rows).
- **Fix**: Add a deterministic secondary key, e.g. `.order("scheduled_date",{ascending:false}).order("day_index",{ascending:false})`.
- **Decision**: Fixed — Phase 1 query now adds `.order("day_index", desc)`; Performance Considerations corrected re: the index.

### F4 — Phase 1 manual gate is unverifiable in isolation

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — Manual Verification / Implementation Note
- **Detail**: Phase 1 ends with "pause for manual confirmation," and its manual check is "calling the function returns …". But there's no test runner (per CLAUDE.md) and no caller until Phase 2, so there's nothing to call it from — the gate can only be satisfied once /history renders in Phase 2.
- **Fix**: Note that 1.3 is observed via Phase 2's render, or merge Phase 1+2 verification so the pause isn't a dead end.
- **Decision**: Fixed — Phase 1 manual verification + Implementation Note reworded; 1.3 marked deferred to Phase 2 (2.3/2.4).
