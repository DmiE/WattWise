# First Plan Generation (S-02) — Plan Brief

> Full plan: `context/changes/first-plan-generation/plan.md`
> Research: `context/changes/first-plan-generation/research.md`

## What & Why

S-02 is the roadmap **north star**: after onboarding, generate a 4-week AI training plan via OpenRouter and show it on the dashboard, with every session's intensity targets adapted to the user's declared equipment (watts / HR zones / RPE). It proves the core product bet — that an AI can turn FTP + goal + availability into a correct, equipment-adapted plan.

## Starting Point

The schema (`plans`, `plan_sessions`) and RLS already exist (F-01); onboarding persists a profile and redirects to a dashboard stub (S-01). There is **no AI integration anywhere** — no SDK, no plan-generation code. The dashboard "your plan is coming" stub is the seam this slice fills.

## Desired End State

A cyclist finishing onboarding lands on `/dashboard`, sees a progress indicator while the plan generates (~10–30s), then a 4-week overview with sessions placed only on their available days. Tapping a session expands its detail with equipment-correct intensity targets. The plan persists under RLS; reloading re-shows it without regenerating.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| AI gateway | OpenRouter via plain `fetch`, no SDK | OpenAI-compatible REST runs natively on workerd; model-swap + fallback without a vendor SDK | Research |
| Model strategy | Config-driven `OPENROUTER_MODEL`; paid Claude in prod | One-string switch (free local / paid prod); hypothesis must be proven on a strong model | Research |
| Trigger | New `POST /api/plans/generate` | Keeps profile-save fast/idempotent; own error surface; reusable for renewal (S-05) | Plan |
| Wait handling | Synchronous request + progress UI | One LLM call fits Worker limits; no job store/polling complexity | Plan |
| Regeneration | Idempotent — return existing active plan | Onboarding happens once; sidesteps the one-active-plan unique index; regen is S-05 | Plan |
| Segment contract | One zod union keyed by target kind (`watts`/`hr_zone`/`rpe`) | Makes the equipment-match guardrail machine-verifiable; extensible for S-07 | Plan |
| Scheduling | AI schedules within `available_days`; server validates | Respects the availability promise while keeping AI periodization quality | Plan |
| Failure handling | Bounded retry → friendly error + retry button | Absorbs flaky structured output; never persists a partial/invalid plan | Plan |
| Equipment match | Hard reject + retry on mismatch (no coercion) | Enforces "intensity must match equipment exactly"; coercion = silently wrong numbers | Plan |
| Plan view | Single dashboard page, expand-in-place detail | One route, matches existing dashboard, fast for a 28-day grid | Plan |

## Scope

**In scope:** OpenRouter env wiring + client; plan/segment zod schema + JSON Schema; prompt builder; LLM-JSON→DB mapping with equipment/availability/duration validation; plan service + idempotent generate endpoint (parent-first RLS insert); dashboard generate-on-load view with progress + week overview + expand-in-place detail + retry; docs reconciliation; cross-equipment E2E.

**Out of scope:** regeneration/supersede (S-05), async/streaming, session-detail route or modal, session tracking (S-03), intensity reference (S-07), profile editing (S-04), SDK, cost dashboard, automated test suite.

## Architecture / Approach

OpenRouter `fetch` client (transport) → pure plan logic (prompt + mapping + validation) → plan service + `POST /api/plans/generate` (idempotent, parent-first persist under RLS) → dashboard `PlanView` island (generate-on-load, progress, overview, expand-in-place). Correctness in layers: LLM `json_schema` constrains generation; `JSON.parse` + zod is the enforced trust boundary (hard-rejects mismatches → retry); DB CHECKs are the backstop.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. AI integration foundation | Env wiring + guarded OpenRouter client | Secret/env wiring drift from the Supabase pattern |
| 2. Plan contract & logic | zod+JSON schema, prompt, LLM→row mapping, validation | Segment/JSON-Schema/zod consistency; prompt quality |
| 3. Service & endpoint | `plan.ts` service + idempotent generate route | Parent-first RLS insert; no orphan plan on failure |
| 4. Dashboard view | Generate-on-load overview + expand-in-place detail | Progress UX for a long sync wait; equipment-correct rendering |
| 5. Docs & E2E | Decision record + cross-equipment verification | False-negative on hypothesis if verified on a weak model |

**Prerequisites:** S-01 done (profile + dashboard seam); an OpenRouter API key + credits for paid-model verification.
**Estimated effort:** ~4–5 sessions across 5 phases (prompt iteration is the main variable).

## Open Risks & Assumptions

- Prompt reliability across all three equipment types is the chief unknown — validated by retry + zod, but plan *quality* (not just validity) needs human review on a paid model.
- A single sync request assumes the LLM call fits comfortably within Worker duration limits at low temperature; bounded `max_tokens` keeps this safe.
- Foundation docs currently say "Anthropic SDK/model" — Phase 5 reconciles this to OpenRouter.

## Success Criteria (Summary)

- A user of each equipment type receives a 4-week plan with targets in the correct unit (watts / HR zones / RPE), sessions only on available days, none over duration caps.
- Exactly one active plan per user; reload re-shows it without regenerating.
- Generation failures show a friendly retry state and persist nothing.
