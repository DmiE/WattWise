import type { Profile } from "@/types";

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
