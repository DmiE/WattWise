import { describe, expect, it } from "vitest";

import {
  makeEstimatedPowerMeterInput,
  makeHrmInput,
  makeMeasuredPowerMeterInput,
  makeNoneInput,
  type OnboardingInputOverrides,
} from "@/lib/__fixtures__/onboarding-input";
import { onboardingInputSchema } from "@/lib/onboarding-schema";

// --- zod ↔ DB bounds parity ---
//
// Risk #6: input the server accepts that the database rejects — an opaque error
// on write, or a profile stored in a shape the plan generator cannot interpret.
//
// Oracle: the CHECK constraint set in the applied migration
// (`supabase/migrations/20260602182721_init_mvp_schema.sql:50-59`), read
// independently of the schema under test. The direction is stated and
// unambiguous — `context/archive/2026-06-07-onboarding-wizard/plan.md:29`: "The
// DB CHECK constraints are the **source of truth** … the zod schema and the
// wizard must mirror them", reinforced at `:94` ("Bounds must match
// `init_mvp_schema.sql:50-59` exactly") and restated by
// `context/archive/2026-06-18-plan-renewal/research.md:120,187`.
// `onboarding-schema.ts:8-9` claims the bounds "mirror the CHECK constraints
// exactly"; this file turns that claim into a test, and pins the one column
// where it is false.
//
// **No literal in this file may be imported from `onboarding-schema.ts`.**
// Importing the bound under test would make every row pass by construction —
// the mirror-implementation anti-pattern in its purest form. Every number below
// was read out of the migration by hand and carries the line it came from.

/**
 * Parse an input and return the issue paths from the rejection, as dotted strings.
 *
 * Throws when the schema actually accepted the input, so a test that means to
 * assert a rejection can never quietly succeed against an empty issue list —
 * the same guard `plan.test.ts`'s `rejectionCodes` provides. Paths only: zod's
 * message wording and issue ordering are not part of the contract, but *which
 * field* was rejected is, because a row that passed for an unrelated reason
 * would otherwise look identical to one that caught its bound.
 */
function rejectionPaths(input: unknown): string[] {
  const result = onboardingInputSchema.safeParse(input);
  if (result.success) {
    throw new Error("Expected onboardingInputSchema to reject the input, but it parsed successfully");
  }
  return result.error.issues.map((issue) => issue.path.join("."));
}

/**
 * Round a computed probe to three decimals.
 *
 * `30 - 0.01` is `29.990000000000002` in binary floating point. The artifact is
 * far too small to change which side of a bound the probe lands on, but it
 * makes a failure message unreadable, so probes are normalised before use.
 * Nothing here derives a bound — only the arithmetic around one.
 */
function probe(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * One row per bounded numeric column.
 *
 * `min` / `max` are the CHECK literals; `step` is the smallest deviation the
 * column can actually represent, so `min - step` and `max + step` are values
 * the database would genuinely reject (a `smallint` steps by 1; `weight_kg` is
 * `numeric(5,2)`, migration `:40`, so it steps by 0.01).
 *
 * `factory` names the branch that reaches the field: `ftp_watts` and `max_hr`
 * live inside union members (`onboarding-schema.ts:92-120`), not in the common
 * fields, so a row for either has to go through the equipment branch that
 * carries it.
 */
const BOUNDS_CASES: {
  field: string;
  min: number;
  max: number;
  step: number;
  factory: (overrides?: OnboardingInputOverrides) => unknown;
}[] = [
  // `constraint profiles_age_range check (age between 14 and 100)` — migration `:50`.
  { field: "age", min: 14, max: 100, step: 1, factory: makeMeasuredPowerMeterInput },
  // `constraint profiles_weight_range check (weight_kg between 30 and 200)` — migration `:51`.
  { field: "weight_kg", min: 30, max: 200, step: 0.01, factory: makeMeasuredPowerMeterInput },
  // `constraint profiles_ftp_range check (ftp_watts is null or ftp_watts between 50 and 600)` — migration `:52`.
  { field: "ftp_watts", min: 50, max: 600, step: 1, factory: makeMeasuredPowerMeterInput },
  // `constraint profiles_max_hr_range check (max_hr is null or max_hr between 100 and 230)` — migration `:53`.
  { field: "max_hr", min: 100, max: 230, step: 1, factory: makeHrmInput },
  // `constraint profiles_workday_minutes_range check (max_workday_minutes between 15 and 360)` — migration `:54`.
  { field: "max_workday_minutes", min: 15, max: 360, step: 1, factory: makeMeasuredPowerMeterInput },
  // `constraint profiles_weekend_minutes_range check (max_weekend_minutes between 15 and 600)` — migration `:55`.
  { field: "max_weekend_minutes", min: 15, max: 600, step: 1, factory: makeMeasuredPowerMeterInput },
];

describe("onboardingInputSchema — numeric bounds match the DB CHECK constraints", () => {
  // Both boundary sides on every row. An off-by-one is the realistic
  // regression, and it has a direction: a `.min(14)` loosened to `.min(13)` is
  // invisible to a test that only checks 14 is accepted, and a `.max(100)`
  // tightened to `.max(99)` is invisible to a test that only checks 101 is
  // rejected. Four probes per row cover both.
  it.each(BOUNDS_CASES)(
    "rejects $field below $min and above $max, and accepts both bounds",
    ({ field, min, max, step, factory }) => {
      expect(rejectionPaths(factory({ [field]: probe(min - step) }))).toEqual([field]);
      expect(onboardingInputSchema.safeParse(factory({ [field]: min })).success).toBe(true);
      expect(onboardingInputSchema.safeParse(factory({ [field]: max })).success).toBe(true);
      expect(rejectionPaths(factory({ [field]: probe(max + step) }))).toEqual([field]);
    },
  );

  // The fixtures themselves. Every row above states one deviation, which only
  // isolates that deviation if the un-deviated input parses. When this fails,
  // the fixtures drifted — not the schema.
  it.each([
    { label: "measured power meter", factory: makeMeasuredPowerMeterInput },
    { label: "estimated power meter", factory: makeEstimatedPowerMeterInput },
    { label: "hrm", factory: makeHrmInput },
    { label: "none", factory: makeNoneInput },
  ])("accepts the default $label input", ({ factory }) => {
    expect(onboardingInputSchema.safeParse(factory()).success).toBe(true);
  });
});

// --- `available_days`: zod is the sole enforcer, not a mirror (B1/B2) ---
//
// These four rules are **not** parity assertions, and must not be read as
// such. For this column the database is the *looser* layer, so it cannot be the
// oracle:
//
// - **The emptiness rule is dead code in the DB.** `profiles_available_days_valid`
//   (migration `:56-59`) reads `array_length(available_days, 1) between 1 and 7`,
//   but `array_length('{}'::text[], 1)` is `NULL`, `NULL between 1 and 7` is
//   `NULL`, and a CHECK evaluating to `NULL` is **satisfied**. Postgres accepts
//   `available_days = '{}'`. Only zod's `.min(1)` prevents it — and downstream
//   `validateGeneratedPlan` would have no legal day to schedule against.
// - **Day uniqueness is not a DB constraint at all.** `<@` is subset
//   containment, so `['mon','mon','mon']` satisfies `:57` and `array_length` of
//   3 satisfies `:58`. Seven duplicated `'mon'` entries would store as a "valid
//   7-day week". Only zod's `.refine` rejects it.
//
// So these rows assert **zod as the only real guard**. Whether the migration
// should be repaired (a `cardinality(...) >= 1` CHECK) and whether uniqueness
// belongs in the database are open product questions **B1** and **B2** in this
// change's `research.md:416-425`; both were deliberately left unfixed here.
// The subset rule (an unknown day code) *is* enforced on both sides.

describe("onboardingInputSchema — available_days (zod as sole enforcer, B1/B2)", () => {
  it.each([
    // B1: the DB accepts this. zod's `.min(1)` is the only guard.
    { label: "the empty array", days: [] },
    // B2: the DB accepts this. zod's uniqueness `.refine` is the only guard.
    { label: "a repeated day", days: ["mon", "wed", "mon"] },
    // Enforced on both sides: `array_length … between 1 and 7`, migration `:58`.
    { label: "more than seven entries", days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun", "mon"] },
    // Enforced on both sides: the `<@` subset rule, migration `:57`.
    { label: "an unknown day code", days: ["mon", "funday"] },
  ])("rejects $label", ({ days }) => {
    expect(rejectionPaths(makeMeasuredPowerMeterInput({ available_days: days }))).toContainEqual(
      expect.stringContaining("available_days"),
    );
  });

  it.each([
    { label: "a single day", days: ["wed"] },
    { label: "all seven days", days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] },
  ])("accepts $label", ({ days }) => {
    expect(onboardingInputSchema.safeParse(makeMeasuredPowerMeterInput({ available_days: days })).success).toBe(true);
  });
});

// --- Decimal scale: where the two layers genuinely disagree (B4) ---
//
// `weight_kg` is `numeric(5,2)` (migration `:40`) and **Postgres rounds to the
// column's scale before the CHECK runs**. That makes the range CHECK at `:51`
// wider than it looks:
//
// - `200.004` stores as `200.00` → DB-legal, but zod's `.max(200)` rejects it.
// - `29.996` stores as `30.00` → DB-legal, but zod's `.min(30)` rejects it.
// - `70.123456` passes zod and is **silently truncated to `70.12`** — the value
//   the profile echoes back is not the one the cyclist submitted.
//
// The probe values matter: anything the second decimal place can represent
// (`200.01`, `29.99`) is rejected by *both* layers and demonstrates nothing.
// Only a value that rounds *into* the legal range exposes the divergence, which
// is why the parity table above uses a 0.01 step and these cases do not.
//
// Both assertions below are **characterizations of today's behaviour, not
// endorsements**. The archive found and FIXED this exact defect on
// `km_ridden numeric(5,2)`
// (`context/archive/2026-06-15-session-tracking/reviews/plan-review.md:38-46`,
// F2: "a value like 499.999 passes zod yet rounds to 500.00 at the column →
// CHECK violation → the route returns a generic 500 instead of a clean 400 …
// it's a zod/DB mismatch"), and no document records the same analysis being
// applied to `weight_kg`. That decision is open question **B4**
// (`research.md:431-433`). When it is made, these tests turn red — that redness
// is the intended signal, not a regression.

describe("onboardingInputSchema — decimal-scale divergence (B4, characterization)", () => {
  it.each([
    { label: "200.004, which Postgres would round to 200.00 and store", weight: 200.004 },
    { label: "29.996, which Postgres would round to 30.00 and store", weight: 29.996 },
  ])("rejects $label", ({ weight }) => {
    expect(rejectionPaths(makeMeasuredPowerMeterInput({ weight_kg: weight }))).toEqual(["weight_kg"]);
  });

  it("accepts 70.123456, which the numeric(5,2) column silently truncates to 70.12", () => {
    expect(onboardingInputSchema.safeParse(makeMeasuredPowerMeterInput({ weight_kg: 70.123456 })).success).toBe(true);
  });

  // The same failure family one column over. `age` is `smallint` (migration
  // `:39`), and Postgres rounds a fractional input into it just as readily as
  // it rounds a numeric — `35.5` would store as `36`. zod's `.int()` is the
  // only thing standing between the two, and unlike `weight_kg` it closes the
  // gap rather than opening one. Cross-referenced to B4 because it is the same
  // rounding-before-storage shape, not a separate question.
  it("rejects a fractional age, which the smallint column would otherwise round", () => {
    expect(rejectionPaths(makeMeasuredPowerMeterInput({ age: 35.5 }))).toEqual(["age"]);
  });
});
