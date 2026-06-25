<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Session History (S-06)

- **Plan**: context/changes/session-history/plan.md
- **Scope**: Full plan (Phases 1–3 of 3)
- **Date**: 2026-06-25
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Drift detection found zero DRIFT/MISSING across all three phases: query, error
string, UTC formatter contract, the `formatDate` de-duplication refactor, the
middleware renewal-gate exemption, and both nav links all match intent exactly.
Automated criteria (lint + build) pass; all manual criteria confirmed by the
implementer. The unpaginated `getCompletedSessions` query is explicitly covered
by the plan's "What We're NOT Doing" (render-all, v1 small volumes) — compliant,
not a finding.

## Findings

### F1 — formatSessionDate has no malformed-input guard

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/format.ts:14
- **Detail**: `iso.split("-").map(Number)` does no validation. A malformed/empty `iso` yields NaN components, so `Date.UTC(NaN, …)` renders the literal "Invalid Date" to the user. Inputs are DB date columns today (low real risk), but the function is now exported and shared by both PlanView and SessionHistory, widening its blast radius.
- **Fix**: After computing the parts, if any component is NaN, return the raw `iso` string (or a dash) as a fallback instead of formatting.
- **Decision**: FIXED — added NaN guard returning raw `iso` (src/lib/format.ts)

### F2 — Presentational fields beyond the plan's enumerated set

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/components/history/SessionHistory.astro:40, src/pages/history.astro:37-42
- **Detail**: Plan enumerated date/type/duration/rating/km per row. Implementation additionally renders `session.title` per row and a "Session history" page header/subtitle. Both are benign, read-only presentational additions consistent with intent — not scope creep into new behavior.
- **Fix**: None required — accept as a reasonable presentational improvement. (Optional: note the title column in the plan as an addendum.)
- **Decision**: SKIPPED — accepted as benign presentational improvement

### F3 — SESSION_STYLES duplicated across two files

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/history/SessionHistory.astro:13-17, src/components/plan/PlanView.tsx:82-86
- **Detail**: The session-type label/dot style map is mirrored in both files (a comment acknowledges the mirror). PlanView's copy also carries icons the Astro version doesn't need. Harmless today; a future session-type change must touch two places.
- **Fix**: Optionally lift the shared label/dot map into a small shared module (e.g. src/lib/session-style.ts) consumed by both.
- **Decision**: SKIPPED — acknowledged mirror left as-is
