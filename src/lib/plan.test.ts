import { describe, expect, it } from "vitest";

import { weekdayForDayIndex } from "@/lib/plan";

// Bootstrap assertion. Its job at this phase is to prove the runner resolves
// the `@/*` alias and imports a real project module. The claim itself is
// genuine and stays: `day_index` 1 is anchored to Monday because `start_date`
// is always the next Monday — see context/archive/2026-06-10-first-plan-generation/plan.md:55.
describe("weekdayForDayIndex", () => {
  it("anchors day_index 1 to Monday", () => {
    expect(weekdayForDayIndex(1)).toBe("mon");
  });
});
