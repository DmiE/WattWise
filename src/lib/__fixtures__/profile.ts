import type { FitnessLevel, Profile } from "@/types";

// Test fixture: a coherent `profiles` row built from partial overrides.
//
// `Profile` is the full 15-column DB row, so inlining one per test would bury
// the single field a test actually cares about under fourteen irrelevant ones.
// Every default below sits inside the CHECK constraints in
// `supabase/migrations/20260610090000_init_mvp_schema.sql:50-69`, so a fixture
// profile is always one that could really exist in the database.

/**
 * Default weekend cap, deliberately **below 360**.
 *
 * `profiles_weekend_minutes_range` allows up to 600 (migration `:55`), but
 * `planned_duration_min` is hard-capped at 360 by both zod
 * (`plan-schema.ts:68`) and the DB (`:160`). With a weekend cap of 360 or more
 * the `duration_over_cap` branch in `plan.ts:99` is unreachable — zod rejects
 * the over-cap session first with a `schema` issue, and a cap test would pass
 * while asserting the wrong thing. See research A6.
 */
export const FIXTURE_WEEKEND_CAP_MIN = 180;

/** Default workday cap. Below the weekend cap so the two are distinguishable. */
export const FIXTURE_WORKDAY_CAP_MIN = 90;

/** Default available weekdays — a partial week, so "not every day is available" is the normal case. */
export const FIXTURE_AVAILABLE_DAYS = ["mon", "wed", "fri"];

/**
 * Build a valid `Profile` from partial overrides.
 *
 * Defaults describe a power-meter athlete: `equipment_type: "power_meter"`
 * therefore requires `ftp_watts` + `ftp_source` (`power_meter_requires_ftp`),
 * and `ftp_source: "measured"` therefore requires `fitness_level: null`
 * (`fitness_level_matches_ftp_source`). Overriding `equipment_type` alone
 * leaves those companion fields set — pass them explicitly when a test needs a
 * DB-coherent `hrm` or `none` profile.
 */
export function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    user_id: "00000000-0000-4000-8000-000000000001",
    equipment_type: "power_meter",
    goal: "endurance",
    age: 35,
    weight_kg: 75,
    ftp_watts: 250,
    ftp_source: "measured",
    fitness_level: null,
    max_hr: null,
    available_days: [...FIXTURE_AVAILABLE_DAYS],
    max_workday_minutes: FIXTURE_WORKDAY_CAP_MIN,
    max_weekend_minutes: FIXTURE_WEEKEND_CAP_MIN,
    created_at: "2026-01-05T00:00:00.000Z",
    updated_at: "2026-01-05T00:00:00.000Z",
    ...overrides,
  };
}

// --- Equipment variants ---
//
// `makeProfile` deliberately does not derive companion fields from
// `equipment_type` (see its docblock): overriding equipment alone leaves
// `ftp_watts: 250` and `ftp_source: "measured"` in place, producing a row that
// violates `fitness_level_matches_ftp_source` and therefore could not exist in
// the database. A test asserting against such a row proves nothing about real
// behaviour, so the two non-power-meter branches get their own factories rather
// than being spelled out at each call site.
//
// These are additions, not a change of behaviour: `makeProfile`'s defaults,
// signature, and docblock are untouched, so the assertions that depend on
// today's power-meter defaults are unaffected.

/**
 * Default maximum heart rate for the `hrm` variant.
 *
 * Inside `profiles_max_hr_range`, which allows 100–230 (migration `:53`).
 * `hr_zone` fixture targets are built below this value so an HRM fixture pairs
 * with a physiologically plausible target range rather than merely a
 * schema-legal one.
 */
export const FIXTURE_MAX_HR = 185;

/**
 * Default fitness level for both non-power-meter variants.
 *
 * Forced to be non-null by `fitness_level_matches_ftp_source` (migration
 * `:66-69`): with `ftp_source` null, the SQL's `is not distinct from 'measured'`
 * branch is false, so the row can only satisfy the constraint through the second
 * branch — which requires `fitness_level is not null`.
 */
export const FIXTURE_FITNESS_LEVEL: FitnessLevel = "intermediate";

/**
 * Build a DB-coherent `hrm` `Profile`.
 *
 * Three companion fields are not stylistic choices — each is forced by a CHECK
 * constraint once `equipment_type` is `"hrm"`:
 *
 * - `ftp_watts: null` / `ftp_source: null` — an HRM athlete has no FTP.
 *   `power_meter_requires_ftp` (migration `:60-62`) does not demand them here
 *   (its guard is `equipment_type <> 'power_meter'`), and leaving
 *   `makeProfile`'s `"measured"` in place would instead break
 *   `fitness_level_matches_ftp_source`.
 * - `fitness_level: FIXTURE_FITNESS_LEVEL` — required non-null by
 *   `fitness_level_matches_ftp_source` (migration `:66-69`) once `ftp_source`
 *   is null.
 * - `max_hr: FIXTURE_MAX_HR` — required non-null by `hrm_requires_max_hr`
 *   (migration `:63-65`), which is the one constraint that fires *only* for
 *   this equipment type.
 */
export function makeHrmProfile(overrides: Partial<Profile> = {}): Profile {
  return makeProfile({
    equipment_type: "hrm",
    ftp_watts: null,
    ftp_source: null,
    fitness_level: FIXTURE_FITNESS_LEVEL,
    max_hr: FIXTURE_MAX_HR,
    ...overrides,
  });
}

/**
 * Build a DB-coherent `none` (no-equipment) `Profile`.
 *
 * Same companion fields as the `hrm` variant minus the heart-rate monitor:
 *
 * - `ftp_watts: null` / `ftp_source: null` — no power meter, so no FTP;
 *   `power_meter_requires_ftp` (migration `:60-62`) is satisfied by the
 *   equipment guard.
 * - `fitness_level: FIXTURE_FITNESS_LEVEL` — required non-null by
 *   `fitness_level_matches_ftp_source` (migration `:66-69`) once `ftp_source`
 *   is null.
 * - `max_hr: null` — this athlete has no HRM. `hrm_requires_max_hr` (migration
 *   `:63-65`) does not apply, and `profiles_max_hr_range` (`:53`) is satisfied
 *   by its own `max_hr is null` disjunct. It is set explicitly rather than
 *   inherited so the row reads as a deliberate no-equipment profile.
 */
export function makeNoneProfile(overrides: Partial<Profile> = {}): Profile {
  return makeProfile({
    equipment_type: "none",
    ftp_watts: null,
    ftp_source: null,
    fitness_level: FIXTURE_FITNESS_LEVEL,
    max_hr: null,
    ...overrides,
  });
}
