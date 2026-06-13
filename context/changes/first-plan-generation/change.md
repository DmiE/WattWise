---
change_id: first-plan-generation
title: Generate first 4-week AI plan with equipment-adapted intensity targets
status: implemented
created: 2026-06-10
updated: 2026-06-13
archived_at: null
---

## Notes

Roadmap slice S-02 (north star) — see `context/foundation/roadmap.md`. Prereq S-01 (onboarding-wizard) is done.

Outcome: user confirms onboarding inputs and immediately receives an AI-generated 4-week training plan. Every session shows type, duration, and intensity targets adapted to declared equipment — watts for power-meter users, heart-rate zones for HRM users, RPE descriptions for no-equipment users. Presented as a week-overview with per-session detail.

PRD refs: FR-004, FR-005, FR-006, US-01.

Open unknowns (resolved during implementation, 2026-06-13):
- ~~Prompt structure that reliably yields a correctly structured 4-week plan with equipment-appropriate intensity across all three equipment types.~~ Resolved — versioned system+user prompt builder (`src/lib/plan.ts`) with a zod + equipment/availability trust boundary.
- ~~Which model balances plan quality vs latency within "a normal loading wait".~~ Resolved — `anthropic/claude-sonnet-4.5` via OpenRouter, ~22–23s cold generation.

Decision (S-02): the AI gateway is **OpenRouter** (OpenAI-compatible REST, called with plain `fetch` — no vendor SDK), routing to a config-driven model (`OPENROUTER_MODEL`, currently `anthropic/claude-sonnet-4.5`). This supersedes the earlier "Anthropic SDK" wording in `tech-stack.md`/`roadmap.md`. Rationale: one-string model swap, `models[]`/`route:"fallback"` provider redundancy, and a leaner workerd bundle with no SDK dependency.
