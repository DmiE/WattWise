import { describe, expect, it } from "vitest";

import { makePlanPayload, makeSession } from "@/lib/__fixtures__/plan-payload";
import { makeProfile } from "@/lib/__fixtures__/profile";
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
