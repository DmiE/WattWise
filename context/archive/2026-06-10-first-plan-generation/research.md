---
date: 2026-06-10T21:03:59+0200
researcher: Dawid Mieszczak
git_commit: 9264571157ed1cb3c0aedecd0e0928aae666ec26
branch: main
repository: WattWise
topic: "Is OpenRouter compatible with the WattWise codebase for implementing S-02 (first AI plan generation)?"
tags: [research, codebase, openrouter, ai-integration, s-02, first-plan-generation, cloudflare-workers, astro-env]
status: complete
last_updated: 2026-06-11
last_updated_by: Dawid Mieszczak
last_updated_note: "Added follow-up research on free vs. paid model selection and the model-switching strategy (Context7 /websites/openrouter_ai)."
---

# Research: Is OpenRouter compatible with the WattWise codebase for S-02?

**Date**: 2026-06-10T21:03:59+0200
**Researcher**: Dawid Mieszczak
**Git Commit**: 9264571157ed1cb3c0aedecd0e0928aae666ec26
**Branch**: main
**Repository**: WattWise

## Research Question

Review the codebase and decide whether OpenRouter is compatible with it, in service of implementing **S-02 (`first-plan-generation`, the north star)** from `context/foundation/roadmap.md` — confirm onboarding inputs and receive a 4-week AI plan with equipment-adapted intensity targets (watts / HR zones / RPE).

## Summary

**Verdict: OpenRouter is fully compatible. No blockers.** It integrates cleanly via a plain server-side `fetch()` call in an Astro API route — no SDK, no new runtime capability, no architectural change. Every piece S-02 needs is already in place:

- The Cloudflare **workerd runtime supports native `fetch()`**, which is exactly the transport OpenRouter's OpenAI-compatible REST endpoint needs (`POST https://openrouter.ai/api/v1/chat/completions`). No AI SDK is required, and the external research already confirms plain `fetch` is the documented approach (`openrouter-docs.md:93-108`).
- The **secret-wiring pattern is established and reusable**: `OPENROUTER_API_KEY` declares into `astro.config.mjs` `env.schema` exactly like `SUPABASE_KEY` and reads via `astro:env/server` — no `process.env` anywhere.
- The **API route + service + zod conventions** from S-01's `/api/onboarding` give a direct template for a plan-generation endpoint and a `src/lib/services/plan.ts` service.
- The **database schema already models a 28-day plan and its sessions** (`plans`, `plan_sessions`), including a free-form `structure` jsonb column purpose-built to hold equipment-adapted intensity targets. S-02 writes here.
- The **S-01/S-02 seam is explicit and waiting**: the onboarding confirm flow redirects to a dashboard "your plan is coming" stub that S-02 fills, and there is no plan-generation code anywhere yet.

**One naming caveat to flag, not a blocker:** the roadmap prose (`roadmap.md:63,108`), `tech-stack.md`, and `change.md:22` all say **"Anthropic SDK / Anthropic model."** The actual intended gateway — per the external research artifact already in this change folder (`openrouter-docs.md`) — is **OpenRouter**. OpenRouter is a superset here: it speaks the OpenAI-compatible API and can route to `anthropic/claude-sonnet-4.5`, so it satisfies the "Anthropic model" intent while adding model-swap and fallback (`models[]` + `route: "fallback"`) without committing to a vendor SDK. The plan should record this decision so the docs no longer disagree.

## Detailed Findings

### Area 1 — Runtime & transport (can workerd call OpenRouter?)

**Yes, via native `fetch()`. Zero new dependencies.**

- **No AI/LLM SDK is installed** — `@anthropic-ai/sdk`, `openai`, `openrouter` are all absent from `package.json`. No HTTP client (axios/got/ky) either; native `fetch` is the norm. (`package.json:15-37`)
- **Cloudflare adapter is plain SSR** — `output: "server"`, `adapter: cloudflare({ imageService: "passthrough" })`, no `ssr.noExternal` / bundling exclusions. (`astro.config.mjs:10-25`)
- **workerd Node compat is on** — `compatibility_flags: ["nodejs_compat", "disable_nodejs_process_v2"]`, `compatibility_date: "2026-05-08"`. A Node-dependent SDK *could* run, but a plain `fetch` call sidesteps all Node-API and bundle-weight concerns. (`wrangler.jsonc:6-8`)
- **Only one existing outbound fetch** is the client→internal `/api/onboarding` call (`OnboardingWizard.tsx:166-170`). No external HTTP yet — S-02 introduces the first server→external call, which is unremarkable on workerd.
- Stack versions: `astro ^6.3.1`, `@astrojs/cloudflare ^13.5.0`, `react ^19.2.6`, `zod ^4.4.3`, `@supabase/ssr ^0.10.3`. Node `22.14.0` (`.nvmrc`).

**Recommendation:** call OpenRouter directly with `fetch` from a server-side service; do **not** add an SDK.

### Area 2 — Secret wiring for `OPENROUTER_API_KEY`

The exact pattern already used for Supabase secrets:

- Declare in `astro.config.mjs` `env.schema` (`astro.config.mjs:19-24`):
  ```js
  SUPABASE_URL: envField.string({ context: "server", access: "secret", optional: true }),
  SUPABASE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
  // add:
  OPENROUTER_API_KEY: envField.string({ context: "server", access: "secret", optional: true }),
  ```
- Read via `astro:env/server` (`src/lib/supabase.ts:3`): `import { SUPABASE_URL, SUPABASE_KEY } from "astro:env/server";` — and guard `if (!KEY) return null/500`.
- **No `process.env` anywhere** in `src/` — everything goes through `astro:env`.
- Local dev: add to `.env.example` (Node) and `.dev.vars` (Cloudflare workerd, gitignored). Production: `wrangler secret put OPENROUTER_API_KEY`.

This matches the env-wiring guidance already written into `openrouter-docs.md:155-162`.

### Area 3 — API route / service / validation conventions to mirror

S-01's `POST /api/onboarding` is the canonical template (`src/pages/api/onboarding.ts`):

- `export const prerender = false;` then `export const POST: APIRoute = async (context) => {…}` (`onboarding.ts:8`).
- Auth gate first: `const user = context.locals.user; if (!user) return json({error:"Not authenticated"},401)` (`onboarding.ts:17-20`). `locals.user` is populated in `src/middleware.ts` and typed in `src/env.d.ts`.
- Parse + validate: `await context.request.json()` in try/catch → `schema.safeParse(raw)` → on failure `z.flattenError()` → 400 with `fieldErrors` (`onboarding.ts:22-33`).
- Supabase per-request under the caller's session (RLS applies): `const supabase = createClient(context.request.headers, context.cookies); if (!supabase) return json(...,500)` (`onboarding.ts:35-38`).
- Response helper: `const json = (body, status) => new Response(JSON.stringify(body), { status, headers:{'Content-Type':'application/json'} })` (`onboarding.ts:10-14`).
- **Service layer**: `src/lib/services/profile.ts` is the template — functions take `supabase: NonNullable<ReturnType<typeof createClient>>` as first arg so RLS is enforced under the user's session. A parallel `src/lib/services/plan.ts` is the natural home for the generate-and-persist logic.
- **Derivation logic** lives in `src/lib/` (e.g. `src/lib/onboarding.ts` `toProfileInsert`), computed server-side before any DB write so a tampered body can't violate CHECK constraints. S-02's prompt-building and response-mapping belong here.
- **zod `^4.4.3`**, `import { z } from "zod"`. Schemas live in dedicated modules (`src/lib/onboarding-schema.ts`) using discriminated unions on `equipment_type`. S-02 should add a `plan`/`segment` schema module to validate the LLM's JSON before persisting.

### Area 4 — Data schema: where S-02 reads and writes

All tables created in `supabase/migrations/20260602182721_init_mvp_schema.sql` (RLS per-user on every table).

**Reads — `profiles` (PK `user_id`, one per user):** the sole input. Equipment enum is exactly `'power_meter' | 'hrm' | 'none'` (`init_mvp_schema.sql:9`). CHECK constraints define what data exists per equipment type:
- `power_meter` → `ftp_watts` + `ftp_source` set (`fitness_level` null if `measured`, set if `estimated`).
- `hrm` → `max_hr` + `fitness_level` set; no FTP.
- `none` → `fitness_level` only.
- Plus `goal` (training_goal enum), `age`, `weight_kg`, `available_days text[]`, `max_workday_minutes`, `max_weekend_minutes`.
- Read it via the existing `getProfile(supabase, userId)` service (`src/lib/services/profile.ts`).

**Writes — `plans` (`init_mvp_schema.sql:99-140`):**
- `start_date`/`end_date` with `plans_28_day_window` CHECK requiring **exactly `end_date - start_date = 27`** (28-day plan).
- Unique partial index **`one_active_plan_per_user` on `(user_id) where status='active'`** → regeneration must first flip any prior active plan to `'superseded'`/`'expired'` or the insert conflicts.
- `*_at_generation` snapshot columns (`goal_at_generation`, `ftp_at_generation`, `max_hr_at_generation`, `fitness_level_at_generation`, `equipment_at_generation`) — copy the profile snapshot in.
- `generation_metadata jsonb` (nullable) — natural place to record **OpenRouter model name, prompt version, token usage** for provenance.

**Writes — `plan_sessions` (`init_mvp_schema.sql:146-221`):**
- Addressed by `day_index` **1–28** (no separate week column; week = `ceil(day_index/7)`). `(plan_id, day_index)` unique → ≤1 session/day; rest days = no row.
- `scheduled_date` must equal `plans.start_date + day_index - 1`.
- `session_type` enum `endurance | intervals | recovery`; `planned_duration_min` 15–360; `title` required; `description` nullable.
- **`structure jsonb NOT NULL`** with the only constraint being `jsonb_typeof(structure)='object' AND structure ? 'segments'` (`plan_sessions_structure_shape`). **This is where equipment-adapted intensity targets (watts / HR zones / RPE) go** — the DB does not constrain the segment shape, so S-02 defines and zod-validates it.
- RLS on `plan_sessions` walks up via `EXISTS` to `plans.user_id = auth.uid()` → insert the parent `plans` row first, then sessions, all under the user's SSR client.

**Types are generated** (`src/db/database.types.ts`, re-exported by `src/types.ts`): `Plan`, `PlanInsert`, `PlanSession`, `PlanSessionInsert`, `EquipmentType`, etc. are already available. `structure` is typed only as `Json` — S-02 supplies its own segment type.

### Area 5 — The S-01 → S-02 seam (where generation triggers)

There is **no plan-generation code anywhere yet** — the seam is deliberate and documented:

- The wizard's review step confirm handler posts to `/api/onboarding`, then on success `window.location.href = "/dashboard"` (`OnboardingWizard.tsx:157-183`). Today `/api/onboarding` only upserts the profile and returns `{ ok: true }` (`onboarding.ts:42-49`).
- The dashboard renders a stub — `"Your 4-week plan is coming … check back soon."` (`dashboard.astro:16-22`). The archived S-01 plan calls this stub "the seam S-02 will fill" and explicitly excludes plan generation: *"No AI plan generation, no `plans`/`plan_sessions` rows — that is S-02"* (`context/archive/2026-06-07-onboarding-wizard/plan.md`).

**Two integration options for S-02 (decide in `/10x-plan`):**
1. Extend `/api/onboarding` to trigger generation after the profile upsert, or
2. Add a dedicated `POST /api/plans/generate` called right after profile save or on dashboard load.

Either way, replace the dashboard stub with the week-overview + per-session detail UI.

## Code References

- `astro.config.mjs:10-25` — Cloudflare adapter + `env.schema` (secret declaration pattern).
- `src/lib/supabase.ts:3-9` — `astro:env/server` import + null-guard pattern for secrets.
- `wrangler.jsonc:6-8` — `nodejs_compat` flags, `compatibility_date`.
- `package.json:15-37` — no AI SDK / HTTP client; native fetch is the norm.
- `src/pages/api/onboarding.ts:8-50` — canonical API route (prerender, auth, zod, per-request supabase, JSON responses).
- `src/lib/services/profile.ts:1-31` — service-layer template (`getProfile`, `upsertProfile`); supabase injected as first arg → RLS applies.
- `src/lib/onboarding.ts:37-87` — server-side derivation pattern (`toProfileInsert`).
- `src/lib/onboarding-schema.ts:107-120` — discriminated-union zod schema on `equipment_type`.
- `src/middleware.ts:7-17` + `src/env.d.ts:1-5` — `context.locals.user` population and typing.
- `supabase/migrations/20260602182721_init_mvp_schema.sql:9-15` — enums (equipment/goal/session/plan status).
- `…init_mvp_schema.sql:35-93` — `profiles` table + equipment CHECK constraints.
- `…init_mvp_schema.sql:99-140` — `plans` table (28-day window CHECK, one-active-plan index, `*_at_generation`, `generation_metadata`).
- `…init_mvp_schema.sql:146-221` — `plan_sessions` table (`day_index` 1–28, `structure` jsonb shape constraint).
- `src/components/onboarding/OnboardingWizard.tsx:157-183` — confirm → POST → redirect to `/dashboard` (the seam).
- `src/pages/dashboard.astro:16-22` — "plan is coming" stub S-02 replaces.
- `context/changes/first-plan-generation/openrouter-docs.md` — external API reference (endpoint, `response_format`/`json_schema`, fetch shape, env wiring).

## Architecture Insights

- **Plain-fetch-over-SDK is the idiomatic choice here.** The codebase already avoids heavyweight clients (Supabase is the only external client, via its official SSR lib). OpenRouter's OpenAI-compatible REST surface + workerd's native fetch means an SDK would only add bundle weight and Node-API risk for no gain. This matches `openrouter-docs.md:93` ("no SDK — keeps the workerd bundle lean").
- **Structured output is the linchpin for correctness.** S-02's hardest guardrail ("intensity targets must match declared equipment exactly") maps to OpenRouter's `response_format: { type: "json_schema", strict: true }` (`openrouter-docs.md:20-91`). But the response still arrives as a **string** in `choices[0].message.content` — `JSON.parse` then **zod-validate** before persisting, and re-check that `structure ? 'segments'` and equipment-appropriate fields hold. Belt-and-suspenders: the LLM schema constrains generation; zod + the DB CHECKs are the trust boundary.
- **The schema pre-encodes the plan contract.** The 28-day window, day-index addressing, and free-form `structure.segments` mean S-02's main design work is (a) the prompt, (b) the segment shape per equipment type, and (c) the supersede-then-insert transaction — not data modeling.
- **RLS-by-session is non-negotiable.** Everything runs under the user's SSR client; no service-role key exists. Plan + sessions insert as the authenticated user, parent-first.
- **Model choice + latency NFR** ("a normal loading wait") is addressable with OpenRouter's `models[]` + `route: "fallback"` and a low `temperature` (~0.2–0.4) for structural determinism (`openrouter-docs.md:133-153`). Verify the chosen model supports `structured_outputs` (`anthropic/claude-sonnet-4.5` does).

## Historical Context (from prior changes)

- `context/archive/2026-06-07-onboarding-wizard/plan.md` — S-01 deliberately ends at "profile saved → dashboard stub"; states plainly *"No AI plan generation, no `plans`/`plan_sessions` rows — that is S-02."* The dashboard stub is named as the seam S-02 fills.
- `context/archive/2026-06-07-onboarding-wizard/plan-brief.md` — FTP-estimate W/kg constants (beginner 2.0 / intermediate 2.8 / advanced 3.7) flagged as "tune later if S-02 plan quality suggests otherwise"; reiterates the "intensity targets must match declared equipment exactly" acceptance bar.
- `context/archive/2026-05-31-data-schema-and-rls/` — origin of the `plans`/`plan_sessions`/`profiles` schema and RLS policies S-02 builds on (F-01).

## Related Research

- `context/changes/first-plan-generation/openrouter-docs.md` — external research artifact (Context7, `/websites/openrouter_ai`, 2026-06-10): endpoint, auth, structured outputs, fetch shape, request params, env wiring. This research doc is the **internal** counterpart confirming the codebase side.

## Open Questions

These are S-02 planning/implementation questions, not compatibility blockers:

1. **Naming/decision to record:** roadmap, `tech-stack.md`, and `change.md` say "Anthropic SDK/model"; the chosen gateway is OpenRouter (routing to an Anthropic model). The plan should state this so the foundation docs stop disagreeing. (Compatibility: unaffected — OpenRouter satisfies the intent.)
2. **Trigger placement:** extend `/api/onboarding` vs. a new `POST /api/plans/generate`. (Roadmap unknown — non-blocking.)
3. **Prompt structure** that reliably yields a valid 28-day plan with equipment-appropriate `structure.segments` across all three equipment types. (Roadmap unknown — prototype during impl.)
4. **Model + latency:** which model balances quality vs. "normal loading wait"; whether to use `models[]`/`route: "fallback"`. (Roadmap unknown — verify `structured_outputs` support.)
5. **Segment shape:** define and zod-validate the per-equipment `structure.segments` contract (watts vs. HR zones vs. RPE) — the DB only requires the `segments` key to exist.
6. **Loading UX:** the NFR demands continuous visible feedback during generation — needs a UX decision (sync request with spinner vs. async/polling) given Cloudflare Worker request-duration behavior.

## Follow-up Research 2026-06-11 — Free vs. paid models & switching strategy

Source: Context7 `/websites/openrouter_ai` (OpenRouter docs). Resolves roadmap unknown #4 (model + latency) and refines Open Question #4 above.

### Free vs. paid

- **`anthropic/claude-sonnet-4.5` is paid.** All Anthropic/Claude models on OpenRouter bill per token (`pricing.prompt` + `pricing.completion`); there is **no free Claude variant**. Calling it requires account credits.
- **Free models exist and are usable from day one** — IDs ending in **`:free`**, plus an auto-selecting **`openrouter/free`** router that *"intelligently filters for models that support … structured outputs"* (so it won't return a model that can't do strict `json_schema`).
- **Free-tier rate limits:** 20 req/min; **50 req/day** if < 10 credits purchased, **1,000 req/day** if ≥ 10 credits (~$10). Docs note free models are *"not suitable for production"* and free variants generally carry weaker provider data-privacy terms (may log/train on inputs). WattWise's PRD privacy guardrail is about *cross-user* visibility, not provider handling — but worth recording.
- **Verify structured-output support per model:** `GET https://openrouter.ai/api/v1/models?supported_parameters=structured_outputs` returns the eligible set. S-02's correctness depends on `response_format: { json_schema, strict: true }`, so any chosen free model must be in that list. `openrouter/free` handles this filtering automatically.

### Switching is a one-string change — if model is a config value

The OpenRouter API is uniform across models: same endpoint, same request/response shape, same `response_format`. Only the `model` string changes:

```ts
// dev / free
body: JSON.stringify({ model: "openrouter/free", messages, response_format })
// prod / paid — only this string differs
body: JSON.stringify({ model: "anthropic/claude-sonnet-4.5", messages, response_format })
```

**Recommendation — drive the model from config, not a hardcoded string:**

- **Preferred: an `OPENROUTER_MODEL` env var** declared in `astro.config.mjs` `env.schema` (server context; not a secret), read via `astro:env/server` exactly like `OPENROUTER_API_KEY`. Lets the *same code* run free locally (`.dev.vars`) and paid in production (Cloudflare var) — switch with no code edit and no logic redeploy.
- Alternative: a constant in `src/lib/services/plan.ts` — simplest if runtime switching isn't needed.

### Switching gotchas (so "easy" stays easy)

1. **Structured-output support must hold on both sides.** Pin the free model to a verified `:free` ID (or use `openrouter/free`); never point the config at an unverified model, or strict JSON silently degrades.
2. **Quality/latency differ, not the interface.** zod + the DB CHECK constraints catch *malformed* output on any model, but not *valid-but-poor* plans — so the S-02 hypothesis ("can an AI produce a correct equipment-adapted plan?") must be validated on a **strong (paid) model** to avoid a false negative from a weak free one. Build the plumbing on free; verify plan quality on paid before shipping.
3. **Rate limits are per-tier** (free 20/min, 50–1000/day) — relevant if retry/fallback logic is added; the free tier is where limits bite first.
4. **Stamp the model into `plans.generation_metadata`** (jsonb) so free- vs. paid-generated plans are distinguishable after the fact when comparing quality.

**Net:** mechanically trivial to switch, *provided* (a) the model is a config value (env var preferred) and (b) it only ever points at models confirmed to support strict structured output. Both are one-time setup decisions for the `/10x-plan` stage.
