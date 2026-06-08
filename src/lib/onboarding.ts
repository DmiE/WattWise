import type { ProfileInsert, FitnessLevel } from "@/types";
import type { OnboardingInput } from "@/lib/onboarding-schema";

// Server-side derivation of authoritative profile fields from validated wizard
// input. These rules mirror the `profiles` CHECK constraints
// (`init_mvp_schema.sql:60-69`) and must run server-side before the upsert so a
// tampered request body can never violate them — see the plan's Critical
// Implementation Details.

// Agreed FTP-estimation table: watts-per-kilogram by self-reported fitness
// level. Tune later if S-02 plan quality suggests otherwise.
const WKG_BY_FITNESS_LEVEL: Record<FitnessLevel, number> = {
  beginner: 2.0,
  intermediate: 2.8,
  advanced: 3.7,
};

const FTP_MIN = 50;
const FTP_MAX = 600;

/** Estimate FTP as `W/kg × weight`, rounded and clamped to the DB range (50–600). */
export function estimateFtpWatts(fitnessLevel: FitnessLevel, weightKg: number): number {
  const raw = Math.round(WKG_BY_FITNESS_LEVEL[fitnessLevel] * weightKg);
  return Math.min(FTP_MAX, Math.max(FTP_MIN, raw));
}

/** Age-predicted max heart rate (220 − age). Used to prefill the HRM input. */
export function defaultMaxHr(age: number): number {
  return 220 - age;
}

/**
 * Map validated wizard input to a `ProfileInsert`, deriving the authoritative
 * FTP / ftp_source / fitness_level / max_hr values per equipment branch so the
 * resulting row satisfies every CHECK constraint.
 */
export function toProfileInsert(input: OnboardingInput, userId: string): ProfileInsert {
  const base = {
    user_id: userId,
    equipment_type: input.equipment_type,
    goal: input.goal,
    age: input.age,
    weight_kg: input.weight_kg,
    available_days: input.available_days,
    max_workday_minutes: input.max_workday_minutes,
    max_weekend_minutes: input.max_weekend_minutes,
  };

  switch (input.equipment_type) {
    case "power_meter":
      if (input.knows_ftp) {
        // Measured FTP: fitness_level stays null (constraint:
        // fitness_level_matches_ftp_source).
        return {
          ...base,
          ftp_watts: input.ftp_watts,
          ftp_source: "measured",
          fitness_level: null,
          max_hr: null,
        };
      }
      // Estimated FTP derived from fitness level + weight.
      return {
        ...base,
        ftp_watts: estimateFtpWatts(input.fitness_level, input.weight_kg),
        ftp_source: "estimated",
        fitness_level: input.fitness_level,
        max_hr: null,
      };
    case "hrm":
      return {
        ...base,
        ftp_watts: null,
        ftp_source: null,
        fitness_level: input.fitness_level,
        max_hr: input.max_hr,
      };
    case "none":
      return {
        ...base,
        ftp_watts: null,
        ftp_source: null,
        fitness_level: input.fitness_level,
        max_hr: null,
      };
  }
}
