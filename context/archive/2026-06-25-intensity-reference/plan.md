# Intensity Reference (S-07) Implementation Plan

## Overview

Add a brief, equipment-aware intensity reference inside the session detail view.
When a cyclist expands a session, a "What do these mean?" toggle below the
segment list reveals a small reference: a 5-zone power table (power-meter users),
a 5-zone heart-rate table (HRM users), or the RPE 1–10 scale (no-equipment
users). The content is static and generic, selected by the plan's
`equipment_at_generation`. This satisfies FR-011 — reducing confusion for users
new to structured training who see a target like "Z3 · 140–155 bpm" or "RPE 5"
without knowing what it means.

## Current State Analysis

- The session detail lives entirely in `SessionDetail` (`src/components/plan/PlanView.tsx:277-525`), rendered inline inside the 4-week grid by `PlanOverview` (`PlanView.tsx:113-212`). There is no separate session page.
- Segment intensity is rendered by `formatTarget()` (`PlanView.tsx:546-557`), discriminating on `target.kind`: `watts` → `"123–145 W"`, `hr_zone` → `"Z3 · 140–155 bpm"`, `rpe` → `"RPE 5 · <cue>"`.
- The target shapes are defined in `src/lib/plan-schema.ts:21-38`: only `hr_zone` carries an explicit `zone` integer (1–5); `watts` is a bare range; `rpe` is `1–10` + `description`.
- Equipment type is the enum `EquipmentType = "power_meter" | "hrm" | "none"` (`src/types.ts:53`). The plan row already stores `equipment_at_generation` (`Plan` row, via `database.types.ts:244`), and `PlanWithSessions.plan` is that `Plan` (`src/types.ts:44-47`). So `plan.plan.equipment_at_generation` is already in `PlanOverview`'s props — no new query or prop on the page.
- `SessionDetail` currently receives only the session row, not equipment. Equipment must be threaded down one level from `PlanOverview`.
- No zone-definition table exists anywhere in the codebase; the LLM generates per-athlete bpm/watt ranges at generation time. The reference content is therefore **new static content authored in this change**.
- No Accordion/Collapsible/Popover/Dialog primitive is installed in `src/components/ui/`. `SessionDetail` already manages inline reveal with a local `useState` `mode` machine (`PlanView.tsx:293`) — the established pattern for show/hide is React state, no new dependency.

## Desired End State

Expanding any session shows, below the segment list and above the Status row, a
collapsed "What do these mean?" control. Toggling it open reveals the reference
matching the plan's equipment:

- **power_meter** → 5-row table: zone name, % FTP range, feel.
- **hrm** → 5-row table: zone name, % max-HR range, feel. Rows align with the `Z1–Z5` labels shown on HR segments.
- **none** → RPE 1–10 scale grouped into bands with a short feel cue.

> Note: power-meter segments render bare watts (e.g. `123–145 W`), with no zone
> number, so the power table is informational context — not a direct legend for
> the displayed targets. This is accepted and PRD-aligned. The HRM case differs:
> segments show `Z#`, so the HR table's `Z1–Z5` rows line up with on-screen labels.

Verify by loading `/dashboard` for each equipment type, expanding a session, and
confirming the correct reference renders, toggles open/closed, and is keyboard-
and screen-reader-accessible.

### Key Discoveries:

- Single integration point: `SessionDetail` in `src/components/plan/PlanView.tsx:277-525`.
- Equipment is free to access: `plan.plan.equipment_at_generation` (`src/types.ts:44-47`) — thread it from `PlanOverview` (`PlanView.tsx:113`) into `SessionDetail`.
- Reveal pattern to mirror: the existing `useState` `mode` toggle in `SessionDetail` (`PlanView.tsx:293`); no UI-library dependency.
- The `EquipmentType` union (`src/types.ts:53`) maps 1:1 to the three references — a `Record<EquipmentType, …>` keeps the selection exhaustive.

## What We're NOT Doing

- Not computing per-athlete zone bounds from FTP / max-HR — content is generic and static (decided in planning).
- Not changing the segment rendering or `formatTarget()` output.
- Not adding a UI-library dependency (Accordion/Collapsible/Dialog).
- Not touching the data model, plan-generation prompt, API routes, or migrations.
- Not adding the reference anywhere other than the session detail (not on the week grid, not a standalone page).
- Not using the 7-zone Coggan power model — a 5-zone model matches the app's 1–5 HR zones.

## Implementation Approach

Author the reference content as a typed static constant keyed by equipment, in a
new small module under `src/lib/`. Build a presentational `IntensityReference`
React component that takes the equipment type, manages its own open/closed
`useState`, and renders the matching table/scale. Thread
`equipment_at_generation` from `PlanOverview` into `SessionDetail`, and render
`<IntensityReference>` below the segment list (`PlanView.tsx:344`) and before the
Status divider (`PlanView.tsx:346`).

## Phase 1: Intensity reference content, component, and wiring

### Overview

Add the static reference data, the toggle component, and the prop threading, then
render it in the session detail.

### Changes Required:

#### 1. Reference content module

**File**: `src/lib/intensity-reference.ts` (new)

**Intent**: Hold the static, generic reference content for all three equipment
types in one typed place, so the component stays purely presentational and the
content is reviewable in isolation. Selection is exhaustive over `EquipmentType`.

**Contract**: Export a structure keyed by `EquipmentType` (`"power_meter" | "hrm" | "none"`). Power and HRM entries are an ordered list of 5 zone rows; the `none` entry is an ordered list of RPE bands. Each zone row carries a zone label (`Z1`–`Z5`), a zone name, a range string, and a short "feel" description. Each RPE band carries a range label (e.g. `1–2`), a name, and a feel description. Include a per-equipment heading/caption string (e.g. "Power zones (% of FTP)", "Heart-rate zones (% of max HR)", "Rate of Perceived Exertion (1–10)"). Use a `Record<EquipmentType, …>` so the type checker enforces all three keys.

Content to encode (5-zone power = % FTP; 5-zone HR = % max HR; RPE 1–10 bands):

| Z   | Power (% FTP) | HR (% max HR) | Name            | Feel                         |
| --- | ------------- | ------------- | --------------- | ---------------------------- |
| Z1  | < 56%         | 50–60%        | Active recovery | Very easy, conversational    |
| Z2  | 56–75%        | 60–70%        | Endurance       | Comfortable, all-day pace    |
| Z3  | 76–90%        | 70–80%        | Tempo           | Moderate, "comfortably hard" |
| Z4  | 91–105%       | 80–90%        | Threshold       | Hard, sustainable ~1 hour    |
| Z5  | > 105%        | 90–100%       | VO₂max          | Very hard, short efforts     |

RPE bands: `1–2` Very easy (recovery) · `3–4` Easy (endurance) · `5–6` Moderate (tempo) · `7–8` Hard (threshold) · `9–10` Very hard (max effort). The Z2/Z4 power figures match the PRD's cited examples (Z2 = 56–75% FTP, Z4 = 91–105% FTP).

#### 2. `IntensityReference` component

**File**: `src/components/plan/PlanView.tsx` (add a new component in this file, near `formatTarget`)

**Intent**: A self-contained, collapsed-by-default reference block. Mirrors the
existing inline-mode pattern (local `useState`) rather than introducing a
disclosure library. Renders the equipment-correct table/scale from the content
module.

**Contract**: `function IntensityReference({ equipment }: { equipment: EquipmentType })`. Holds `const [open, setOpen] = useState(false)`. Renders a `<button type="button">` toggle ("What do these mean?") with `aria-expanded={open}` controlling a region (`aria-controls` / `id` pairing) that, when open, lists the rows for `equipment` from the content module. Visual style matches the surrounding glassmorphic panel (reuse the `border-white/10 bg-white/5` token language already used for segment rows at `PlanView.tsx:335`). Power/HRM render as a small definition table (zone label, range, name + feel); `none` renders the RPE bands the same way. Keep it presentational — no props beyond `equipment`.

#### 3. Thread equipment into `SessionDetail`

**File**: `src/components/plan/PlanView.tsx`

**Intent**: `SessionDetail` needs the equipment type to pick the reference.
Source it from the plan row already in `PlanOverview`'s props.

**Contract**: Add `equipment: EquipmentType` to the `SessionDetail` props (`PlanView.tsx:277-287`). At the call site in `PlanOverview` (`PlanView.tsx:198-204`), pass `equipment={plan.plan.equipment_at_generation}`. Import `EquipmentType` from `@/types` (extend the existing type import block at `PlanView.tsx:8-16`).

#### 4. Render the reference in the detail

**File**: `src/components/plan/PlanView.tsx`

**Intent**: Place the reference where the user reads targets — below the segment
list, before the Status divider.

**Contract**: Insert `<IntensityReference equipment={equipment} />` between the segment `<ol>` (ends `PlanView.tsx:344`) and the Status `<div className="mt-4 … border-t …">` (`PlanView.tsx:346`).

### Success Criteria:

#### Automated Verification:

- Type checking passes (no TS errors from the new prop / `EquipmentType` import / exhaustive `Record`): `npm run build`
- Linting passes: `npm run lint`
- Formatting clean: `npm run format`

#### Manual Verification:

- On `/dashboard` for a **power-meter** plan, expanding a session shows a collapsed "What do these mean?" control below the segments; opening it reveals the 5-row % FTP power table.
- For an **HRM** plan, the reference shows the 5-row % max-HR table, and its `Z1–Z5` labels match the `Z#` shown on the session's segments.
- For a **no-equipment** plan, the reference shows the RPE 1–10 bands.
- The toggle opens and closes; only one concept (the reference) is added — existing Mark done / Skip / log flows are unaffected.
- Reference is reachable by keyboard (button focusable, Enter/Space toggles) and announces expanded/collapsed state to screen readers (`aria-expanded`).
- No regression: collapsing/expanding different days still resets correctly (the `key={expandedSession.id}` remount at `PlanView.tsx:199` also resets the reference's open state).

**Implementation Note**: After completing this phase and all automated
verification passes, pause for manual confirmation from the human that the manual
testing (all three equipment types) was successful before considering the change
done.

---

## Testing Strategy

### Manual Testing Steps:

1. Sign in with (or seed) a profile whose `equipment_type` is `power_meter`; generate/open a plan; expand a session; toggle the reference; confirm the % FTP table.
2. Repeat with an `hrm` profile; confirm the % max-HR table and that zone labels align with segment `Z#` labels.
3. Repeat with a `none` profile; confirm the RPE 1–10 bands.
4. Tab to the toggle, activate with keyboard, confirm it opens/closes and `aria-expanded` flips.
5. Expand day A, open reference, collapse, expand day B — confirm reference starts collapsed for B.

> No test runner is configured in this repo (per CLAUDE.md), so verification is type-check + lint + manual.

## Performance Considerations

Negligible — static content rendered only when a session is expanded and the
toggle is opened. No new network or compute.

## Migration Notes

None. No schema, data, or API changes.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-07)
- PRD: FR-011 (`context/foundation/prd.md:104-105`) and FR-005 challenge (`prd.md:84-85`)
- Integration point: `src/components/plan/PlanView.tsx:277-557`
- Target shapes: `src/lib/plan-schema.ts:21-38`
- Equipment type + plan type: `src/types.ts:44-53`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Intensity reference content, component, and wiring

#### Automated

- [x] 1.1 Type checking passes (`npm run build`) — 72b3628
- [x] 1.2 Linting passes (`npm run lint`) — 72b3628
- [x] 1.3 Formatting clean (`npm run format`) — 72b3628

#### Manual

- [x] 1.4 Power-meter plan shows the 5-row % FTP power table — 72b3628
- [x] 1.5 HRM plan shows the 5-row % max-HR table with labels matching segment `Z#` — 72b3628
- [x] 1.6 No-equipment plan shows the RPE 1–10 bands — 72b3628
- [x] 1.7 Toggle opens/closes; existing done/skip/log flows unaffected — 72b3628
- [x] 1.8 Reference is keyboard- and screen-reader-accessible (`aria-expanded`) — 72b3628
- [x] 1.9 Reference resets to collapsed when switching expanded days — 72b3628
