import type { EquipmentType } from "@/types";

/**
 * Static, generic intensity-reference content shown in the session detail.
 *
 * The values are a standard 5-zone model (power = % of FTP, HR = % of max HR)
 * plus the RPE 1–10 scale — NOT per-athlete bounds. Segments already render the
 * cyclist's personal numbers; this is a "what does that mean?" legend.
 *
 * The HR zones' Z1–Z5 labels line up with the `Z#` shown on `hr_zone` segments.
 * Power segments render bare watts (no zone number), so the power table is
 * informational context rather than a direct legend — accepted and PRD-aligned.
 *
 * Keyed by `EquipmentType` via a `Record` so selection stays exhaustive.
 */

/** One zone row in a power or heart-rate reference table. */
export interface ZoneRow {
  /** Zone label aligned with on-screen `Z#` segment labels. */
  zone: `Z${1 | 2 | 3 | 4 | 5}`;
  /** Zone name, e.g. "Endurance". */
  name: string;
  /** Range string in the equipment's unit, e.g. "56–75% FTP" or "60–70%". */
  range: string;
  /** Short "how it feels" cue. */
  feel: string;
}

/** One band in the RPE 1–10 scale. */
export interface RpeBand {
  /** Range label, e.g. "1–2". */
  range: string;
  /** Band name, e.g. "Easy". */
  name: string;
  /** Short "how it feels" cue. */
  feel: string;
}

interface ZoneReference {
  kind: "zones";
  caption: string;
  rows: ZoneRow[];
}

interface RpeReference {
  kind: "rpe";
  caption: string;
  bands: RpeBand[];
}

export type IntensityReferenceContent = ZoneReference | RpeReference;

export const INTENSITY_REFERENCE: Record<EquipmentType, IntensityReferenceContent> = {
  power_meter: {
    kind: "zones",
    caption: "Power zones (% of FTP)",
    rows: [
      { zone: "Z1", name: "Active recovery", range: "< 56%", feel: "Very easy, conversational" },
      { zone: "Z2", name: "Endurance", range: "56–75%", feel: "Comfortable, all-day pace" },
      { zone: "Z3", name: "Tempo", range: "76–90%", feel: 'Moderate, "comfortably hard"' },
      { zone: "Z4", name: "Threshold", range: "91–105%", feel: "Hard, sustainable ~1 hour" },
      { zone: "Z5", name: "VO₂max", range: "> 105%", feel: "Very hard, short efforts" },
    ],
  },
  hrm: {
    kind: "zones",
    caption: "Heart-rate zones (% of max HR)",
    rows: [
      { zone: "Z1", name: "Active recovery", range: "50–60%", feel: "Very easy, conversational" },
      { zone: "Z2", name: "Endurance", range: "60–70%", feel: "Comfortable, all-day pace" },
      { zone: "Z3", name: "Tempo", range: "70–80%", feel: 'Moderate, "comfortably hard"' },
      { zone: "Z4", name: "Threshold", range: "80–90%", feel: "Hard, sustainable ~1 hour" },
      { zone: "Z5", name: "VO₂max", range: "90–100%", feel: "Very hard, short efforts" },
    ],
  },
  none: {
    kind: "rpe",
    caption: "Rate of Perceived Exertion (1–10)",
    bands: [
      { range: "1–2", name: "Very easy", feel: "Recovery, barely working" },
      { range: "3–4", name: "Easy", feel: "Endurance, can hold a conversation" },
      { range: "5–6", name: "Moderate", feel: "Tempo, breathing deepens" },
      { range: "7–8", name: "Hard", feel: "Threshold, talking is difficult" },
      { range: "9–10", name: "Very hard", feel: "Max effort, unsustainable" },
    ],
  },
};
