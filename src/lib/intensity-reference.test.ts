import { describe, expect, it } from "vitest";

import { INTENSITY_REFERENCE, type IntensityReferenceContent, type ZoneRow } from "@/lib/intensity-reference";
import type { PlanTargetKind } from "@/lib/plan-schema";
import type { EquipmentType } from "@/types";

// --- Legend and target-kind agreement ---
//
// Risk #3 as the cyclist experiences it, on the render side. A session's
// targets are formatted from the **stored** `target.kind`
// (`formatTarget`, `PlanView.tsx:611-621`), while the "What do these mean?"
// legend beside them is picked from `INTENSITY_REFERENCE[equipment]` where
// `equipment` is the plan row's frozen `equipment_at_generation` snapshot
// (`PlanView.tsx:195`, `:553-556`). Two independent sources, and nothing in the
// codebase asserts they agree — so watt targets can appear under a "Heart-rate
// zones (% of max HR)" caption. The formatter itself is correct and exhaustive;
// the gap is the pairing, which is what this file pins.
//
// Oracle:
//
// - PRD FR-005 — "intensity targets adapted to their declared equipment (watts
//   for power meter, heart-rate zones for HRM, RPE for no equipment)"; US-01's
//   acceptance criteria state the same per equipment type, negatively included:
//   "An HRM-only user sees heart-rate zone targets, **never watts**".
// - `context/archive/2026-06-25-intensity-reference/plan.md:19`, `:118` — the
//   legend is per-equipment and is sourced from the **plan snapshot**
//   (`plan.plan.equipment_at_generation`), not the live profile.
// - `context/archive/2026-06-10-first-plan-generation/plan.md:129(a)` — the
//   equipment→target-kind mapping itself (`power_meter`→`watts`, `hrm`→`hr_zone`,
//   `none`→`rpe`).
//
// That last line is the same oracle `plan.test.ts`'s exclusivity matrix cites,
// and the `requiredKind` column below carries the same three literals written
// out by hand. That shared literal is the whole point of the table: the
// validator side and the legend side are bound to one hand-written mapping, so
// changing either source without the other turns a row red.

/**
 * The legend shape each target kind needs, transcribed by hand from
 * `formatTarget` (`PlanView.tsx:611-621`) — the only target formatter in the
 * codebase.
 *
 * `hr_zone` renders as `Z3 · 140–155 bpm`, so its legend must be the zone table
 * that explains what `Z3` means. `rpe` renders as `RPE 5 · <cue>`, so its
 * legend must be the 1–10 scale. `watts` renders as a bare `180–220 W` range
 * with no zone number — see the note on the power table below for why it still
 * pairs with a zone table.
 *
 * Transcribed from the formatter's output shapes rather than imported from
 * `intensity-reference.ts`: this is the independent half of the assertion. A
 * map read out of the module under test would make every row pass by
 * construction.
 */
const LEGEND_KIND_FOR_TARGET_KIND: Record<PlanTargetKind, IntensityReferenceContent["kind"]> = {
  watts: "zones",
  hr_zone: "zones",
  rpe: "rpe",
};

/**
 * One row per equipment type: the target kind that equipment requires, and a
 * caption substring that identifies the legend it must render.
 *
 * `power_meter` and `hrm` both yield `kind: "zones"`, so the kind alone cannot
 * tell them apart — swap the two entries and a kind-only assertion stays green
 * while every HRM cyclist reads their heart rates off a %-of-FTP table. The
 * caption substrings are chosen to be the thing that separates them: "FTP" for
 * power, "max HR" for heart rate.
 */
const LEGEND_CASES: {
  equipment: EquipmentType;
  requiredKind: PlanTargetKind;
  captionSubstring: string;
}[] = [
  { equipment: "power_meter", requiredKind: "watts", captionSubstring: "FTP" },
  { equipment: "hrm", requiredKind: "hr_zone", captionSubstring: "max HR" },
  { equipment: "none", requiredKind: "rpe", captionSubstring: "Perceived Exertion" },
];

/** Every equipment type the enum admits (`src/types.ts:53`), written by hand. */
const EQUIPMENT_TYPES: EquipmentType[] = ["power_meter", "hrm", "none"];

/**
 * The zone rows of a legend entry.
 *
 * Throws when the entry is not a zone table at all, so a row-count assertion
 * can never quietly pass against an RPE entry that has no `rows` property —
 * the same reason `plan.test.ts`'s `rejectionCodes` throws on `ok: true`.
 */
function zoneRows(content: IntensityReferenceContent): ZoneRow[] {
  if (content.kind !== "zones") {
    throw new Error(`Expected a zone-table legend, but the entry is kind: ${content.kind}`);
  }
  return content.rows;
}

describe("INTENSITY_REFERENCE — legend agreement", () => {
  it.each(LEGEND_CASES)(
    "shows a $equipment cyclist the legend that explains their $requiredKind targets",
    ({ equipment, requiredKind, captionSubstring }) => {
      const content = INTENSITY_REFERENCE[equipment];

      expect(content.kind).toBe(LEGEND_KIND_FOR_TARGET_KIND[requiredKind]);
      expect(content.caption).toContain(captionSubstring);
    },
  );

  // Runtime exhaustiveness. The `Record<EquipmentType, …>` annotation
  // (`intensity-reference.ts:53`) is a **compile-time** guarantee only, and it
  // holds against the generated `EquipmentType` — not against the database
  // enum. If `equipment_type` gains a value and `npm run db:types` has not been
  // re-run, the validator stays fail-closed (an unmapped equipment yields no
  // required kind) but this lookup is fail-silent: `content` is `undefined` and
  // the legend renders as a crash or a blank. This test is the thing that says
  // so out loud.
  it("has an entry for exactly the three equipment types and no others", () => {
    expect(Object.keys(INTENSITY_REFERENCE).sort()).toEqual([...EQUIPMENT_TYPES].sort());
  });
});

// --- Legend ↔ schema row correspondence ---
//
// The `Z#` in a rendered `hr_zone` target is looked up by the cyclist in the
// hrm legend's rows, so the two must span the same set. `hrZoneTarget` bounds
// `zone` at `.min(1).max(5)` (`plan-schema.ts:29`), which means zod can emit
// exactly five distinct zone numbers — a legend with four rows leaves a `Z5`
// target unexplained, and one with six advertises a band no plan can contain.
//
// The count `5` is written out by hand from that bound rather than derived from
// it: importing `hrZoneTarget` and reading its max would make the row pass by
// construction, and the whole value of this test is that a change to either
// side alone turns it red.
//
// **Count only.** No assertion here touches a zone's percentage range. The
// bands in the table are a standard 5-zone model authored as static content
// (`intensity-reference.ts:3-8`); no source in this project states which
// percentages are correct for this product, and research questions A1–A3 are
// still open on exactly that. Fabricating expected percentages here would be a
// made-up oracle dressed as a test.
//
// **Deliberately not generalised to power.** The same row-count claim is *not*
// asserted for `power_meter`, and must not be added. Power segments render as a
// bare watt range with no zone number (`formatTarget`, `PlanView.tsx:613-615`),
// so the power table is informational context rather than a direct legend —
// which `intensity-reference.ts:10-12` records as "accepted and PRD-aligned".
// Nothing binds its row count to a schema bound, and asserting one would encode
// a rule no source states.

/** `hrZoneTarget`'s `zone: z.number().int().min(1).max(5)` — `plan-schema.ts:29`. */
const HR_ZONE_COUNT = 5;

describe("INTENSITY_REFERENCE — hrm legend rows", () => {
  it("carries exactly one hrm legend row per heart-rate zone the schema can emit", () => {
    expect(zoneRows(INTENSITY_REFERENCE.hrm)).toHaveLength(HR_ZONE_COUNT);
  });
});
