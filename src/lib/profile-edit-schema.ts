import { z } from "zod";
import { commonFields } from "@/lib/onboarding-schema";

// Validation shape for the post-onboarding profile editor (PATCH /api/profile).
//
// Reuses `commonFields` verbatim — the equipment-independent fields FR-010 lets
// a user edit (goal, age, weight, availability) — so its bounds stay DB-synced
// from the single source in `onboarding-schema.ts`. Decoupled into its own const
// so future divergence from onboarding is cheap. Excludes equipment / FTP /
// fitness-level / max-HR, which are renewal-only (v2 scope).

export const profileEditSchema = commonFields;

export type ProfileEditInput = z.infer<typeof profileEditSchema>;
