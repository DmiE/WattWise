import { z } from "zod";

// The validated plan contract for S-02.
//
// Two artifacts live here and must stay consistent:
//   1. `planSchema` — the zod schema that is the *enforced* trust boundary. The
//      raw LLM JSON is `JSON.parse`d then run through this before anything is
//      persisted (see `src/lib/plan.ts` `validateGeneratedPlan`).
//   2. `PLAN_JSON_SCHEMA` — the JSON-Schema object handed to OpenRouter as
//      `response_format.json_schema.schema` (strict mode). It *guides*
//      generation; it is not trusted on its own.
//
// The DB layer only constrains `structure` to `object` + a `segments` key
// (`init_mvp_schema.sql:159-161`) — the segment shape is defined HERE. zod 4,
// mirroring `onboarding-schema.ts` conventions (discriminated unions on a
// literal discriminator).

// Intensity-target discriminator: which unit the segment's intensity is
// expressed in. Exactly one kind is valid per plan, decided by the athlete's
// declared equipment (see `EQUIPMENT_TARGET_KIND` in `plan.ts`).
const wattsTarget = z.object({
  kind: z.literal("watts"),
  low_watts: z.number().int().min(0).max(2000),
  high_watts: z.number().int().min(0).max(2000),
});

const hrZoneTarget = z.object({
  kind: z.literal("hr_zone"),
  zone: z.number().int().min(1).max(5),
  low_bpm: z.number().int().min(30).max(230),
  high_bpm: z.number().int().min(30).max(230),
});

const rpeTarget = z.object({
  kind: z.literal("rpe"),
  rpe: z.number().int().min(1).max(10),
  description: z.string().min(1),
});

// Discriminated on `kind`; the refinement then asserts the low bound never
// exceeds the high bound (a reversed range passes the per-field bounds but is
// nonsense). Refining the union — not the members — keeps each member a plain
// object so the discriminator still resolves cleanly.
export const targetSchema = z
  .discriminatedUnion("kind", [wattsTarget, hrZoneTarget, rpeTarget])
  .refine(
    (t) => (t.kind === "watts" ? t.low_watts <= t.high_watts : t.kind === "hr_zone" ? t.low_bpm <= t.high_bpm : true),
    {
      message: "intensity range low bound must be ≤ high bound",
    },
  );

// A single block within a session (warm-up, interval, recovery, …).
export const segmentSchema = z.object({
  label: z.string().min(1),
  duration_min: z.number().int().min(1).max(360),
  target: targetSchema,
});

export const SESSION_TYPES = ["endurance", "intervals", "recovery"] as const;

// One training day. Bounds mirror the `plan_sessions` CHECK constraints
// (`init_mvp_schema.sql:156-158`) exactly. Rest days are simply omitted — no
// session row.
export const sessionSchema = z.object({
  day_index: z.number().int().min(1).max(28),
  session_type: z.enum(SESSION_TYPES),
  planned_duration_min: z.number().int().min(15).max(360),
  title: z.string().min(1),
  description: z.string().optional(),
  structure: z.object({
    segments: z.array(segmentSchema).min(1),
  }),
});

// The full 4-week plan the model must emit.
export const planSchema = z.object({
  sessions: z.array(sessionSchema).min(1).max(28),
});

export type PlanTarget = z.infer<typeof targetSchema>;
export type PlanTargetKind = PlanTarget["kind"];
export type PlanSegment = z.infer<typeof segmentSchema>;
export type GeneratedSession = z.infer<typeof sessionSchema>;
export type GeneratedPlan = z.infer<typeof planSchema>;
export type SessionStructure = GeneratedSession["structure"];

// --- JSON Schema for OpenRouter `response_format` (strict mode) ---
//
// Strict structured outputs require, at every object level: `additionalProperties:false`
// and every declared property listed in `required`. Discriminated unions are
// expressed with `anyOf` over closed objects, the discriminator pinned via
// `const`. This object must describe the SAME shape as `planSchema` above; zod
// re-validates whatever comes back, so a drift surfaces as a validation failure
// (retryable), never a silent persist.

const WATTS_TARGET_JSON_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", const: "watts" },
    low_watts: { type: "integer", description: "Lower bound of the watt range" },
    high_watts: { type: "integer", description: "Upper bound of the watt range" },
  },
  required: ["kind", "low_watts", "high_watts"],
  additionalProperties: false,
} as const;

const HR_ZONE_TARGET_JSON_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", const: "hr_zone" },
    zone: { type: "integer", description: "Heart-rate zone 1-5" },
    low_bpm: { type: "integer", description: "Lower bound of the heart-rate range in bpm" },
    high_bpm: { type: "integer", description: "Upper bound of the heart-rate range in bpm" },
  },
  required: ["kind", "zone", "low_bpm", "high_bpm"],
  additionalProperties: false,
} as const;

const RPE_TARGET_JSON_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", const: "rpe" },
    rpe: { type: "integer", description: "Rate of perceived exertion, 1-10" },
    description: { type: "string", description: "Short cue for the perceived effort" },
  },
  required: ["kind", "rpe", "description"],
  additionalProperties: false,
} as const;

export const PLAN_JSON_SCHEMA = {
  type: "object",
  properties: {
    sessions: {
      type: "array",
      description: "Training sessions for the 28-day plan. Omit rest days entirely (no entry).",
      items: {
        type: "object",
        properties: {
          day_index: {
            type: "integer",
            description:
              "1-28. day_index 1 is the plan's first Monday; 2 = Tuesday, … 7 = Sunday, then the pattern repeats each week.",
          },
          session_type: { type: "string", enum: [...SESSION_TYPES] },
          planned_duration_min: {
            type: "integer",
            description: "Total session duration in minutes (15-360); must equal the sum of segment durations.",
          },
          title: { type: "string", description: "Short session title" },
          description: { type: "string", description: "One-sentence summary of the session's purpose" },
          structure: {
            type: "object",
            properties: {
              segments: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string", description: "Segment label, e.g. Warm-up, Interval, Recovery" },
                    duration_min: { type: "integer", description: "Segment duration in minutes" },
                    target: {
                      anyOf: [WATTS_TARGET_JSON_SCHEMA, HR_ZONE_TARGET_JSON_SCHEMA, RPE_TARGET_JSON_SCHEMA],
                    },
                  },
                  required: ["label", "duration_min", "target"],
                  additionalProperties: false,
                },
              },
            },
            required: ["segments"],
            additionalProperties: false,
          },
        },
        required: ["day_index", "session_type", "planned_duration_min", "title", "description", "structure"],
        additionalProperties: false,
      },
    },
  },
  required: ["sessions"],
  additionalProperties: false,
} as const;
