---
change_id: first-plan-generation
title: Generate first 4-week AI plan with equipment-adapted intensity targets
status: implementing
created: 2026-06-10
updated: 2026-06-12
archived_at: null
---

## Notes

Roadmap slice S-02 (north star) — see `context/foundation/roadmap.md`. Prereq S-01 (onboarding-wizard) is done.

Outcome: user confirms onboarding inputs and immediately receives an AI-generated 4-week training plan. Every session shows type, duration, and intensity targets adapted to declared equipment — watts for power-meter users, heart-rate zones for HRM users, RPE descriptions for no-equipment users. Presented as a week-overview with per-session detail.

PRD refs: FR-004, FR-005, FR-006, US-01.

Open unknowns (explorable during planning/impl, non-blocking):
- Prompt structure that reliably yields a correctly structured 4-week plan with equipment-appropriate intensity across all three equipment types.
- Which Anthropic model balances plan quality vs latency within "a normal loading wait".

Note: Anthropic SDK is absent from the baseline — AI integration must be wired in as part of this slice.
