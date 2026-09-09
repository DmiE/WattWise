import type { PlanTargetKind } from "@/lib/plan-schema";

// Test fixtures: raw generated-plan payloads for `validateGeneratedPlan`.
//
// Every factory here returns `unknown`, mirroring how the validator actually
// receives its input — `JSON.parse` output from an LLM response. Typing these
// as `GeneratedPlan` would let the compiler pre-validate the fixture and the
// tests would stop exercising the untrusted-input path they exist to cover.
//
// Defaults are coherent against `makeProfile()`: sessions land on mon/wed/fri
// (day_index 1/3/5 under the Monday anchor), every duration is inside the
// workday cap, every segment target is `watts` as a power-meter profile
// requires, and each session's segments sum to its `planned_duration_min`.
// A test therefore expresses exactly one deviation, and a failure names it.

/** Overrides for one segment. `target` is `unknown` so tests can pass a deliberately wrong shape. */
export interface SegmentOverrides {
  label?: string;
  duration_min?: number;
  target?: unknown;
}

/** Overrides for one session. `segments` replaces the default segment list wholesale. */
export interface SessionOverrides {
  day_index?: number;
  session_type?: string;
  planned_duration_min?: number;
  title?: string;
  description?: string;
  segments?: unknown[];
}

/** Overrides for the whole payload. `sessions` replaces the default session list wholesale. */
export interface PlanPayloadOverrides {
  sessions?: unknown[];
}

/** Default duration for a fixture session — inside `makeProfile()`'s 90-minute workday cap. */
export const FIXTURE_SESSION_DURATION_MIN = 60;

/** A watts target inside `plan-schema.ts`'s bounds, plausible for the fixture profile's 250 W FTP. */
export function makeWattsTarget(): unknown {
  return { kind: "watts", low_watts: 180, high_watts: 220 };
}

/**
 * An `hr_zone` target inside `hrZoneTarget`'s bounds (`plan-schema.ts:28-32`),
 * plausible for the `hrm` fixture profile: both bpm bounds sit below
 * `FIXTURE_MAX_HR` (185), so the range is one an athlete with that max HR could
 * actually ride rather than merely one the schema accepts.
 */
export function makeHrZoneTarget(): unknown {
  return { kind: "hr_zone", zone: 2, low_bpm: 130, high_bpm: 150 };
}

/**
 * An `rpe` target inside `rpeTarget`'s bounds (`plan-schema.ts:34-38`).
 *
 * `description` is required and non-empty for this kind — it is the only target
 * variant that carries one, which is why an `rpe` target cannot be produced by
 * tweaking a watts one.
 */
export function makeRpeTarget(): unknown {
  return { kind: "rpe", rpe: 4, description: "Conversational effort." };
}

/**
 * Every target kind, keyed by kind, so the exclusivity matrix can be a
 * parameterised table instead of nine near-identical literals.
 *
 * Typed as a `Record` over `PlanTargetKind` so a fourth target kind added to
 * `plan-schema.ts` fails the build here rather than silently leaving a gap in
 * the matrix. The type is imported **type-only**: the factories still return
 * `unknown`, which is what keeps tests exercising the untrusted-input path
 * described at the top of this file.
 */
export const TARGET_FACTORY_BY_KIND: Record<PlanTargetKind, () => unknown> = {
  watts: makeWattsTarget,
  hr_zone: makeHrZoneTarget,
  rpe: makeRpeTarget,
};

/** Build one segment. Defaults to a single watts block covering the whole session. */
export function makeSegment(overrides: SegmentOverrides = {}): unknown {
  return {
    label: overrides.label ?? "Steady",
    duration_min: overrides.duration_min ?? FIXTURE_SESSION_DURATION_MIN,
    target: overrides.target === undefined ? makeWattsTarget() : overrides.target,
  };
}

/**
 * Build one session. The default segment list is derived from the *final*
 * duration, so `makeSession({ planned_duration_min: 91 })` produces a session
 * that is over-cap and nothing else — it does not also trip
 * `duration_mismatch`. Pass `segments` explicitly to break the sum on purpose.
 */
export function makeSession(overrides: SessionOverrides = {}): unknown {
  const duration = overrides.planned_duration_min ?? FIXTURE_SESSION_DURATION_MIN;
  return {
    day_index: overrides.day_index ?? 1,
    session_type: overrides.session_type ?? "endurance",
    planned_duration_min: duration,
    title: overrides.title ?? "Endurance ride",
    description: overrides.description ?? "Steady aerobic ride.",
    structure: { segments: overrides.segments ?? [makeSegment({ duration_min: duration })] },
  };
}

/**
 * Build a full plan payload. The default is three sessions on the fixture
 * profile's three available weekdays, which `validateGeneratedPlan` accepts.
 */
export function makePlanPayload(overrides: PlanPayloadOverrides = {}): unknown {
  return {
    sessions: overrides.sessions ?? [
      makeSession({ day_index: 1, title: "Monday endurance" }),
      makeSession({ day_index: 3, session_type: "intervals", title: "Wednesday intervals" }),
      makeSession({ day_index: 5, session_type: "recovery", title: "Friday recovery" }),
    ],
  };
}
