// Test fixtures: raw onboarding wizard payloads for `onboardingInputSchema`.
//
// Every factory here returns `unknown`, mirroring how the schema actually
// receives its input — `await request.json()` in `POST /api/onboarding`
// (`src/pages/api/onboarding.ts:16-49`). Typing these as `OnboardingInput`
// would let the compiler pre-validate the fixture and the tests would stop
// exercising the untrusted-input path they exist to cover. This is the same
// `unknown`-at-the-boundary rule `plan-payload.ts` states at its head.
//
// Defaults are coherent: every value sits inside every bound declared by the
// `profiles` CHECK constraints in
// `supabase/migrations/20260602182721_init_mvp_schema.sql:50-59`, so a fixture
// input is always one the database would accept. A test therefore expresses
// exactly one deviation, and a failure names it.
//
// There is one factory per `toProfileInsert` derivation branch
// (`src/lib/onboarding.ts:49-86`), because `ftp_watts` and `max_hr` live inside
// union branches rather than in the common fields: a parity row for either of
// those two columns has to name the factory that reaches its branch. Phase 5's
// cross-field CHECK truth tables reuse the same four inputs.

/** Overrides applied on top of a fixture input. Deliberately loose: a test may set a field to a deliberately wrong shape. */
export type OnboardingInputOverrides = Record<string, unknown>;

/**
 * The equipment-independent fields (`onboarding-schema.ts:24-37`), all inside
 * their CHECK ranges: age 14–100 (migration `:50`), weight 30–200 (`:51`),
 * available_days a subset of the seven day codes (`:56-59`), workday minutes
 * 15–360 (`:54`), weekend minutes 15–600 (`:55`).
 */
function commonInputFields(): Record<string, unknown> {
  return {
    goal: "endurance",
    age: 35,
    weight_kg: 75,
    available_days: ["mon", "wed", "fri"],
    max_workday_minutes: 90,
    max_weekend_minutes: 180,
  };
}

/**
 * A power-meter cyclist who knows their FTP (`knows_ftp: true`).
 *
 * The only branch carrying `ftp_watts`, so every `ftp_watts` parity row goes
 * through this factory. Derives to `ftp_source: "measured"` and a null
 * `fitness_level` (`onboarding.ts:54-60`).
 */
export function makeMeasuredPowerMeterInput(overrides: OnboardingInputOverrides = {}): unknown {
  return {
    ...commonInputFields(),
    equipment_type: "power_meter",
    knows_ftp: true,
    ftp_watts: 250,
    ...overrides,
  };
}

/**
 * A power-meter cyclist who does not know their FTP (`knows_ftp: false`).
 *
 * Carries `fitness_level` instead of `ftp_watts`; the server estimates the FTP
 * from fitness level and weight (`onboarding.ts:63-69`).
 */
export function makeEstimatedPowerMeterInput(overrides: OnboardingInputOverrides = {}): unknown {
  return {
    ...commonInputFields(),
    equipment_type: "power_meter",
    knows_ftp: false,
    fitness_level: "intermediate",
    ...overrides,
  };
}

/**
 * An HRM cyclist.
 *
 * The only branch carrying `max_hr`, so every `max_hr` parity row goes through
 * this factory. 185 is inside `profiles_max_hr_range` (migration `:53`) and
 * matches `FIXTURE_MAX_HR` in `profile.ts`, so an input fixture and a profile
 * fixture describe the same athlete.
 */
export function makeHrmInput(overrides: OnboardingInputOverrides = {}): unknown {
  return {
    ...commonInputFields(),
    equipment_type: "hrm",
    max_hr: 185,
    fitness_level: "intermediate",
    ...overrides,
  };
}

/** A cyclist with no equipment. Carries `fitness_level` and nothing else beyond the common fields. */
export function makeNoneInput(overrides: OnboardingInputOverrides = {}): unknown {
  return {
    ...commonInputFields(),
    equipment_type: "none",
    fitness_level: "intermediate",
    ...overrides,
  };
}
