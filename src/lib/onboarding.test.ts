import { describe, expect, it } from "vitest";

import {
  makeEstimatedPowerMeterInput,
  makeHrmInput,
  makeMeasuredPowerMeterInput,
  makeNoneInput,
} from "@/lib/__fixtures__/onboarding-input";
import {
  PROFILE_CHECK_CONSTRAINTS,
  PROFILE_CHECK_NAMES,
  type ProfileCheckColumns,
} from "@/lib/__fixtures__/profile-check-constraints";
import { onboardingInputSchema, type OnboardingInput } from "@/lib/onboarding-schema";
import { toProfileInsert } from "@/lib/onboarding";

// --- Cross-field CHECK truth tables: the onboarding derivation ---
//
// Risk #6's other face. The bounds parity in `onboarding-schema.test.ts` covers
// the columns zod and the database both police; these three constraints are the
// ones **zod does not police at all**. Nothing in `onboarding-schema.ts`
// couples `equipment_type` to `ftp_watts`, `ftp_source`, `fitness_level`, or
// `max_hr` — a payload can satisfy every bound and still describe a row the
// database will reject. `toProfileInsert` (`onboarding.ts:37-86`) is what stands
// between the two, and its docblock (`:4-8`) says so: the derivation rules
// "mirror the `profiles` CHECK constraints … and must run server-side before
// the upsert so a tampered request body can never violate them."
//
// Oracle: the CHECK text in the migration, transcribed as predicates in
// `__fixtures__/profile-check-constraints.ts` (see that file's header for why
// transcription rather than field-by-field expectations).
//
// The input goes through `onboardingInputSchema.parse` first because that is
// the real pipeline — the route validates, then derives
// (`src/pages/api/onboarding.ts:16-49`). The fixtures stay `unknown`, and
// parsing is what turns one into the `OnboardingInput` the derivation takes.

/** Validate a raw fixture into the typed input `toProfileInsert` accepts. Throws if a fixture ever drifts out of the schema. */
function parseInput(raw: unknown): OnboardingInput {
  return onboardingInputSchema.parse(raw);
}

const FIXTURE_USER_ID = "00000000-0000-4000-8000-000000000001";

/**
 * One row per derivation branch of `toProfileInsert`'s `switch`
 * (`onboarding.ts:49-86`). All four, because each writes a different
 * combination of the four cross-field columns and a rule can only be broken one
 * branch at a time.
 */
const DERIVATION_BRANCHES: { branch: string; input: () => unknown }[] = [
  { branch: "measured power meter", input: makeMeasuredPowerMeterInput },
  { branch: "estimated power meter", input: makeEstimatedPowerMeterInput },
  { branch: "hrm", input: makeHrmInput },
  { branch: "none", input: makeNoneInput },
];

/** Every (branch × constraint) pair — the truth table, twelve assertions from two lists. */
const BRANCH_CHECK_PAIRS = DERIVATION_BRANCHES.flatMap(({ branch, input }) =>
  PROFILE_CHECK_NAMES.map((constraint) => ({ branch, constraint, input })),
);

describe("toProfileInsert — every derivation branch satisfies every cross-field CHECK", () => {
  it.each(BRANCH_CHECK_PAIRS)("$branch satisfies $constraint", ({ constraint, input }) => {
    const row = toProfileInsert(parseInput(input()), FIXTURE_USER_ID) satisfies ProfileCheckColumns;

    expect(PROFILE_CHECK_CONSTRAINTS[constraint](row)).toBe(true);
  });
});

// --- The FTP clamp ---
//
// `estimateFtpWatts` (`onboarding.ts:22-25`) multiplies a W/kg figure by body
// weight and clamps the product into the DB's FTP range. The upper clamp is
// reachable and is what keeps a heavy, advanced athlete's estimate inside
// `profiles_ftp_range`:
//
//   `constraint profiles_ftp_range check (ftp_watts is null or ftp_watts between 50 and 600)`
//   — migration `:52`.
//
// The oracle is that range, not `onboarding.ts`'s own `FTP_MAX` constant: the
// question a test should answer is "can this derivation ever hand the database
// a value it will reject", and only the migration can answer it. `600` below is
// the migration's literal.
//
// **The lower clamp is deliberately not tested — it is unreachable, not merely
// uncovered.** `Math.max(50, …)` at `onboarding.ts:24` can never fire: the
// smallest W/kg in the table is 2.0 (beginner) and the smallest legal body
// weight is 30 kg, allowed by both zod's `.min(30)` and
// `profiles_weight_range` (migration `:51`), so the smallest product the
// function can ever compute is `2.0 × 30 = 60` — already above the floor. A
// test for it would assert a dead branch and report coverage it did not earn.
// Recorded in `test-plan.md` §7; re-evaluate if the weight floor or the W/kg
// table ever changes.

/** `profiles_ftp_range`'s upper bound — migration `:52`. */
const DB_FTP_MAX = 600;

describe("toProfileInsert — FTP estimation stays inside the DB range", () => {
  it("clamps an estimate that would exceed the DB maximum down to it", () => {
    // The heaviest, fittest athlete both layers admit: 200 kg is the weight
    // ceiling (migration `:51`) and `advanced` the top fitness level. The raw
    // estimate overshoots 600, so the stored value must be the boundary itself.
    const row = toProfileInsert(
      parseInput(makeEstimatedPowerMeterInput({ weight_kg: 200, fitness_level: "advanced" })),
      FIXTURE_USER_ID,
    );

    expect(row.ftp_watts).toBe(DB_FTP_MAX);
  });

  it.each(DERIVATION_BRANCHES)("$branch derives an ftp_watts the DB range accepts", ({ input }) => {
    const { ftp_watts: ftp } = toProfileInsert(parseInput(input()), FIXTURE_USER_ID);

    // `ftp_watts is null or ftp_watts between 50 and 600` — the whole
    // constraint, null disjunct included, since two branches derive no FTP.
    expect(ftp == null || (ftp >= 50 && ftp <= DB_FTP_MAX)).toBe(true);
  });
});
