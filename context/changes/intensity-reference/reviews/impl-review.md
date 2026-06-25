<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Intensity Reference (S-07)

- **Plan**: context/changes/intensity-reference/plan.md
- **Scope**: Phase 1 of 1
- **Date**: 2026-06-25
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Grounding

- All four planned changes implemented as described (MATCH):
  1. `src/lib/intensity-reference.ts` — `Record<EquipmentType, …>` with 5 zone rows (power/hrm) + RPE bands (none); zone/HR/RPE values match the plan's table.
  2. `IntensityReference` component near `formatTarget` — local `useState(open)`, `<button type="button">` with `aria-expanded` + `aria-controls`/`useId` region pairing.
  3. `equipment: EquipmentType` threaded into `SessionDetail`; call site passes `plan.plan.equipment_at_generation`; `EquipmentType` imported from `@/types`.
  4. `<IntensityReference>` rendered between the segment `<ol>` and the Status divider.
- Scope guardrails respected: no zone math, `formatTarget()` untouched, no UI-library dependency (reused `useState` + already-imported lucide icon), no data/API/migration/prompt changes.
- Benign additions within plan intent: `ChevronDown` icon + `useId` import (presentational disclosure affordance).
- Automated success criteria: `npm run lint` exit 0, `npm run build` exit 0. Manual rows 1.4–1.9 user-confirmed.

## Findings

### F1 — Unused `rangeHeader` field in reference content

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/intensity-reference.ts:62,72 (ZoneReference.rangeHeader)
- **Detail**: The `ZoneReference` interface declares `rangeHeader` ("% FTP" / "% max HR") and both zone entries populate it, but `IntensityReference` in PlanView.tsx never reads it — the table renders as a definition list with no column header, so the range unit lives only in each row's `range` string. `caption` already satisfies the plan's "per-equipment heading/caption string" contract, leaving `rangeHeader` as dead data. TS/ESLint don't flag it because unread object-literal properties aren't errors.
- **Fix**: Remove `rangeHeader` from the `ZoneReference` interface and from the `power_meter`/`hrm` entries. (Alternative if a column header is wanted later: render it — but the current definition-list layout has none.)
- **Decision**: FIXED — removed `rangeHeader` from the interface and both zone entries.
