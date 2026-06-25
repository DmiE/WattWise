# Intensity Reference (S-07) — Plan Brief

> Full plan: `context/changes/intensity-reference/plan.md`

## What & Why

Add an inline, expandable reference inside the session detail view so cyclists
can see what their intensity targets mean — zone definitions for power-meter and
HRM users, the RPE scale for no-equipment users. It closes the FR-005 gap raised
in the PRD: a user new to structured training sees "Z3 · 140–155 bpm" or "RPE 5"
without knowing how hard that should feel. FR-011, a nice-to-have.

## Starting Point

The session detail (`SessionDetail` in `src/components/plan/PlanView.tsx`) already
renders each segment's target via `formatTarget()` in its equipment-correct unit,
but offers no explanation of the zones/RPE values. The plan's equipment type is
already on the data the component's parent receives (`plan.plan.equipment_at_generation`).

## Desired End State

Expanding a session shows a collapsed "What do these mean?" toggle below the
segment list. Opening it reveals a 5-zone power table (% FTP), a 5-zone heart-rate
table (% max HR), or the RPE 1–10 scale — selected by the plan's equipment type.

## Key Decisions Made

| Decision                | Choice                                     | Why (1 sentence)                                                                                        |
| ----------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Reference content       | 5-zone power/HR tables + RPE 1–10 scale    | 5 zones match the app's existing `hr_zone` 1–5 labels, so the HR table aligns with on-screen `Z#`       |
| Personalization         | Generic static content                     | No data dependency or zone-math; segments already show the user's personal numbers; keeps it LOW effort |
| Reveal UX               | Inline expand/collapse toggle (`useState`) | Mirrors `SessionDetail`'s existing inline-mode pattern; no new UI-library dependency                    |
| Placement / granularity | One block per session, below segments      | One equipment kind per plan, so one block covers all segments; minimal footprint                        |
| Power zone model        | 5-zone (not 7-zone Coggan)                 | Avoids two different zone counts on screen; consistent with the 1–5 HR zones                            |

## Scope

**In scope:** static reference content module; an `IntensityReference` toggle
component; threading `equipment_at_generation` into `SessionDetail`; rendering the
block below the segment list.

**Out of scope:** computing per-athlete zone bounds; changing segment rendering;
new UI-library deps; any data-model/API/migration/prompt changes; placement
outside the session detail; the 7-zone Coggan model.

## Architecture / Approach

A new `src/lib/intensity-reference.ts` holds the content as a
`Record<EquipmentType, …>` (exhaustive over the three equipment types). A small
presentational `IntensityReference` component in `PlanView.tsx` owns its open/closed
`useState` and renders the matching table/scale. `PlanOverview` passes
`plan.plan.equipment_at_generation` down to `SessionDetail`, which renders the
component between the segment list and the Status row.

## Phases at a Glance

| Phase                         | What it delivers                                                                  | Key risk                                                                     |
| ----------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1. Content, component, wiring | Static reference data + toggle component + prop threading, rendered in the detail | Choosing zone numbers users trust (mitigated: Z2/Z4 match PRD-cited figures) |

**Prerequisites:** S-02 (session detail view) — done.
**Estimated effort:** ~1 session, single phase.

## Open Risks & Assumptions

- Assumes a standard 5-zone % FTP / % max-HR model is acceptable as generic
  reference content (Z2/Z4 power figures match the PRD examples).
- Power-meter segments display bare watts (no zone number), so the power table is
  informational context rather than a direct legend for the displayed targets —
  acceptable and PRD-aligned.

## Success Criteria (Summary)

- For each equipment type, expanding a session reveals the correct reference
  (power table / HR table / RPE scale).
- The toggle opens/closes and is keyboard- and screen-reader-accessible.
- No regression to the existing done/skip/log flows.
