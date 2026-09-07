import { describe, expect, it } from "vitest";

import {
  FIXTURE_SESSION_DURATION_MIN,
  makePlanPayload,
  makeSegment,
  makeSession,
} from "@/lib/__fixtures__/plan-payload";
import { FIXTURE_WEEKEND_CAP_MIN, FIXTURE_WORKDAY_CAP_MIN, makeProfile } from "@/lib/__fixtures__/profile";
import {
  validateGeneratedPlan,
  weekdayForDayIndex,
  type PlanValidationIssue,
  type PlanValidationResult,
} from "@/lib/plan";

// Bootstrap assertion. Its job at this phase is to prove the runner resolves
// the `@/*` alias and imports a real project module. The claim itself is
// genuine and stays: `day_index` 1 is anchored to Monday because `start_date`
// is always the next Monday — see context/archive/2026-06-10-first-plan-generation/plan.md:55.
describe("weekdayForDayIndex", () => {
  it("anchors day_index 1 to Monday", () => {
    expect(weekdayForDayIndex(1)).toBe("mon");
  });
});

// Guards the fixtures themselves. Every later test states its deviation as a
// single override, which only isolates that deviation if the un-overridden
// baseline validates. When this test fails, the fixtures drifted — not the
// validator.
describe("plan fixtures", () => {
  it("default payload and profile validate together", () => {
    const result = validateGeneratedPlan(makePlanPayload(), makeProfile());

    expect(result).toEqual({ ok: true, plan: makePlanPayload() });
  });
});

// --- Availability containment ---
//
// Oracle: the archived generation plan and brief state this rule four times,
// always one-directionally — a session may land *only* on a weekday the cyclist
// declared available (`context/archive/2026-06-10-first-plan-generation/plan.md:27,55,129(b)`
// and `plan-brief.md:28,64`). Containment, never coverage: no source requires
// that every declared day carry a session.
//
// The weekday anchor (`day_index` 1 is Monday, repeating every 7 days) is
// spec-stated too, so the expected weekdays below are written out literally. A
// test that derived them by calling `weekdayForDayIndex` would compute its own
// expectation with the code under test, and would keep passing if the anchor
// silently shifted.

/**
 * The issue codes from a rejection.
 *
 * Throws when the validator actually passed, so a test that means to assert a
 * rejection can never quietly succeed against an empty issue list. Codes only —
 * issue `message` wording and issue ordering are not part of the contract.
 */
function rejectionCodes(result: PlanValidationResult): PlanValidationIssue["code"][] {
  if (result.ok) {
    throw new Error("Expected validateGeneratedPlan to reject the plan, but it returned ok: true");
  }
  return result.issues.map((issue) => issue.code);
}

// Every weekday code accepted by `profiles_available_days_valid`
// (`init_mvp_schema.sql:57-60`), used to build a profile that declares
// everything *except* the day under test.
const ALL_WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

// Sampled at all four week boundaries, so an implementation that only anchored
// week 1 correctly cannot pass. Weekdays come from the spec's stated anchor
// (`day_index` 1 = Monday, repeating every 7 days), written out by hand.
const ANCHOR_CASES: { dayIndex: number; weekday: string }[] = [
  { dayIndex: 1, weekday: "mon" },
  { dayIndex: 8, weekday: "mon" },
  { dayIndex: 15, weekday: "mon" },
  { dayIndex: 22, weekday: "mon" },
  { dayIndex: 7, weekday: "sun" },
  { dayIndex: 14, weekday: "sun" },
  { dayIndex: 21, weekday: "sun" },
  { dayIndex: 28, weekday: "sun" },
];

describe("validateGeneratedPlan — availability containment", () => {
  it("rejects a session on a weekday the cyclist did not declare available", () => {
    // day_index 2 is a Tuesday; the fixture profile declares mon/wed/fri only.
    // Duration, segment sum and target kind all stay at their valid defaults,
    // so `unavailable_day` must be the only issue raised.
    const payload = makePlanPayload({ sessions: [makeSession({ day_index: 2 })] });

    const result = validateGeneratedPlan(payload, makeProfile());

    expect(rejectionCodes(result)).toEqual(["unavailable_day"]);
  });

  // Absence assertion — research A4. Containment is one-directional: no source
  // (PRD, plan brief, or generation plan) states a coverage or minimum-session
  // rule, so a plan touching one of three declared days is valid and inventing
  // a rule here would be a fabricated oracle. This test exists to fail loudly
  // if someone later adds a coverage rule without a product decision behind it.
  it("accepts a plan that uses only one of the three declared available days", () => {
    const payload = makePlanPayload({ sessions: [makeSession({ day_index: 1 })] });

    const result = validateGeneratedPlan(payload, makeProfile());

    expect(result).toEqual({ ok: true, plan: payload });
  });
});

describe("validateGeneratedPlan — weekday anchor", () => {
  // Asserted in both directions on the same payload: declaring the day accepts
  // it, declaring every *other* day rejects it. Either direction alone would
  // still pass if availability were ignored outright, or if the anchor were off
  // by a whole week.
  it.each(ANCHOR_CASES)("treats day_index $dayIndex as $weekday in every week", ({ dayIndex, weekday }) => {
    const payload = makePlanPayload({ sessions: [makeSession({ day_index: dayIndex })] });

    const onDeclaredDay = validateGeneratedPlan(payload, makeProfile({ available_days: [weekday] }));
    const onUndeclaredDay = validateGeneratedPlan(
      payload,
      makeProfile({ available_days: ALL_WEEKDAYS.filter((day) => day !== weekday) }),
    );

    expect(onDeclaredDay).toEqual({ ok: true, plan: payload });
    expect(rejectionCodes(onUndeclaredDay)).toEqual(["unavailable_day"]);
  });
});

// --- Duration caps ---
//
// Oracle: the cyclist declares two ceilings, and a session may not exceed the
// one matching its day type — "`planned_duration_min` ≤ the relevant cap
// (`max_weekend_minutes` for sat/sun, else `max_workday_minutes`)"
// (`context/archive/2026-06-10-first-plan-generation/plan.md:55`, restated as
// guardrail (c) at `:129`). The brief's acceptance criterion says the same from
// the cyclist's side: sessions "none over duration caps" (`plan-brief.md:64`).
// A violation is "a hard zod/refinement failure → retry, not a persist"
// (`plan.md:55`) — so the expected result is a rejection, never a clamped value.
//
// The relation is `≤`, which is why a session *exactly at* the cap is expected
// to pass. Both boundary sides are asserted because an off-by-one — a `>`
// weakened to `>=`, or the reverse — is the realistic regression here, and
// either side alone would miss one direction of it.
//
// Cap values come from the fixture profile's declared ceilings, not from
// re-reading the comparison in `plan.ts`.
//
// Research A6 — why no case here raises the weekend cap. `max_weekend_minutes`
// accepts up to 600 (`onboarding-schema.ts:36`, DB `:55`) while
// `planned_duration_min` is hard-capped at 360 by both zod
// (`plan-schema.ts:68`) and the DB (`:160`), so for any weekend cap of 360 or
// more the `duration_over_cap` branch is unreachable: zod rejects the
// over-cap session first and the issue comes back as `schema`. The `cap + 1`
// probe below therefore depends on the fixture cap staying under 360 — raise
// it and these tests would still pass while asserting a different rule. The
// 600-vs-360 contradiction is recorded as a product question, not fixed here.

const CAP_BOUNDARY_CASES: { dayType: string; dayIndex: number; weekday: string; cap: number }[] = [
  { dayType: "workday", dayIndex: 1, weekday: "mon", cap: FIXTURE_WORKDAY_CAP_MIN },
  { dayType: "weekend", dayIndex: 6, weekday: "sat", cap: FIXTURE_WEEKEND_CAP_MIN },
];

/**
 * A duration strictly between the two fixture caps: over the workday ceiling,
 * inside the weekend one. Derived from the profile's declared caps so it stays
 * meaningful if either fixture value moves.
 */
const BETWEEN_CAPS_MIN = Math.round((FIXTURE_WORKDAY_CAP_MIN + FIXTURE_WEEKEND_CAP_MIN) / 2);

describe("validateGeneratedPlan — duration caps", () => {
  it.each(CAP_BOUNDARY_CASES)(
    "accepts a $dayType session of exactly $cap minutes and rejects it one minute over",
    ({ dayIndex, weekday, cap }) => {
      // Only the day under test is declared available, so an `unavailable_day`
      // issue cannot mask — or be mistaken for — the cap result.
      const profile = makeProfile({ available_days: [weekday] });
      const atCap = makePlanPayload({ sessions: [makeSession({ day_index: dayIndex, planned_duration_min: cap })] });
      const overCap = makePlanPayload({
        sessions: [makeSession({ day_index: dayIndex, planned_duration_min: cap + 1 })],
      });

      expect(validateGeneratedPlan(atCap, profile)).toEqual({ ok: true, plan: atCap });
      expect(rejectionCodes(validateGeneratedPlan(overCap, profile))).toEqual(["duration_over_cap"]);
    },
  );

  // The pairing is the point: one duration, two opposite verdicts decided only
  // by the day type. Either cap asserted in isolation would still pass if the
  // ternary at `plan.ts:98` were swapped, because each cap alone is applied
  // consistently — only comparing the two day types exposes the swap. Both
  // weekend days are covered, since a weekend set that lost `sun` would
  // otherwise silently fall back to the stricter workday cap.
  it.each([
    { weekday: "sat", dayIndex: 6 },
    { weekday: "sun", dayIndex: 7 },
  ])(
    "applies the weekend cap on $weekday and the workday cap on mon for the same duration",
    ({ weekday, dayIndex }) => {
      const profile = makeProfile({ available_days: ["mon", weekday] });
      const onWeekend = makePlanPayload({
        sessions: [makeSession({ day_index: dayIndex, planned_duration_min: BETWEEN_CAPS_MIN })],
      });
      const onWorkday = makePlanPayload({
        sessions: [makeSession({ day_index: 1, planned_duration_min: BETWEEN_CAPS_MIN })],
      });

      expect(validateGeneratedPlan(onWeekend, profile)).toEqual({ ok: true, plan: onWeekend });
      expect(rejectionCodes(validateGeneratedPlan(onWorkday, profile))).toEqual(["duration_over_cap"]);
    },
  );
});

// The segment-sum invariant belongs to the cap guardrail rather than sitting
// beside it. `planned_duration_min` is the only number the cap check and the
// dashboard ever read, so if the segments a cyclist actually rides sum to
// something else, the declared figure is fiction and the cap it passed means
// nothing — a 90-minute-capped session whose segments total 150 is an
// over-cap ride that validated. The rule is stated in the prompt (system rule
// 3) and in the JSON-Schema description handed to the model, and the gap
// between those statements and the validator was raised and closed as a
// deliberate fix (`context/archive/2026-06-10-first-plan-generation/reviews/impl-review-phase-2.md:37-43`).
//
// Asserted in both directions: the equality is what makes the declared figure
// trustworthy, and a check weakened to a one-sided comparison would still
// catch one of these two while letting the other through.
const SUM_MISMATCH_CASES: { direction: string; segmentDurations: number[] }[] = [
  { direction: "above", segmentDurations: [FIXTURE_WORKDAY_CAP_MIN, 60] },
  { direction: "below", segmentDurations: [30] },
];

/** Comfortably inside the workday cap — see the note on the test below. */
const DECLARED_DURATION_MIN = FIXTURE_SESSION_DURATION_MIN;

describe("validateGeneratedPlan — segment sum", () => {
  it.each(SUM_MISMATCH_CASES)(
    "rejects a session whose segments sum $direction its declared planned_duration_min",
    ({ segmentDurations }) => {
      // The declared duration sits well inside the workday cap, so the cap
      // check passes on its own and `duration_mismatch` is the only issue
      // expected. Deliberately *not* at the cap boundary: a session declared
      // at exactly the cap makes these tests red under a cap regression too,
      // and a failure named "segments sum above" would then point at the wrong
      // rule. The "above" case still carries the harm this rule exists to
      // catch — 150 minutes of real segments behind a 60-minute declaration,
      // which is a ride well over the 90-minute cap it just passed.
      const payload = makePlanPayload({
        sessions: [
          makeSession({
            day_index: 1,
            planned_duration_min: DECLARED_DURATION_MIN,
            segments: segmentDurations.map((duration_min) => makeSegment({ duration_min })),
          }),
        ],
      });

      const result = validateGeneratedPlan(payload, makeProfile());

      expect(rejectionCodes(result)).toEqual(["duration_mismatch"]);
    },
  );
});

// --- Rejection semantics ---
//
// Oracle: rejection is a decision the archive records explicitly, not an
// accident of the implementation. "Hard reject + retry on mismatch (no
// coercion) … coercion = silently wrong numbers"
// (`context/archive/2026-06-10-first-plan-generation/plan-brief.md:30`), and
// "a violation is a hard zod/refinement failure → retry, not a persist"
// (`plan.md:55`). The orchestrator re-prompts; it never repairs.
//
// This is the property that makes the availability and duration tests above
// mean anything. Those tests prove the validator *notices* a violation. They
// say nothing about what it does next — a validator that noticed an over-cap
// session, clamped it to the cap, and returned `ok: true` would keep every one
// of them green while Risk #1 came true in production: a semantically wrong
// plan persisted, with the wrongness now invisible because the numbers look
// legal. Nothing in the code prevents that refactor today; these tests are what
// prevent it.
//
// Three separable claims, because a lenient refactor could take any one of
// them alone: the rejection is whole-plan (no session is salvaged), no value is
// repaired on the way through, and every violation is reported rather than just
// the first.

describe("validateGeneratedPlan — rejects the whole plan", () => {
  it("returns no plan at all when one session of several is invalid", () => {
    // Two sessions, one of them on a Tuesday the fixture profile never
    // declared. The other is untouched and would validate on its own — which
    // is the point: a "salvage what parses" refactor would return a one-session
    // plan here, and the cyclist would silently receive two thirds of a
    // training week with no indication anything was dropped.
    const payload = makePlanPayload({
      sessions: [makeSession({ day_index: 1 }), makeSession({ day_index: 2 })],
    });

    const result = validateGeneratedPlan(payload, makeProfile());

    expect(rejectionCodes(result)).toEqual(["unavailable_day"]);
    // Asserted on the result shape rather than on a session count: a partial
    // plan cannot be returned if there is no `plan` property to carry it.
    expect(result).not.toHaveProperty("plan");
  });

  it("does not repair an over-cap session, in the result or in the input", () => {
    const overCapMin = FIXTURE_WORKDAY_CAP_MIN + 30;
    const makeOverCapPayload = () =>
      makePlanPayload({
        sessions: [makeSession({ day_index: 1, planned_duration_min: overCapMin })],
      });
    const payload = makeOverCapPayload();

    const result = validateGeneratedPlan(payload, makeProfile());

    expect(rejectionCodes(result)).toEqual(["duration_over_cap"]);
    expect(result).not.toHaveProperty("plan");
    // The caller's payload is checked too, because clamping in place is the
    // cheaper way to write the lenient refactor and would leave the returned
    // result looking exactly as it does now.
    expect(payload).toEqual(makeOverCapPayload());
  });
});

describe("validateGeneratedPlan — issue accumulation", () => {
  // The third claim: the loop reports every violation it finds, rather than
  // returning at the first one. This is a diagnosability guarantee, and it has
  // teeth here because the orchestrator's response to a rejection is to re-send
  // an identical prompt (`src/pages/api/plans/generate.ts:71-77`). A validator
  // that surfaced one violation at a time would need one full model round-trip
  // per problem to work through a plan that had two, and the retry budget is
  // finite — so "first issue only" degrades into a failed generation the
  // cyclist sees, not merely a thinner error list.
  it("reports every violation on a session, not just the first", () => {
    // One session, two independent violations: day_index 2 is a Tuesday the
    // fixture profile never declared, and the duration is one minute over the
    // workday cap. Deliberately not `equipment_mismatch` — target-kind vs
    // declared equipment is Risk #3 and gets its own research pass.
    const payload = makePlanPayload({
      sessions: [makeSession({ day_index: 2, planned_duration_min: FIXTURE_WORKDAY_CAP_MIN + 1 })],
    });

    const codes = rejectionCodes(validateGeneratedPlan(payload, makeProfile()));

    // Sorted, so the assertion is on the set of codes and not on the order the
    // validator happens to push them in. Ordering is not part of the contract.
    expect([...codes].sort()).toEqual(["duration_over_cap", "unavailable_day"]);
  });
});

// Input that fails zod outright, before any guardrail runs. `raw` is whatever
// `JSON.parse` returned from a model response, so these shapes are reachable in
// production, not hypothetical.
const MALFORMED_PAYLOADS: { label: string; payload: unknown }[] = [
  { label: "null", payload: null },
  { label: "an object with no sessions key", payload: {} },
];

describe("validateGeneratedPlan — malformed input", () => {
  // `.safeParse` (`plan.ts:67`) is the only reason these return rather than
  // throw. A refactor to `.parse` would raise a ZodError out of the validator,
  // past the orchestrator's retry branch, and out of the route as a 500 — the
  // cyclist would see a crash where the contract says they should see a retry.
  // Asserting the *return* is therefore the assertion; a throw fails the test
  // by escaping it.
  it.each(MALFORMED_PAYLOADS)("rejects $label with a schema issue rather than throwing", ({ payload }) => {
    const result = validateGeneratedPlan(payload, makeProfile());

    expect(rejectionCodes(result)).toEqual(["schema"]);
    expect(result).not.toHaveProperty("plan");
  });
});
