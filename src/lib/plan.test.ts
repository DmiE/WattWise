import { describe, expect, it } from "vitest";

import { makePlanPayload } from "@/lib/__fixtures__/plan-payload";
import { makeProfile } from "@/lib/__fixtures__/profile";
import { validateGeneratedPlan, weekdayForDayIndex } from "@/lib/plan";

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
