# First Plan Generation (S-02) Implementation Plan

## Overview

Implement the roadmap north star (S-02): after a user completes onboarding, generate a 4-week (28-day) AI training plan via **OpenRouter** (OpenAI-compatible REST, called with plain `fetch` — no SDK), persist it to `plans` + `plan_sessions` under the user's RLS session, and replace the dashboard "plan is coming" stub with a week-overview that expands per-session intensity detail. Every session's intensity targets are adapted to the user's declared equipment: **watts** (power meter), **heart-rate zones** (HRM), or **RPE** (no equipment). This proves the core product hypothesis — that an AI can map FTP + goal + availability into a correct, equipment-adapted plan.

## Current State Analysis

- **No AI integration exists.** No AI/LLM SDK, no HTTP client, no plan-generation code anywhere. `package.json` uses native `fetch` only; workerd supports it natively (`wrangler.jsonc:6-8`, `nodejs_compat`). This slice introduces the first server→external HTTP call.
- **The S-01→S-02 seam is explicit.** The wizard confirm handler posts to `/api/onboarding` (profile upsert only, returns `{ ok: true }`), then `window.location.href = "/dashboard"` (`OnboardingWizard.tsx:157-183`). The dashboard is a static stub: *"Your 4-week plan is coming … check back soon."* (`dashboard.astro:16-22`). S-02 fills both the trigger and the view.
- **The schema pre-encodes the plan contract** (`supabase/migrations/20260602182721_init_mvp_schema.sql`):
  - `plans` — `plans_28_day_window` CHECK requires exactly `end_date - start_date = 27`; partial unique index `one_active_plan_per_user on (user_id) where status='active'`; snapshot columns `goal_at_generation`, `ftp_at_generation`, `max_hr_at_generation`, `fitness_level_at_generation`, `equipment_at_generation` (all NOT NULL except the nullable equipment-specific ones); `generation_metadata jsonb` nullable.
  - `plan_sessions` — `day_index` 1–28 with `(plan_id, day_index)` unique (rest day = **no row**); `scheduled_date` is `plans.start_date + day_index - 1`; `session_type` enum `endurance | intervals | recovery`; `planned_duration_min` 15–360; `title` NOT NULL; `description` nullable; **`structure jsonb NOT NULL`** with the only DB constraint being `jsonb_typeof(structure)='object' AND structure ? 'segments'`. The segment shape is undefined at the DB layer — S-02 defines and zod-validates it.
  - RLS on `plan_sessions` walks up via `EXISTS` to `plans.user_id = auth.uid()` → **insert the parent `plans` row first**, then sessions, all under the user's SSR client. No service-role key exists.
- **Patterns are templated by S-01:**
  - API route — `src/pages/api/onboarding.ts`: `prerender = false`, auth gate (`context.locals.user`), `request.json()` in try/catch → `safeParse` → `z.flattenError()` → 400, per-request `createClient(headers, cookies)` with null→500 guard, `json(body, status)` helper.
  - Service layer — `src/lib/services/profile.ts`: `supabase` injected as first arg (RLS under caller's session); `getProfile(supabase, userId)` available.
  - Derivation — `src/lib/onboarding.ts`: pure server-side mapping (`toProfileInsert`); estimation constants documented and tunable.
  - Schema modules — `src/lib/onboarding-schema.ts`: zod 4, discriminated unions on `equipment_type`.
  - Env/secrets — `src/lib/supabase.ts` reads via `astro:env/server`; `astro.config.mjs` `env.schema` declares secrets; **no `process.env` anywhere in `src/`**.
- **Types are generated** (`src/types.ts`): `Plan`, `PlanInsert`, `PlanSession`, `PlanSessionInsert`, `EquipmentType`, `PlanStatus` exist. `structure` is typed only as `Json` — S-02 supplies its own segment type.

## Desired End State

A cyclist who finishes onboarding lands on `/dashboard`. If they have no active plan, a generation flow runs with continuous visible progress, then the page shows a 4-week overview (4 weeks × day cells) with sessions placed only on their available days. Tapping a session expands its detail inline, showing duration and intensity targets in the equipment-correct unit (watts / HR zones / RPE). The plan and its sessions are persisted under RLS; the intensity targets provably match the declared equipment (zod + DB CHECKs). Returning to the dashboard re-shows the same plan without regenerating.

Verify: a power-meter user sees only watt targets; an HRM user only HR-zone targets; a no-equipment user only RPE targets; sessions never fall on unavailable days; no session exceeds its day's duration cap; exactly one active plan exists per user; a forced LLM/validation failure shows a friendly retry state and persists nothing.

### Key Discoveries:

- OpenRouter is OpenAI-compatible: `POST https://openrouter.ai/api/v1/chat/completions`, `Authorization: Bearer`, `response_format: { type: "json_schema", strict: true }` (`openrouter-docs.md:8-91`). The structured response still arrives as a **string** in `choices[0].message.content` → `JSON.parse` then zod-validate (`openrouter-docs.md:75-76`, `research.md:144`).
- Model is swapped with a single string; the API is uniform across models (`openrouter-docs.md:137`). Free models exist (`:free`, `openrouter/free`) but are "not suitable for production" and risk a false-negative on the hypothesis — verify plan quality on a paid model (`research.md:170-204`).
- `models[]` + `route: "fallback"` and low `temperature` (~0.2–0.4) address the latency/quality NFR (`openrouter-docs.md:140-153`).
- Parent-first insert is mandatory under RLS (`init_mvp_schema.sql:186-194`). One-active-plan unique index means an idempotent "return existing" check sidesteps any conflict (`init_mvp_schema.sql:117`).

## What We're NOT Doing

- **No regeneration / "regenerate plan" affordance** — generation is idempotent (returns the existing active plan if one exists). Regeneration is S-05 (plan-renewal).
- **No supersede-then-insert transaction** — not needed for S-02 (no prior active plan exists at first onboarding). S-05 owns it.
- **No async job store / polling / streaming** — synchronous request with a progress UI.
- **No separate session-detail route or modal** — detail expands in place on the dashboard.
- **No session tracking (done/skipped), no intensity-reference panel, no profile editing** — those are S-03, S-07, S-04.
- **No SDK** — plain `fetch`.
- **No cost/usage dashboard** — token usage is only stamped into `generation_metadata` for provenance.
- **No automated test suite** — the repo has no test runner; verification is typecheck/lint/build + manual.

## Implementation Approach

A thin OpenRouter `fetch` client (Phase 1) is called by pure plan-generation logic (Phase 2: prompt building + LLM-JSON → DB-row mapping + equipment-match validation), orchestrated by a service + idempotent API route (Phase 3), and surfaced by a generate-on-load dashboard island (Phase 4). Correctness is enforced in layers: the LLM `json_schema` constrains generation; `JSON.parse` + zod is the trust boundary (hard-rejects equipment mismatches and availability/duration violations, triggering a bounded retry); the DB CHECKs are the final backstop. Docs are reconciled and the flow is verified end-to-end across all three equipment types (Phase 5).

## Critical Implementation Details

- **Insert ordering & RLS.** The `plans` row MUST be inserted before its `plan_sessions` (RLS on sessions does an `EXISTS` lookup to the parent's `user_id`). All inserts run under the per-request SSR client, never a service-role key. If session insertion fails after the plan row is created, the partial plan must not be left active — delete the just-created plan row (or insert it as a non-active status and flip to `active` only after sessions land) so the idempotent "return existing active plan" check never returns a sessionless plan.
- **`response_format` JSON Schema vs. zod are two separate artifacts.** OpenRouter needs a JSON-Schema object inline in the request; persistence needs a zod schema. Keep them consistent but expect to author both — the JSON Schema guides generation, zod is the enforced boundary. The LLM JSON Schema should describe weeks→sessions→segments with the target discriminator so the model emits the right shape; zod re-checks it.
- **Availability mapping & weekday anchor.** `day_index` 1 is anchored to **Monday** deterministically: `start_date` is set to the next Monday (in `toPlanInsert`/route), so `day_index 1 = 'mon'`, `day_index 2 = 'tue'`, … always. This anchor is stated explicitly in the prompt so the model reasons in fixed mon–sun weeks, and the validator maps the same way — the two cannot drift. Validation must map each session's `day_index` → weekday code (`mon`..`sun`) and assert it is in `profiles.available_days`, and that `planned_duration_min` ≤ the relevant cap (`max_weekend_minutes` for sat/sun, else `max_workday_minutes`). A violation is a hard zod/refinement failure → retry, not a persist.
- **Worker duration.** One low-temperature structured call comfortably fits Worker CPU/duration limits; keep `max_tokens` bounded to the plan size. Do not add `waitUntil`/background work — the request returns the persisted plan (or an error) synchronously.

## Phase 1: AI Integration Foundation

### Overview

Wire the OpenRouter secret + model config the same way Supabase secrets are wired, and build a single reusable, defensively-guarded OpenRouter chat-completion client.

### Changes Required:

#### 1. Environment declaration

**File**: `astro.config.mjs`

**Intent**: Declare `OPENROUTER_API_KEY` (server secret) and `OPENROUTER_MODEL` (server var, not secret) so the model is config-driven (free locally, paid in prod) with no code edit to switch.

**Contract**: Add to `env.schema` alongside `SUPABASE_KEY`: `OPENROUTER_API_KEY: envField.string({ context: "server", access: "secret", optional: true })` and `OPENROUTER_MODEL: envField.string({ context: "server", access: "public", optional: true })`. Read via `astro:env/server`.

#### 2. Local dev env files

**File**: `.env.example`, `.dev.vars`

**Intent**: Document the new vars for Node and Cloudflare workerd local dev; production uses `wrangler secret put OPENROUTER_API_KEY` and a Cloudflare var for `OPENROUTER_MODEL`.

**Contract**: Add `OPENROUTER_API_KEY=` and `OPENROUTER_MODEL=` entries (with a comment naming a verified paid model id and a free fallback id for local dev).

#### 3. OpenRouter client service

**File**: `src/lib/services/openrouter.ts`

**Intent**: A single function that performs a structured chat completion via plain `fetch`, parses the string content, and returns the parsed-but-unvalidated object plus usage metadata. It owns transport concerns only (auth headers, `response_format`, `temperature`, `max_tokens`, optional `models[]`/`route:"fallback"`, bounded retry on transient/non-OK responses), not plan semantics.

**Contract**: Reads `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` from `astro:env/server`. Signature roughly `generateStructured({ system, user, jsonSchema, schemaName }): Promise<{ content: unknown; usage: {...}; model: string }>`. Returns a typed error / throws a tagged error when the key is absent (mirrors `supabase.ts` null-guard intent) so the route can map it to a generic 500. POSTs to `https://openrouter.ai/api/v1/chat/completions` with `Authorization: Bearer`, `response_format: { type: "json_schema", json_schema: { name, strict: true, schema } }`, low `temperature`. Parses `JSON.parse(data.choices[0].message.content)`.

### Success Criteria:

#### Automated Verification:

- [ ] Type checking passes: `npm run lint` (type-checked ESLint)
- [ ] Production build succeeds: `npm run build`
- [ ] No `process.env` introduced; secrets read via `astro:env/server`

#### Manual Verification:

- [ ] With `OPENROUTER_API_KEY` set in `.dev.vars`, a manual invocation of the client returns parsed JSON for a trivial schema
- [ ] With the key absent, the client fails closed (no crash, surfaces a guardable error)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding.

---

## Phase 2: Plan Contract & Generation Logic

### Overview

Define the validated plan/segment contract, build the prompt from a profile, and map the LLM's JSON into DB-ready rows with full equipment-match and availability/duration validation. All pure functions — no I/O.

### Changes Required:

#### 1. Plan & segment zod schema

**File**: `src/lib/plan-schema.ts`

**Intent**: Define the segment contract as a discriminated union on target kind, the session shape, and the full 4-week plan shape the LLM must emit; plus the matching JSON-Schema object for `response_format`. zod is the enforced trust boundary.

**Contract**: A segment is `{ label: string; duration_min: number; target: Watts | HrZone | Rpe }` where the discriminator is `target.kind`: `"watts"` (e.g. low/high watt range), `"hr_zone"` (zone number + bpm range), `"rpe"` (1–10 + description). A session is `{ day_index: 1..28; session_type: endurance|intervals|recovery; planned_duration_min: 15..360; title: string; description?: string; structure: { segments: Segment[] } }`. The plan is `{ sessions: Session[] }` (rest days simply omitted). Export both the zod schema and a `PLAN_JSON_SCHEMA` constant (the JSON-Schema object passed to OpenRouter). zod 4, mirroring `onboarding-schema.ts` conventions.

#### 2. Equipment-match + availability refinement

**File**: `src/lib/plan-schema.ts` (refinement) or `src/lib/plan.ts`

**Intent**: Enforce the PRD guardrail "intensity targets must match declared equipment exactly" and the availability promise — hard reject, never coerce.

**Contract**: A validator that, given the parsed plan + the profile, asserts: (a) every segment's `target.kind` equals the kind required by `equipment_type` (`power_meter`→`watts`, `hrm`→`hr_zone`, `none`→`rpe`); (b) every session's `day_index`→weekday is in `available_days`; (c) `planned_duration_min` ≤ the day-type cap (`max_weekend_minutes` for sat/sun else `max_workday_minutes`); (d) `day_index` values are unique and within 1–28. Any failure returns a structured "invalid plan" result that the orchestrator treats as retryable.

#### 3. Prompt builder

**File**: `src/lib/plan.ts`

**Intent**: Build the `system` + `user` messages from a `Profile`, instructing the model to produce a 28-day plan placing sessions only on available days, respecting duration caps, periodizing across weeks, and emitting intensity targets in the unit matching the equipment. The prompt is the main quality lever and is expected to be iterated during impl.

**Contract**: `buildPlanMessages(profile: Profile): { system: string; user: string }`. System prompt carries the structural rules, the equipment→target-kind mapping, and the **weekday anchor**: state that `day_index 1` is Monday, `day_index 2` Tuesday, … `day_index 7` Sunday (and so on per week), so the model places sessions on `available_days` against a fixed mon–sun frame — no per-request weekday plumbing needed since `start_date` is always a Monday (see "LLM-output → DB-row mapping"). User message carries the concrete inputs (goal, FTP or max_hr or fitness_level, age, weight, available_days, duration caps). No code snippet — prose prompt, tuned during verification.

#### 4. LLM-output → DB-row mapping

**File**: `src/lib/plan.ts`

**Intent**: Convert a validated plan + profile + a chosen `start_date` into a `PlanInsert` and `PlanSessionInsert[]`, computing `scheduled_date`, snapshotting `*_at_generation`, and setting `end_date = start_date + 27`.

**Contract**: `toPlanInsert(profile, startDate, metadata): PlanInsert` (sets `status:'active'`, snapshot columns from profile, `generation_metadata` = `{ model, prompt_version, usage }`) and `toSessionInserts(planId, profile, validatedPlan, startDate): PlanSessionInsert[]` (each `scheduled_date = startDate + day_index - 1`, `structure` carrying `{ segments }`). `start_date` is the **next Monday** (computed in the route/`toPlanInsert`), anchoring `day_index 1 = 'mon'` so the prompt's fixed mon–sun frame and the validator agree; documented in a comment. (Plan may therefore begin up to 6 days out — an intentional product nuance, not a bug.)

### Success Criteria:

#### Automated Verification:

- [ ] Type checking + lint pass: `npm run lint`
- [ ] Build succeeds: `npm run build`
- [ ] `PLAN_JSON_SCHEMA` is a valid JSON-Schema object (`additionalProperties: false`, `required` set) consistent with the zod schema

#### Manual Verification:

- [ ] Feeding a hand-written valid plan for each equipment type through the validator passes; a deliberately mismatched target kind is rejected
- [ ] A session placed on an unavailable day, and one exceeding its duration cap, are each rejected
- [ ] `toSessionInserts` produces correct `scheduled_date` for `day_index` 1 and 28

**Implementation Note**: After automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: Service & Generate Endpoint

### Overview

Add the plan data-access service and the idempotent `POST /api/plans/generate` route that orchestrates generate → validate → bounded retry → parent-first persist under RLS.

### Changes Required:

#### 1. Plan service

**File**: `src/lib/services/plan.ts`

**Intent**: Data-access for plans under the caller's RLS session, mirroring `profile.ts` (supabase injected first arg). Provides the idempotency read and the parent-first transactional-ish write.

**Contract**: `getActivePlan(supabase, userId): Promise<Plan | null>` (select where `status='active'`). `getPlanWithSessions(supabase, planId)` returning the plan + ordered sessions for rendering. `persistPlan(supabase, planInsert, sessionInsertsFactory): Promise<{ plan: Plan } | { error }>` — insert the plan row, then sessions (factory receives the new `plan.id`); on session-insert failure, delete the orphan plan row so no sessionless active plan survives (see Critical Implementation Details). **Treat a plans-insert unique violation (`one_active_plan_per_user`, PG `23505`) as an idempotent win, not an error**: re-query `getActivePlan` and return that existing plan, so a lost-the-race request still gets `200` + the plan rather than a 500.

#### 2. Generate API route

**File**: `src/pages/api/plans/generate.ts`

**Intent**: The single entry point the dashboard calls. Idempotent, auth-gated, returns the persisted plan (or the pre-existing active plan) as JSON, or a friendly error.

**Contract**: `prerender = false`; `POST` handler mirroring `onboarding.ts` scaffolding (auth gate → per-request `createClient` null-guard → `json()` helper). Flow: if `getActivePlan` returns a plan → return it `200` (idempotent, no LLM call). Else load profile via `getProfile` (404/409 if missing), build messages, call the OpenRouter client, `JSON.parse`→zod-validate→equipment/availability-validate; on invalid or transient failure retry up to N times (optionally via `models[]`/`route:"fallback"`); on success `persistPlan` and return the plan; if `persistPlan` reports a `23505` race it has already re-queried and returns the existing plan (`200`), closing the TOCTOU window between the `getActivePlan` read and the insert; on exhaustion return a generic `502/500` error (no constraint-name leakage). Stamp `generation_metadata`.

### Success Criteria:

#### Automated Verification:

- [ ] Lint + type check pass: `npm run lint`
- [ ] Build succeeds: `npm run build`
- [ ] Route exports `prerender = false` and uppercase `POST`

#### Manual Verification:

- [ ] First call for a profile generates and persists exactly one active plan with sessions; second call returns the same plan without a new LLM call
- [ ] Forcing invalid output (e.g. temporarily pointing at a weak/free model or a broken schema) triggers retries then a friendly error, and persists nothing (no orphan plan row)
- [ ] RLS holds: the row's `user_id` is the caller; sessions resolve via the parent
- [ ] Exactly one row in `one_active_plan_per_user` after repeated calls

**Implementation Note**: After automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 4: Dashboard Plan View

### Overview

Replace the dashboard stub with a server-rendered active-plan check plus a React island that generates-on-load (with progress UI) when no plan exists, then renders the week overview with expand-in-place session detail and equipment-correct target formatting, including a failure/retry state.

### Changes Required:

#### 1. Dashboard server render

**File**: `src/pages/dashboard.astro`

**Intent**: Fetch the active plan (with sessions) server-side and pass it to the island; when none exists, render the island in "generate" mode.

**Contract**: Uses `Astro.locals.user` + a per-request supabase client to call `getPlanWithSessions`/`getActivePlan`. Renders `<PlanView client:load plan={...} />` (plan may be null → island triggers generation). Replaces the static "plan is coming" block (`dashboard.astro:16-22`); keep the layout/sign-out shell.

#### 2. Plan view island

**File**: `src/components/plan/PlanView.tsx` (+ any small subcomponents/hooks under `src/components/plan/` or `src/components/hooks/`)

**Intent**: The interactive plan UI. When `plan` is null, POST to `/api/plans/generate`, showing a single indeterminate animated indicator + reassuring copy (the "continuous visible feedback" NFR) for the ~10–30s wait — the request is one opaque fetch with no streaming/events, so there are no real stages to report; on success render the plan; on failure show a friendly message + retry button. When a plan is present, render a 4-week overview (4 weeks × 7 day cells, rest days empty) and expand a session's detail in place on tap.

**Contract**: Props `{ plan: PlanWithSessions | null }`. Detail rendering branches on the segment `target.kind` to format watts / HR zone / RPE. Uses `cn()` for class merging and existing `ui/` primitives (e.g. `Progress`). No new route; expansion is local state. Failure state re-enables the generate action (idempotent endpoint makes retry safe). **Guard generate-on-load against double-fire**: use an in-flight ref (and/or AbortController) so React 19 StrictMode's double-invoked effect, rapid reloads, or multi-tab don't issue two concurrent POSTs; disable the trigger while a request is running. (The route's `23505`-as-idempotent-win handles any race that still slips through.)

#### 3. Shared view types

**File**: `src/types.ts` (or a local module)

**Intent**: Expose the segment/plan view types so the island renders type-safely (the DB `structure` is only `Json`).

**Contract**: Re-export or derive a `PlanWithSessions` type and the segment union (from `plan-schema.ts`) for client use.

### Success Criteria:

#### Automated Verification:

- [ ] Lint + type check pass: `npm run lint`
- [ ] Build succeeds: `npm run build`
- [ ] No Next.js directives; hooks (if any) under `src/components/hooks/`

#### Manual Verification:

- [ ] Completing onboarding lands on `/dashboard`, shows progress, then the plan
- [ ] Week overview shows sessions only on available days; rest days are empty
- [ ] Expanding a session shows watts (power), HR zones (HRM), or RPE (none) — verified by creating a profile of each type
- [ ] Reloading the dashboard shows the same plan instantly (no regeneration, no progress UI)
- [ ] A forced generation failure shows the retry state; retrying succeeds
- [ ] Responsive/legible on a mobile-width viewport

**Implementation Note**: After automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 5: Docs Reconciliation & End-to-End Verification

### Overview

Record the OpenRouter-over-Anthropic-SDK decision so the foundation docs stop disagreeing, and run a full cross-equipment end-to-end pass.

### Changes Required:

#### 1. Decision record

**File**: `context/changes/first-plan-generation/change.md`, `context/foundation/roadmap.md`, `context/foundation/tech-stack.md`

**Intent**: State that the AI gateway is OpenRouter (routing to an Anthropic model via the OpenAI-compatible API), superseding the "Anthropic SDK/model" wording, and why (model-swap + fallback, no vendor SDK, leaner workerd bundle).

**Contract**: Update the AI-integration line in each doc to name OpenRouter + the config-driven `OPENROUTER_MODEL`; note S-02 marks the roadmap unknowns (model/latency, prompt) as resolved. Set `change.md` `status: planned`/then per workflow, `updated` to today.

#### 2. Quality verification on a paid model

**File**: — (verification activity, no file)

**Intent**: Per research, validate the core hypothesis on a strong paid model to avoid a false negative; record the model in `generation_metadata`.

**Contract**: With `OPENROUTER_MODEL` pointed at the paid Claude model, generate a plan for each equipment type and review plan quality (sensible periodization, equipment-correct targets, availability respected).

### Success Criteria:

#### Automated Verification:

- [ ] Lint + build still pass: `npm run lint && npm run build`
- [ ] No doc references claim an Anthropic SDK is installed

#### Manual Verification:

- [ ] End-to-end pass completed for all three equipment types on the paid model; plans are correct and equipment-adapted
- [ ] `generation_metadata` records the model + usage for each generated plan
- [ ] Roadmap/tech-stack/change.md no longer disagree on the AI gateway

**Implementation Note**: This is the final phase — confirm the north-star acceptance bar ("intensity targets match declared equipment exactly") holds before closing.

---

## Testing Strategy

### Unit-style checks (no test runner; verified manually / via build):

- Plan zod schema accepts a valid plan per equipment type; rejects mismatched target kinds.
- Availability/duration refinement rejects out-of-availability days and over-cap durations.
- `toSessionInserts` `scheduled_date` math for `day_index` 1 and 28.

### Integration scenarios (manual):

- Onboard → generate → view, once per equipment type.
- Idempotency: second generate returns the same plan, no new LLM call.
- Failure path: forced invalid output → retries → friendly error, nothing persisted.

### Manual Testing Steps:

1. Onboard as a power-meter user; confirm watt targets and availability-respecting schedule.
2. Onboard as an HRM user; confirm HR-zone targets.
3. Onboard as a no-equipment user; confirm RPE targets.
4. Reload dashboard; confirm same plan, no regeneration.
5. Temporarily break the schema/model to confirm the retry + friendly-error path persists nothing.

## Performance Considerations

One low-temperature structured call fits Worker CPU/duration limits; bound `max_tokens` to the plan size. The progress UI covers the ~10–30s wait. Reads use the existing indexes (`plan_sessions_plan_id_idx`, `plan_sessions_plan_scheduled_idx`).

## Migration Notes

No schema migration — `plans`/`plan_sessions` already exist (F-01). Only env vars are added (`OPENROUTER_API_KEY` secret, `OPENROUTER_MODEL` var) in local dev files and, for production, via `wrangler secret put` + a Cloudflare var.

## References

- Internal research: `context/changes/first-plan-generation/research.md`
- External API reference: `context/changes/first-plan-generation/openrouter-docs.md`
- API route template: `src/pages/api/onboarding.ts:8-50`
- Service template: `src/lib/services/profile.ts:1-31`
- Derivation template: `src/lib/onboarding.ts:37-87`
- Schema template: `src/lib/onboarding-schema.ts:107-120`
- Schema (DB contract): `supabase/migrations/20260602182721_init_mvp_schema.sql:99-221`
- Seam: `src/components/onboarding/OnboardingWizard.tsx:157-183`, `src/pages/dashboard.astro:16-22`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: AI Integration Foundation

#### Automated

- [x] 1.1 Type checking passes: `npm run lint` — fa8366c
- [x] 1.2 Production build succeeds: `npm run build` — fa8366c
- [x] 1.3 No `process.env` introduced; secrets read via `astro:env/server` — fa8366c

#### Manual

- [x] 1.4 Client returns parsed JSON for a trivial schema with the key set — fa8366c
- [x] 1.5 Client fails closed when the key is absent — fa8366c

### Phase 2: Plan Contract & Generation Logic

#### Automated

- [x] 2.1 Type checking + lint pass: `npm run lint` — 8b9b866
- [x] 2.2 Build succeeds: `npm run build` — 8b9b866
- [x] 2.3 `PLAN_JSON_SCHEMA` is a valid JSON-Schema object consistent with the zod schema — 8b9b866

#### Manual

- [x] 2.4 Valid plan per equipment type passes; mismatched target kind rejected — 8b9b866
- [x] 2.5 Unavailable-day and over-cap-duration sessions rejected — 8b9b866
- [x] 2.6 `toSessionInserts` `scheduled_date` correct for `day_index` 1 and 28 — 8b9b866

### Phase 3: Service & Generate Endpoint

#### Automated

- [ ] 3.1 Lint + type check pass: `npm run lint`
- [ ] 3.2 Build succeeds: `npm run build`
- [ ] 3.3 Route exports `prerender = false` and uppercase `POST`

#### Manual

- [ ] 3.4 First call generates+persists one active plan with sessions; second returns same plan, no new LLM call
- [ ] 3.5 Forced invalid output retries then friendly error; nothing persisted (no orphan plan)
- [ ] 3.6 RLS holds: row `user_id` is caller; sessions resolve via parent
- [ ] 3.7 Exactly one active plan after repeated calls

### Phase 4: Dashboard Plan View

#### Automated

- [ ] 4.1 Lint + type check pass: `npm run lint`
- [ ] 4.2 Build succeeds: `npm run build`
- [ ] 4.3 No Next.js directives; hooks under `src/components/hooks/`

#### Manual

- [ ] 4.4 Onboarding → `/dashboard` shows progress then the plan
- [ ] 4.5 Overview shows sessions only on available days; rest days empty
- [ ] 4.6 Expanded session shows watts / HR zones / RPE per equipment type
- [ ] 4.7 Reload shows same plan instantly (no regeneration)
- [ ] 4.8 Forced failure shows retry state; retry succeeds
- [ ] 4.9 Responsive/legible on mobile width

### Phase 5: Docs Reconciliation & End-to-End Verification

#### Automated

- [ ] 5.1 Lint + build still pass: `npm run lint && npm run build`
- [ ] 5.2 No doc claims an Anthropic SDK is installed

#### Manual

- [ ] 5.3 E2E pass for all three equipment types on the paid model; plans correct and equipment-adapted
- [ ] 5.4 `generation_metadata` records model + usage per plan
- [ ] 5.5 Roadmap/tech-stack/change.md agree on the AI gateway (OpenRouter)
