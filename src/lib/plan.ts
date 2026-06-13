import type { EquipmentType, PlanInsert, PlanSessionInsert, Profile } from "@/types";
import type { Usage } from "@/lib/services/openrouter";
import { planSchema, type GeneratedPlan, type PlanTargetKind } from "@/lib/plan-schema";

// Pure plan-generation logic — no I/O. Three concerns:
//   1. prompt building from a profile (`buildPlanMessages`)
//   2. the enforced trust boundary: zod + equipment/availability/duration
//      validation of the raw LLM JSON (`validateGeneratedPlan`)
//   3. mapping a validated plan → DB-ready rows (`toPlanInsert` /
//      `toSessionInserts`)
//
// The transport (OpenRouter `fetch`) lives in `services/openrouter.ts`; the
// orchestration (call → validate → retry → persist) is the Phase 3 route's
// job. This module is deliberately I/O-free so each piece is testable.

// Bump when the prompt changes materially; stamped into `generation_metadata`
// for provenance so a plan can be traced back to the prompt that produced it.
export const PROMPT_VERSION = "1";

// PRD guardrail: intensity targets must match the declared equipment EXACTLY.
// power_meter → watts, hrm → hr_zone, none → rpe. This is the single source of
// truth for that mapping; both the prompt and the validator derive from it.
const EQUIPMENT_TARGET_KIND: Record<EquipmentType, PlanTargetKind> = {
  power_meter: "watts",
  hrm: "hr_zone",
  none: "rpe",
};

// Weekday anchor: day_index 1 is Monday, 2 Tuesday, … 7 Sunday, repeating each
// week. This holds because `start_date` is always the next Monday (see
// `nextMonday` / `toPlanInsert`), so the prompt's fixed mon–sun frame and this
// validator cannot drift.
const WEEKDAY_BY_OFFSET = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const WEEKEND_DAYS = new Set(["sat", "sun"]);

/** Map a 1–28 day_index to its weekday code under the Monday anchor. */
export function weekdayForDayIndex(dayIndex: number): string {
  return WEEKDAY_BY_OFFSET[(dayIndex - 1) % 7];
}

export interface PlanValidationIssue {
  code: "schema" | "equipment_mismatch" | "unavailable_day" | "duration_over_cap" | "duplicate_day";
  message: string;
}

export type PlanValidationResult = { ok: true; plan: GeneratedPlan } | { ok: false; issues: PlanValidationIssue[] };

/**
 * The enforced trust boundary. Runs the parsed-but-unvalidated LLM output
 * through zod, then asserts the four product guardrails against the profile:
 *   (a) every segment target.kind matches the equipment's required kind,
 *   (b) every session's day falls on an available weekday,
 *   (c) planned_duration_min ≤ the day-type cap,
 *   (d) day_index values are unique (and 1–28, already covered by zod).
 *
 * Any failure returns `{ ok: false, issues }` — the orchestrator treats this as
 * retryable, never coerces. A pass returns the typed plan.
 */
export function validateGeneratedPlan(raw: unknown, profile: Profile): PlanValidationResult {
  const parsed = planSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        code: "schema",
        message: `${issue.path.join(".")}: ${issue.message}`,
      })),
    };
  }

  const plan = parsed.data;
  const issues: PlanValidationIssue[] = [];
  const requiredKind = EQUIPMENT_TARGET_KIND[profile.equipment_type];
  const availableDays = new Set(profile.available_days);
  const seenDays = new Set<number>();

  for (const session of plan.sessions) {
    if (seenDays.has(session.day_index)) {
      issues.push({ code: "duplicate_day", message: `Duplicate day_index ${session.day_index}` });
    }
    seenDays.add(session.day_index);

    const weekday = weekdayForDayIndex(session.day_index);
    if (!availableDays.has(weekday)) {
      issues.push({
        code: "unavailable_day",
        message: `Session on day_index ${session.day_index} (${weekday}) is not an available day`,
      });
    }

    const cap = WEEKEND_DAYS.has(weekday) ? profile.max_weekend_minutes : profile.max_workday_minutes;
    if (session.planned_duration_min > cap) {
      issues.push({
        code: "duration_over_cap",
        message: `Session on day_index ${session.day_index} is ${session.planned_duration_min}min, over the ${cap}min cap`,
      });
    }

    for (const segment of session.structure.segments) {
      if (segment.target.kind !== requiredKind) {
        issues.push({
          code: "equipment_mismatch",
          message: `Segment "${segment.label}" on day_index ${session.day_index} uses target "${segment.target.kind}", expected "${requiredKind}"`,
        });
      }
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, plan };
}

// --- Prompt builder ---

function targetUnitInstruction(equipment: EquipmentType): string {
  switch (equipment) {
    case "power_meter":
      return 'Express every segment intensity as a watt range: target.kind="watts" with integer low_watts/high_watts, derived from the athlete\'s FTP.';
    case "hrm":
      return 'Express every segment intensity as a heart-rate zone: target.kind="hr_zone" with an integer zone (1-5) and a low_bpm/high_bpm range derived from the athlete\'s max HR.';
    case "none":
      return 'Express every segment intensity as RPE: target.kind="rpe" with an integer rpe (1-10) and a short description cue. Do NOT reference watts or heart rate.';
  }
}

/** Equipment-relevant athlete metrics, phrased for the user message. */
function athleteMetrics(profile: Profile): string[] {
  const lines: string[] = [];
  if (profile.ftp_watts != null) {
    lines.push(`- FTP: ${profile.ftp_watts} W`);
  }
  if (profile.max_hr != null) {
    lines.push(`- Max heart rate: ${profile.max_hr} bpm`);
  }
  if (profile.fitness_level != null) {
    lines.push(`- Self-reported fitness level: ${profile.fitness_level}`);
  }
  return lines;
}

/**
 * Build the system + user messages for the plan generation call. The system
 * prompt carries the immutable structural rules (weekday anchor, equipment →
 * target-kind mapping, duration/availability constraints); the user message
 * carries this athlete's concrete inputs. Prose, not code — this is the main
 * quality lever and is expected to be tuned during verification.
 */
export function buildPlanMessages(profile: Profile): { system: string; user: string } {
  const requiredKind = EQUIPMENT_TARGET_KIND[profile.equipment_type];

  const system = [
    "You are an expert cycling coach. You design structured, periodized 4-week (28-day) training plans.",
    "",
    "Output a JSON object matching the provided schema: a `sessions` array. Each session is one training day.",
    "",
    "Rules — follow ALL of them exactly:",
    "1. Day anchoring: day_index 1 is a Monday, 2 is Tuesday, 3 Wednesday, 4 Thursday, 5 Friday, 6 Saturday, 7 Sunday. The pattern repeats every 7 days (day_index 8 is again a Monday, and so on through day_index 28).",
    "2. Availability: place sessions ONLY on the athlete's available weekdays. Days not listed are rest days — omit them entirely (no session entry). Never schedule on an unavailable weekday.",
    "3. Duration caps: a session's planned_duration_min must not exceed the workday cap on Mon–Fri, nor the weekend cap on Sat/Sun. planned_duration_min must equal the sum of its segment durations and stay within 15–360 minutes.",
    `4. Intensity unit: this athlete uses target kind "${requiredKind}". ${targetUnitInstruction(profile.equipment_type)} Every segment of every session must use this one kind — never mix kinds.`,
    "5. Periodization: progress load sensibly across the four weeks (e.g. build with a lighter recovery week), varying session_type among endurance, intervals, and recovery to suit the goal.",
    "6. Every session needs a title and at least one segment; each segment needs a label, a duration_min, and a target.",
  ].join("\n");

  const user = [
    "Design a 28-day plan for this athlete:",
    `- Goal: ${profile.goal}`,
    `- Equipment: ${profile.equipment_type} (intensity unit: ${requiredKind})`,
    `- Age: ${profile.age}`,
    `- Weight: ${profile.weight_kg} kg`,
    ...athleteMetrics(profile),
    `- Available weekdays: ${profile.available_days.join(", ")}`,
    `- Max workday (Mon–Fri) session: ${profile.max_workday_minutes} min`,
    `- Max weekend (Sat/Sun) session: ${profile.max_weekend_minutes} min`,
  ].join("\n");

  return { system, user };
}

// --- LLM-output → DB-row mapping ---

/** Metadata stamped into `plans.generation_metadata` for provenance. */
export interface PlanGenerationMetadata {
  model: string;
  usage: Usage;
}

/** Add `days` calendar days to an ISO `YYYY-MM-DD` date, returning ISO. UTC to avoid DST drift. */
export function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * The soonest Monday on or after `from`, as `YYYY-MM-DD`. Anchors day_index 1
 * to a Monday so the prompt's fixed mon–sun frame and `validateGeneratedPlan`
 * agree. (A plan may therefore start up to 6 days out — intentional, not a bug.)
 */
export function nextMonday(from: Date): string {
  const iso = from.toISOString().slice(0, 10);
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  // getUTCDay: 0=Sun … 6=Sat. Monday=1. 0 days out if `from` is already Monday.
  const daysUntilMonday = (1 - date.getUTCDay() + 7) % 7;
  return addDays(iso, daysUntilMonday);
}

/**
 * Build the `plans` insert: status 'active', the 28-day window
 * (end = start + 27, satisfying `plans_28_day_window`), and the
 * `*_at_generation` snapshot columns frozen from the current profile.
 * `start_date` is the next Monday (see `nextMonday`).
 */
export function toPlanInsert(profile: Profile, startDate: string, metadata: PlanGenerationMetadata): PlanInsert {
  return {
    user_id: profile.user_id,
    start_date: startDate,
    end_date: addDays(startDate, 27),
    status: "active",
    goal_at_generation: profile.goal,
    ftp_at_generation: profile.ftp_watts,
    max_hr_at_generation: profile.max_hr,
    fitness_level_at_generation: profile.fitness_level,
    equipment_at_generation: profile.equipment_type,
    generation_metadata: {
      model: metadata.model,
      prompt_version: PROMPT_VERSION,
      usage: { ...metadata.usage },
    },
  };
}

/**
 * Build the `plan_sessions` inserts for a validated plan. Each
 * `scheduled_date = startDate + (day_index - 1)` days, so day_index 1 lands on
 * `startDate` (the Monday) and day_index 28 on `startDate + 27`. `structure`
 * carries the validated `{ segments }`.
 */
export function toSessionInserts(planId: string, validatedPlan: GeneratedPlan, startDate: string): PlanSessionInsert[] {
  return validatedPlan.sessions.map((session) => ({
    plan_id: planId,
    scheduled_date: addDays(startDate, session.day_index - 1),
    day_index: session.day_index,
    session_type: session.session_type,
    planned_duration_min: session.planned_duration_min,
    title: session.title,
    description: session.description ?? null,
    structure: { segments: session.structure.segments },
  }));
}
