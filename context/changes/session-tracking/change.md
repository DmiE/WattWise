---
change_id: session-tracking
title: Mark plan sessions as done (with log) or skipped
status: implementing
created: 2026-06-15
updated: 2026-06-15
archived_at: null
---

## Notes

Roadmap S-03 (Stream B — session loop). Outcome: user can mark any session as
done — logging actual duration, subjective rating, and km ridden — or as
skipped. Status is persisted and reflected in the plan view.

- PRD refs: FR-007, FR-008
- Prerequisites: S-02 (first-plan-generation) — done
- Parallel with: S-04, S-07
- Unlocks: S-05 (plan-renewal), S-06 (session-history)

Open question to resolve before this ships (Open Roadmap Question #1, owner:
product): UX copy must distinguish "skip" from "defer" to reduce history
pollution — v1 has only done/skipped states, so users wanting to reschedule
will mark sessions skipped and corrupt history. Doesn't block planning, but the
copy decision must be made before S-03 ships.
