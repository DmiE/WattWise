import { describe, expect, it } from "vitest";

import { makeHrmProfile, makeNoneProfile, makeProfile } from "@/lib/__fixtures__/profile";
import {
  PROFILE_CHECK_CONSTRAINTS,
  PROFILE_CHECK_NAMES,
  type ProfileCheckColumns,
} from "@/lib/__fixtures__/profile-check-constraints";
import { applyRenewal } from "@/lib/renewal";
import { renewalInputSchema, type RenewalInput } from "@/lib/renewal-schema";
import type { Profile } from "@/types";

// --- Cross-field CHECK truth tables: the renewal derivation ---
//
// The second write path into `profiles`, and the second place the three
// cross-field CHECKs are upheld by hand. `applyRenewal` (`renewal.ts:14-40`)
// merges a validated check-in over the stored profile and returns both the
// merged row and the DB `update`; its docblock (`:8`) states it "mirrors the
// measured branch of `toProfileInsert` … so the resulting row satisfies the
// `fitness_level_matches_ftp_source` CHECK".
//
// Same oracle and the same three predicates as `onboarding.test.ts`, imported
// from the shared transcription in
// `__fixtures__/profile-check-constraints.ts` — one transcription, verified
// against the migration once, applied to both write paths. Neither predicate
// nor expectation comes from `renewal.ts`.
//
// This file also pins the two trust-boundary behaviours the docblock claims
// (`renewal.ts:10-12`), because a claim in a comment is not a guarantee.

/** A raw renewal check-in. Returns `unknown`: the route receives `request.json()`, and parsing is part of the path under test. */
function makeRenewalInput(overrides: Record<string, unknown> = {}): unknown {
  return {
    goal: "endurance",
    available_days: ["mon", "wed", "fri"],
    max_workday_minutes: 90,
    max_weekend_minutes: 180,
    ...overrides,
  };
}

/** Validate a raw check-in into the typed input `applyRenewal` accepts. */
function parseRenewal(raw: unknown): RenewalInput {
  return renewalInputSchema.parse(raw);
}

/**
 * A power-meter profile whose FTP is **estimated**, so `fitness_level` is
 * non-null (`fitness_level_matches_ftp_source`, migration `:66-69`).
 *
 * This is the pre-state that makes the renewal promotion observable. Starting
 * from `makeProfile()`'s default — already `measured` with a null
 * `fitness_level` — would leave nothing for the promotion to change, and a test
 * built on it would stay green even if `applyRenewal` stopped nulling
 * `fitness_level` altogether.
 */
function makeEstimatedPowerMeterProfile(overrides: Partial<Profile> = {}): Profile {
  return makeProfile({ ftp_source: "estimated", fitness_level: "intermediate", ...overrides });
}

/**
 * One row per equipment shape reaching `applyRenewal`. The estimated
 * power-meter row is the load-bearing one: it is the only pre-state where the
 * derivation has to *change* `fitness_level` to keep the CHECK satisfied.
 */
const RENEWAL_CASES: { profileKind: string; profile: () => Profile; input: () => unknown }[] = [
  {
    profileKind: "measured power meter",
    profile: makeProfile,
    input: () => makeRenewalInput({ ftp_watts: 260 }),
  },
  {
    profileKind: "estimated power meter",
    profile: makeEstimatedPowerMeterProfile,
    input: () => makeRenewalInput({ ftp_watts: 260 }),
  },
  { profileKind: "hrm", profile: makeHrmProfile, input: () => makeRenewalInput() },
  { profileKind: "none", profile: makeNoneProfile, input: () => makeRenewalInput() },
];

const RENEWAL_CHECK_PAIRS = RENEWAL_CASES.flatMap(({ profileKind, profile, input }) =>
  PROFILE_CHECK_NAMES.map((constraint) => ({ profileKind, constraint, profile, input })),
);

describe("applyRenewal — the merged profile satisfies every cross-field CHECK", () => {
  it.each(RENEWAL_CHECK_PAIRS)("$profileKind satisfies $constraint", ({ constraint, profile, input }) => {
    const { mergedProfile } = applyRenewal(profile(), parseRenewal(input()));

    expect(PROFILE_CHECK_CONSTRAINTS[constraint](mergedProfile satisfies ProfileCheckColumns)).toBe(true);
  });
});

describe("applyRenewal — confirming an FTP promotes it to measured", () => {
  it("sets ftp_source to measured and nulls the now-redundant fitness_level", () => {
    const { update, mergedProfile } = applyRenewal(
      makeEstimatedPowerMeterProfile(),
      parseRenewal(makeRenewalInput({ ftp_watts: 275 })),
    );

    expect(update.ftp_watts).toBe(275);
    expect(update.ftp_source).toBe("measured");
    // Not incidental: `measured` with a non-null fitness_level is precisely
    // what `fitness_level_matches_ftp_source` forbids, so the null is the
    // constraint being upheld rather than a field being tidied.
    expect(update.fitness_level).toBeNull();
    expect(mergedProfile.fitness_level).toBeNull();
  });

  // The self-correctness guard at `renewal.ts:31-33`. The route already
  // requires `ftp_watts` for power-meter profiles (`renew.ts:83-88`) — but
  // `renewal-schema.ts:22` marks it `.optional()`, so the type system permits
  // the call. Without the throw, `applyRenewal` would emit
  // `ftp_source: "measured"` beside an undefined `ftp_watts` and break
  // `power_meter_requires_ftp` at the database.
  it("throws rather than emit a measured ftp_source with no FTP value", () => {
    expect(() => applyRenewal(makeProfile(), parseRenewal(makeRenewalInput()))).toThrow(/ftp_watts is required/);
  });
});

// --- Trust-boundary absence assertions ---
//
// `renewal.ts:10-12`: "`equipment_type` is read from the STORED profile, never
// from the request body." The renewal payload has no `equipment_type` field at
// all (`renewal-schema.ts:14-23`), and `applyRenewal` must never introduce one
// into the `update` — a renewal that could rewrite equipment would desync the
// live profile from the plan's frozen `equipment_at_generation` snapshot, which
// is Risk #3 reached through the write path.

describe("applyRenewal — equipment is never writable at renewal", () => {
  it.each(RENEWAL_CASES)("$profileKind renewal emits no equipment_type in the update", ({ profile, input }) => {
    const { update } = applyRenewal(profile(), parseRenewal(input()));

    expect(update).not.toHaveProperty("equipment_type");
  });

  // Even when the client tries. Unknown keys are stripped by the schema rather
  // than rejected, so the attempt disappears before `applyRenewal` sees it —
  // this row asserts the outcome, not the mechanism.
  it("ignores an equipment_type smuggled into the request body", () => {
    const { update, mergedProfile } = applyRenewal(
      makeHrmProfile(),
      parseRenewal(makeRenewalInput({ equipment_type: "power_meter" })),
    );

    expect(update).not.toHaveProperty("equipment_type");
    expect(mergedProfile.equipment_type).toBe("hrm");
  });
});

// --- B5: renewal silently discards an FTP from a non-power-meter user ---
//
// `renewal-schema.ts:22` accepts `ftp_watts` from anyone; `applyRenewal` reads
// it only inside `if (profile.equipment_type === "power_meter")`
// (`renewal.ts:25`). An HRM or no-equipment cyclist who submits an FTP gets a
// `200` and no feedback — their input is dropped on the floor.
//
// **Characterization, not endorsement.** Discarding it is safe (the value
// cannot reach a column it does not belong in) but silent, and whether the
// route should instead answer `400` is open question **B5**
// (`research.md:434-435`). Pinned so that a decision to reject turns this red —
// that redness is the signal, not a regression.

describe("applyRenewal — non-power-meter FTP is discarded (B5, characterization)", () => {
  it.each([
    { profileKind: "hrm", profile: makeHrmProfile },
    { profileKind: "none", profile: makeNoneProfile },
  ])("drops an ftp_watts submitted by a $profileKind cyclist without complaint", ({ profile }) => {
    const { update, mergedProfile } = applyRenewal(profile(), parseRenewal(makeRenewalInput({ ftp_watts: 300 })));

    expect(update).not.toHaveProperty("ftp_watts");
    expect(update).not.toHaveProperty("ftp_source");
    expect(mergedProfile.ftp_watts).toBeNull();
  });
});
