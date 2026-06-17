import { z } from "zod";

// Shared onboarding validation schema.
//
// Describes the wizard's *input* shape (what the user supplies, before any
// server-side derivation of FTP / max-HR / fitness-level). Bounds mirror the
// `profiles` CHECK constraints in
// `supabase/migrations/20260602182721_init_mvp_schema.sql:50-69` exactly — the
// DB is the source of truth, this schema and the wizard must not drift from it.
//
// Used client-side for per-step gating + review, and server-side for request
// validation in `POST /api/onboarding`.

export const TRAINING_GOALS = ["fitness_health", "endurance", "speed_racing"] as const;
export const FITNESS_LEVELS = ["beginner", "intermediate", "advanced"] as const;
export const DAY_CODES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

const goalSchema = z.enum(TRAINING_GOALS);
const fitnessLevelSchema = z.enum(FITNESS_LEVELS);

// Common, equipment-independent fields. Per-step schemas are derived from this
// via `.pick(...)`, and the full union spreads its `.shape`, so each bound is
// declared exactly once here.
export const commonFields = z.object({
  goal: goalSchema,
  age: z.number().int().min(14).max(100),
  weight_kg: z.number().min(30).max(200),
  available_days: z
    .array(z.enum(DAY_CODES))
    .min(1)
    .max(7)
    .refine((days) => new Set(days).size === days.length, {
      message: "Days must be unique",
    }),
  max_workday_minutes: z.number().int().min(15).max(360),
  max_weekend_minutes: z.number().int().min(15).max(600),
});

// --- Per-step validators (consumed by the wizard to gate "Next") ---

// Step 1: goal only.
export const goalStepSchema = commonFields.pick({ goal: true });

// Step 2: body + availability.
export const bodyStepSchema = commonFields.pick({
  age: true,
  weight_kg: true,
  available_days: true,
  max_workday_minutes: true,
  max_weekend_minutes: true,
});

// Step 3: equipment type + its branch fields (the discriminated part).
//
// The power-meter branch splits again on `knows_ftp`. Zod 4 requires each
// discriminator value to be unique within a discriminated union, so the two
// power-meter variants are modelled as a *nested* discriminated union on
// `knows_ftp` (one `power_meter` member at the equipment level), not two
// top-level members sharing `equipment_type='power_meter'`.
const powerMeterStepBranch = z.discriminatedUnion("knows_ftp", [
  z.object({
    equipment_type: z.literal("power_meter"),
    knows_ftp: z.literal(true),
    ftp_watts: z.number().int().min(50).max(600),
  }),
  z.object({
    equipment_type: z.literal("power_meter"),
    knows_ftp: z.literal(false),
    fitness_level: fitnessLevelSchema,
  }),
]);

export const equipmentStepSchema = z.discriminatedUnion("equipment_type", [
  powerMeterStepBranch,
  z.object({
    equipment_type: z.literal("hrm"),
    max_hr: z.number().int().min(100).max(230),
    fitness_level: fitnessLevelSchema,
  }),
  z.object({
    equipment_type: z.literal("none"),
    fitness_level: fitnessLevelSchema,
  }),
]);

// --- Full input schema (server + review) ---
//
// Composed from the same pieces: each equipment branch spreads the common
// fields so the server validates the complete payload in one pass. Same nested
// `knows_ftp` discriminated union as the step schema, with the common fields
// folded in.
const powerMeterFullBranch = z.discriminatedUnion("knows_ftp", [
  z.object({
    ...commonFields.shape,
    equipment_type: z.literal("power_meter"),
    knows_ftp: z.literal(true),
    ftp_watts: z.number().int().min(50).max(600),
  }),
  z.object({
    ...commonFields.shape,
    equipment_type: z.literal("power_meter"),
    knows_ftp: z.literal(false),
    fitness_level: fitnessLevelSchema,
  }),
]);

export const onboardingInputSchema = z.discriminatedUnion("equipment_type", [
  powerMeterFullBranch,
  z.object({
    ...commonFields.shape,
    equipment_type: z.literal("hrm"),
    max_hr: z.number().int().min(100).max(230),
    fitness_level: fitnessLevelSchema,
  }),
  z.object({
    ...commonFields.shape,
    equipment_type: z.literal("none"),
    fitness_level: fitnessLevelSchema,
  }),
]);

export type OnboardingInput = z.infer<typeof onboardingInputSchema>;
