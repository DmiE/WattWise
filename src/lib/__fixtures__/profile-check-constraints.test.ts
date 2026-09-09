import { describe, expect, it } from "vitest";

import {
  fitnessLevelMatchesFtpSource,
  hrmRequiresMaxHr,
  powerMeterRequiresFtp,
} from "@/lib/__fixtures__/profile-check-constraints";

// --- Guarding the oracle itself ---
//
// `onboarding.test.ts` and `renewal.test.ts` assert that every derivation
// branch satisfies all three cross-field CHECKs. Those twelve-plus rows are
// only worth anything if the predicates they assert against are faithful
// transcriptions — a predicate that always returned `true` would pass every
// single row while proving nothing at all.
//
// This is the same role the fixture coherence guard plays for the profile
// factories: when it fails, the *oracle* drifted, not the code under test.
//
// The tables below are derived **by hand from the SQL** in
// `supabase/migrations/20260602182721_init_mvp_schema.sql:60-69`, independently
// of the predicate implementations — deriving them from the predicates would
// make every row pass by construction, which is the mirror-implementation
// anti-pattern one level up.

// `equipment_type <> 'power_meter' OR (ftp_watts IS NOT NULL AND ftp_source IS NOT NULL)`
const POWER_METER_CASES = [
  { et: "power_meter", ftp: 250, src: "measured", sql: true, why: "both present" },
  { et: "power_meter", ftp: null, src: "measured", sql: false, why: "no value" },
  { et: "power_meter", ftp: 250, src: null, sql: false, why: "no provenance" },
  { et: "power_meter", ftp: null, src: null, sql: false, why: "neither" },
  { et: "hrm", ftp: null, src: null, sql: true, why: "guard: not a power meter" },
  { et: "none", ftp: null, src: null, sql: true, why: "guard: not a power meter" },
  { et: "hrm", ftp: 250, src: null, sql: true, why: "guard short-circuits regardless" },
] as const;

// `equipment_type <> 'hrm' OR max_hr IS NOT NULL`
const HRM_CASES = [
  { et: "hrm", hr: 185, sql: true, why: "present" },
  { et: "hrm", hr: null, sql: false, why: "missing" },
  { et: "power_meter", hr: null, sql: true, why: "guard: not an hrm" },
  { et: "none", hr: null, sql: true, why: "guard: not an hrm" },
] as const;

describe("oracle: power_meter_requires_ftp", () => {
  it.each(POWER_METER_CASES)("$et ftp=$ftp src=$src -> $sql ($why)", ({ et, ftp, src, sql }) => {
    expect(powerMeterRequiresFtp({ equipment_type: et, ftp_watts: ftp, ftp_source: src })).toBe(sql);
  });
});

describe("oracle: hrm_requires_max_hr", () => {
  it.each(HRM_CASES)("$et max_hr=$hr -> $sql ($why)", ({ et, hr, sql }) => {
    expect(hrmRequiresMaxHr({ equipment_type: et, max_hr: hr })).toBe(sql);
  });
});

// `(ftp_source IS NOT DISTINCT FROM 'measured' AND fitness_level IS NULL)`
// ` OR (ftp_source IS DISTINCT FROM 'measured' AND fitness_level IS NOT NULL)`
//
// `IS NOT DISTINCT FROM` is null-safe equality, and the two null-`ftp_source`
// rows are the whole reason this table exists: NULL **is** distinct from
// `'measured'`, so a row with no provenance takes the second branch and
// requires a fitness level. Plain SQL `=` would have left both branches
// unknown, and a predicate written with `!=` semantics would get these two
// backwards while still passing every derivation row in `onboarding.test.ts`.
const FITNESS_LEVEL_CASES = [
  { src: null, fl: null, sql: false, why: "no provenance and no level: neither branch holds" },
  { src: null, fl: "intermediate", sql: true, why: "NULL is distinct from measured, so a level is required" },
  { src: "measured", fl: null, sql: true, why: "first branch" },
  { src: "measured", fl: "intermediate", sql: false, why: "a measured FTP must not carry a level" },
  { src: "estimated", fl: null, sql: false, why: "distinct from measured, so a level is required" },
  { src: "estimated", fl: "intermediate", sql: true, why: "second branch" },
] as const;

describe("oracle: fitness_level_matches_ftp_source", () => {
  it.each(FITNESS_LEVEL_CASES)("ftp_source=$src fitness_level=$fl -> $sql ($why)", ({ src, fl, sql }) => {
    expect(fitnessLevelMatchesFtpSource({ equipment_type: "power_meter", ftp_source: src, fitness_level: fl })).toBe(
      sql,
    );
  });
});

// Falsifiability: each predicate must be able to return false, or the
// twelve-row truth table is vacuous.
describe("oracle: every predicate is falsifiable", () => {
  it("power_meter_requires_ftp can fail", () => {
    expect(powerMeterRequiresFtp({ equipment_type: "power_meter" })).toBe(false);
  });
  it("hrm_requires_max_hr can fail", () => {
    expect(hrmRequiresMaxHr({ equipment_type: "hrm" })).toBe(false);
  });
  it("fitness_level_matches_ftp_source can fail", () => {
    expect(fitnessLevelMatchesFtpSource({ equipment_type: "none" })).toBe(false);
  });
});

// undefined must behave as SQL NULL: an omitted column reaches the DB as NULL.
describe("oracle: undefined is treated as NULL", () => {
  it("omitting ftp_watts fails power_meter_requires_ftp exactly as null does", () => {
    expect(powerMeterRequiresFtp({ equipment_type: "power_meter", ftp_source: "measured" })).toBe(
      powerMeterRequiresFtp({ equipment_type: "power_meter", ftp_watts: null, ftp_source: "measured" }),
    );
  });
  it("omitting fitness_level matches null for fitness_level_matches_ftp_source", () => {
    expect(fitnessLevelMatchesFtpSource({ equipment_type: "hrm", ftp_source: null })).toBe(
      fitnessLevelMatchesFtpSource({ equipment_type: "hrm", ftp_source: null, fitness_level: null }),
    );
  });
});
