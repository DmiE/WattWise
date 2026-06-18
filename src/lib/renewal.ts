import type { Profile, ProfileUpdate } from "@/types";
import type { RenewalInput } from "@/lib/renewal-schema";

// Pure (IO-free) derivation for the renewal check-in. Produces both the
// in-memory merged profile (fed to prompt building + the plan snapshot) and the
// DB `update` object, applying the measured-FTP derivation for power-meter
// users. Mirrors the measured branch of `toProfileInsert` (`onboarding.ts:51-60`)
// so the resulting row satisfies the `fitness_level_matches_ftp_source` CHECK.
//
// Trust boundary: `equipment_type` is read from the STORED profile, never from
// the request body. `ftp_source` / `fitness_level` are derived here, never
// accepted from the client.

export function applyRenewal(
  profile: Profile,
  input: RenewalInput,
): { mergedProfile: Profile; update: Partial<ProfileUpdate> } {
  const update: Partial<ProfileUpdate> = {
    goal: input.goal,
    available_days: input.available_days,
    max_workday_minutes: input.max_workday_minutes,
    max_weekend_minutes: input.max_weekend_minutes,
  };

  if (profile.equipment_type === "power_meter") {
    // Confirming an FTP at renewal promotes it to a measured value; fitness_level
    // must go null to satisfy fitness_level_matches_ftp_source. The route
    // guarantees ftp_watts is present for power-meter profiles before this runs;
    // re-assert it here so applyRenewal stays self-correct (and never emits a
    // measured ftp_source with a null ftp_watts that would break the CHECK).
    if (input.ftp_watts == null) {
      throw new Error("ftp_watts is required to renew a power-meter profile");
    }
    update.ftp_watts = input.ftp_watts;
    update.ftp_source = "measured";
    update.fitness_level = null;
  }

  return { mergedProfile: { ...profile, ...update }, update };
}
