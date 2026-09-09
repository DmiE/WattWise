import type { EquipmentType, FitnessLevel, FtpSource } from "@/types";

// The three cross-field CHECK constraints on `public.profiles`, transcribed
// from the applied migration
// (`supabase/migrations/20260602182721_init_mvp_schema.sql:60-69`) as
// predicates.
//
// **Why these live here and not in `src/lib/`.** These three constraints have
// **no zod counterpart** on any write path. Nothing in `onboarding-schema.ts`
// or `renewal-schema.ts` couples `equipment_type` to `ftp_watts`, `max_hr`, or
// `fitness_level` — the rules are upheld entirely by two hand-written
// derivation functions, `toProfileInsert` (`onboarding.ts:37-86`) and
// `applyRenewal` (`renewal.ts:14-40`), and finally by the database itself. The
// archive verified all four derivation paths against them **by reading, once**
// (`context/archive/2026-06-07-onboarding-wizard/reviews/plan-review.md:22`:
// "4/4 derivation paths satisfy DB CHECK constraints ✓") and never re-ran it.
// This file is that check, automated.
//
// **Transcription is what keeps this out of mirror-implementation territory.**
// Asserting `ftp_source === "estimated"` field by field would just restate
// `toProfileInsert`'s own `switch` in a second place — the test would pass
// against a bug as happily as against correct code. A predicate read off the
// DDL is an independent oracle: it says what the *database* will accept, which
// is the thing the derivation layer exists to guarantee. Nothing here may be
// imported from `onboarding.ts` or `renewal.ts`.
//
// Pre-designed assertions for two of these three already exist, unused, in
// `context/archive/2026-05-31-data-schema-and-rls/plan-brief.md:74`, where
// pgTAP was deferred.

/**
 * The columns the three cross-field CHECKs read.
 *
 * Structural rather than `Profile` or `ProfileInsert` so one predicate covers
 * both the insert path (`toProfileInsert`) and the merged-row path
 * (`applyRenewal`'s `mergedProfile`).
 *
 * `undefined` is admitted alongside `null` because a `ProfileInsert` may simply
 * omit a nullable column, which reaches the database as SQL `NULL` — the two
 * are the same state as far as a CHECK is concerned, so every `is null` test
 * below is written as a `== null` / `!= null` comparison that catches both.
 */
export interface ProfileCheckColumns {
  equipment_type: EquipmentType;
  ftp_watts?: number | null;
  ftp_source?: FtpSource | null;
  fitness_level?: FitnessLevel | null;
  max_hr?: number | null;
}

/**
 * ```sql
 * constraint power_meter_requires_ftp check (
 *   equipment_type <> 'power_meter' or (ftp_watts is not null and ftp_source is not null)
 * )
 * ```
 *
 * Migration `:60-62`. A power-meter athlete must carry both an FTP value and a
 * provenance for it; every other equipment type is unconstrained here.
 */
export function powerMeterRequiresFtp(row: ProfileCheckColumns): boolean {
  return row.equipment_type !== "power_meter" || (row.ftp_watts != null && row.ftp_source != null);
}

/**
 * ```sql
 * constraint hrm_requires_max_hr check (
 *   equipment_type <> 'hrm' or max_hr is not null
 * )
 * ```
 *
 * Migration `:63-65`. The one constraint that fires for exactly one equipment
 * type: without a max HR there is nothing to compute heart-rate zones against.
 */
export function hrmRequiresMaxHr(row: ProfileCheckColumns): boolean {
  return row.equipment_type !== "hrm" || row.max_hr != null;
}

/**
 * ```sql
 * constraint fitness_level_matches_ftp_source check (
 *   (ftp_source is not distinct from 'measured' and fitness_level is null)
 *   or (ftp_source is distinct from 'measured' and fitness_level is not null)
 * )
 * ```
 *
 * Migration `:66-69`. Exactly one of the two branches must hold: a measured FTP
 * means the self-reported fitness level is redundant and must be null; anything
 * else means the fitness level is load-bearing and must be present.
 *
 * **`IS NOT DISTINCT FROM` is null-safe equality, not `=`.** It matters here in
 * one direction only: a NULL `ftp_source` **is** distinct from `'measured'`, so
 * a row with no FTP provenance at all takes the *second* branch and therefore
 * **requires** a non-null `fitness_level`. (Plain SQL `=` would have yielded
 * NULL for that comparison and left both branches unknown.) In JavaScript the
 * null-safe comparison is just `===`, since `null === "measured"` is `false`
 * rather than unknown — the operator differs, the truth table does not.
 */
export function fitnessLevelMatchesFtpSource(row: ProfileCheckColumns): boolean {
  const isMeasured = row.ftp_source === "measured";
  return (isMeasured && row.fitness_level == null) || (!isMeasured && row.fitness_level != null);
}

/**
 * All three cross-field CHECKs, keyed by constraint name so a failure names the
 * constraint the database would have rejected the row on.
 */
export const PROFILE_CHECK_CONSTRAINTS: Record<string, (row: ProfileCheckColumns) => boolean> = {
  power_meter_requires_ftp: powerMeterRequiresFtp,
  hrm_requires_max_hr: hrmRequiresMaxHr,
  fitness_level_matches_ftp_source: fitnessLevelMatchesFtpSource,
};

/** The constraint names, in migration order — the `it.each` column for a truth table over all three. */
export const PROFILE_CHECK_NAMES = Object.keys(PROFILE_CHECK_CONSTRAINTS);
