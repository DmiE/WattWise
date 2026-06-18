import { z } from "zod";
import { commonFields } from "@/lib/onboarding-schema";

// Validation shape for the plan-renewal check-in (POST /api/plans/renew).
//
// The four equipment-independent fields the user can change at renewal, picked
// from `commonFields` so their bounds stay DB-synced from the single source in
// `onboarding-schema.ts`. `ftp_watts` is optional here because equipment gating
// is a route-level, profile-aware rule: the route REQUIRES ftp_watts only when
// the stored profile is `power_meter`, and the client payload never carries
// `equipment_type` (the trust boundary lives server-side, not in this schema).
// `ftp_watts` bounds mirror the DB CHECK / onboarding schema (50–600).

export const renewalInputSchema = commonFields
  .pick({
    goal: true,
    available_days: true,
    max_workday_minutes: true,
    max_weekend_minutes: true,
  })
  .extend({
    ftp_watts: z.number().int().min(50).max(600).optional(),
  });

export type RenewalInput = z.infer<typeof renewalInputSchema>;
