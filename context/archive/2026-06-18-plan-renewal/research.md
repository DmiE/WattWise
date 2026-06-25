---
date: 2026-06-18T21:30:52+0200
researcher: Dawid Mieszczak
git_commit: 78ad0fb5bf89bba01072dbd1310ceb38fbefd19a
branch: main
repository: WattWise
topic: "S-05 plan-renewal — reuse the AI generation pipeline, detect plan expiry, gate FTP to power-meter users, and intercept the entry flow"
tags: [research, codebase, plan-renewal, plan-generation, expiry, middleware, ftp-gate]
status: complete
last_updated: 2026-06-18
last_updated_by: Dawid Mieszczak
---

# Research: S-05 plan-renewal

**Date**: 2026-06-18T21:30:52+0200
**Researcher**: Dawid Mieszczak
**Git Commit**: 78ad0fb5bf89bba01072dbd1310ceb38fbefd19a
**Branch**: main
**Repository**: WattWise

## Research Question

For roadmap slice **S-05 plan-renewal** — "when the 4-week plan expires, the user sees a renewal check-in as the first screen on next visit; they confirm/update goal, weekly availability, and (power-meter users only) current FTP; confirming generates a new AI plan" — answer:

1. How does the existing S-02 AI plan-generation pipeline work, and how much of it can renewal reuse?
2. What does the data model support for **detecting plan expiry** (date-based vs session-count)?
3. How are profile inputs edited (S-04) and how are equipment type + FTP modeled, so the FTP field can be gated to power-meter users?
4. Where should the "renewal check-in as first screen" gate live, given existing routing/middleware conventions?

## Summary

The slice is well-supported by the existing codebase and reuses three prior slices (S-02 generation, S-04 profile edit, S-01 onboarding) almost wholesale. Four findings dominate planning:

1. **The generation pipeline is profile-pure and reusable** — `buildPlanMessages`, `validateGeneratedPlan`, `generateStructured`, `persistPlan` all take only a `Profile` and have zero onboarding coupling. ([Finding 1](#1-ai-plan-generation-pipeline-s-02-reuse))

2. **THE central design constraint (flagged independently by all four agents):** the DB enforces `one_active_plan_per_user` (partial unique index) and `POST /api/plans/generate` short-circuits when an active plan exists, returning it with **no LLM call**. `persistPlan` further treats an activation conflict (`23505`) as an "idempotent win" and hands back the *existing* plan. **Renewal must therefore retire the old plan (`active → expired`/`superseded`) before activating the new one** — naively reusing the generate path will silently return the stale plan and never regenerate. ([Finding 1](#1-ai-plan-generation-pipeline-s-02-reuse), [Finding 4](#4-entry-flow-interception-routing--middleware))

3. **Expiry needs NO schema migration.** `plans.end_date` already exists with a hard 28-day window CHECK (`end_date - start_date = 27`), and the `plan_status` enum already includes `expired` and `superseded`. The slice's hypothetical "no end_date column" gap is false. The real gap is behavioral: **nothing in the code ever transitions a plan to `expired`** — every plan stays `active` forever — so expiry must be computed from `end_date` at read time (recommended), and the renewal write path must add the status transition. ([Finding 2](#2-plansession-data-model--expiry-detection))

4. **FTP gate is a known pattern.** Equipment enum is `power_meter | hrm | none`; FTP↔equipment coupling is enforced by 3 DB CHECK constraints; S-04 profile-editing *deliberately* excludes FTP (the renewal form is what makes the existing "FTP can only be updated at plan renewal" copy true). The renewal form cannot use the simple `updateProfileFields` path for power-meter users — it must re-derive `ftp_source`/`fitness_level` server-side exactly like `toProfileInsert` does. ([Finding 3](#3-profile-inputs-equipment--ftp-model-the-ftp-gate))

The natural shape: a **middleware gate** (mirroring the existing onboarding profile-gate) redirects expired users to a `/renewal` route; the renewal React island POSTs the check-in to an API route that updates the profile and then drives generation, with a new "retire-old-then-generate" step replacing S-02's idempotency short-circuit.

## Detailed Findings

### 1. AI plan-generation pipeline (S-02 reuse)

**Request→response flow of `POST /api/plans/generate`** (`src/pages/api/plans/generate.ts`):

1. Auth gate via `context.locals.user` → 401 (`generate.ts:40-43`).
2. SSR Supabase client `createClient(headers, cookies)` (RLS-scoped, no service role) (`generate.ts:45-48`).
3. **Idempotency short-circuit** — `getActivePlan(supabase, user.id)`; if an active plan exists it is returned immediately with **no LLM call** (`generate.ts:51-59`). Comment at `:50` states "S-02 does not regenerate."
4. Input gathering — `getProfile(supabase, user.id)`; 409 if no profile (`generate.ts:62-71`).
5. Prompt build — `buildPlanMessages(profile)` → `{ system, user }` (`plan.ts:168-198`).
6. Start date — `nextMonday(new Date())` anchors `day_index 1` to a Monday (`generate.ts:77`, `plan.ts:221-228`).
7. Budget + retry loop — `GENERATION_BUDGET_MS = 90_000`, `MAX_GENERATION_ATTEMPTS = 2` (`generate.ts:21,28,79-120`). Each iteration: `generateStructured({system,user,jsonSchema: PLAN_JSON_SCHEMA, schemaName, deadline})` (`:89-95`); `missing_api_key` → fail-fast 500, other transport errors `continue`.
8. **Trust boundary** — `validateGeneratedPlan(result.content, profile)` (zod + semantic); failure → retry, never coerced/persisted (`generate.ts:105-110`, `plan.ts:66-131`).
9. DB write — `toPlanInsert(profile, startDate, {model, usage})` + `persistPlan(...)` with `toSessionInserts` (`generate.ts:112-119`).
10. Exhaustion → 502 (`generate.ts:123`).

**Prompt inputs & equipment mapping** (`src/lib/plan.ts`):
- User message consumes `goal`, `equipment_type`, `age`, `weight_kg`, plus conditional `ftp_watts`/`max_hr`/`fitness_level` (only if non-null), `available_days`, `max_workday_minutes`, `max_weekend_minutes` (`plan.ts:147-159,185-195`).
- `EQUIPMENT_TARGET_KIND` is the single source of truth: `power_meter→watts`, `hrm→hr_zone`, `none→rpe` (`plan.ts:23-27`).
- `PROMPT_VERSION = "1"` stamped into `generation_metadata` alongside `model` + `usage` (`plan.ts:18,247-252`).
- Model config: `DEFAULT_MODEL = "anthropic/claude-sonnet-4.5"` overridable by `OPENROUTER_MODEL`; `TEMPERATURE=0.3`, `MAX_TOKENS=8000`; optional `OPENROUTER_FALLBACK_MODEL` (`services/openrouter.ts:16,20,21,96,117-121`).

**Persistence & plan-status state machine** (`src/lib/services/plan.ts`):
- `persistPlan` is crash-safe in 3 phases: insert plan as **`pending`** (invisible to `getActivePlan` + the unique index) → insert sessions (delete pending parent on failure) → flip to **`active`** last (`plan.ts:95-145`, esp. `:105-109,116-121,127-132`).
- `pending` status added in migration `20260613224500_add_pending_plan_status.sql:8`.
- **Generating does NOT deactivate an existing active plan.** The route short-circuits on any active plan, and `persistPlan` relies on the partial unique index `one_active_plan_per_user on (user_id) where status='active'` (`plan.ts:22-25`). At phase 3, a second active plan raises `23505`, treated as an **idempotent win**: delete own pending, re-query, return the *existing* active plan (`plan.ts:133-141`). Net: **at most one active plan per user, never replaced.**

**Reusable as-is (profile-pure, no onboarding coupling):** `buildPlanMessages` (`plan.ts:168`), `validateGeneratedPlan` (`plan.ts:66`), `generateStructured` (`openrouter.ts:90`), `PLAN_JSON_SCHEMA`/`planSchema` (`plan-schema.ts`), `toPlanInsert`/`toSessionInserts`/`nextMonday`/`addDays` (`plan.ts:236/261/221/209`), `persistPlan` (`plan.ts:95`, with the caveat below).

**Must change for renewal:**
- The **idempotency short-circuit** (`generate.ts:51-59`) — renewal explicitly wants a new plan; this must be replaced with an eligibility guard (plan expired) + a force/regenerate path.
- The **`one_active_plan_per_user` constraint + 23505-idempotent-win** is the real blocker. Renewal must deactivate the previous plan (`active → expired`/`superseded`) **before** phase-3 activation, atomically (transaction/RPC) or via an extended `persistPlan`. Otherwise the new activation conflicts and `persistPlan` returns the *old* plan, silently defeating renewal.
- `toPlanInsert` hard-codes `status:"active"` and snapshots the *current* profile into `*_at_generation` columns (`plan.ts:242`) — correct for renewal **as long as the profile is updated first**.

**Existing guard rails:** route-level shared deadline (`GENERATION_BUDGET_MS`, `generate.ts:28,79`) passed into `generateStructured` (`openrouter.ts:128-132`); two retry layers (route semantic ×2, transport ×2 with `ATTEMPT_TIMEOUT_MS=45_000` AbortController); TOCTOU closed by the unique index. **No force/regenerate flag exists — S-05 must introduce one.**

### 2. Plan/session data model + expiry detection

Schema in `supabase/migrations/20260602182721_init_mvp_schema.sql`; generated types `src/db/database.types.ts`; curated re-exports `src/types.ts`.

**`plans` table** (`init_mvp_schema.sql:99-114`):
- `start_date date NOT NULL` (`:102`), **`end_date date NOT NULL`** (`:103`), `status plan_status NOT NULL default 'active'` (`:104`).
- Snapshot columns: `goal_at_generation`, `ftp_at_generation`, `max_hr_at_generation`, `fitness_level_at_generation`, `equipment_at_generation`, `generation_metadata jsonb` (`:105-110`).
- **`constraint plans_28_day_window check (end_date - start_date = 27)`** (`:113`) — inclusive 28-day window (day 1–28). So `end_date` is explicit, not implied.
- `plan_status` enum = `('active','expired','superseded','pending')` (`init_mvp_schema.sql:13` + `add_pending_plan_status.sql:8`).

**`plan_sessions` table** (`init_mvp_schema.sql:146-165`):
- `plan_id uuid NOT NULL FK → plans(id) ON DELETE CASCADE` (`:148`), `scheduled_date date NOT NULL` (`:149`), `day_index smallint 1–28` (`:150`), `status session_status NOT NULL default 'pending'` (`:156`).
- `session_status` enum = `('pending','done','skipped')` (`init_mvp_schema.sql:14`).
- `unique (plan_id, day_index)` (`:164`); index on `(plan_id, scheduled_date)` (`:168`). No "week" column — derive via `ceil(day_index/7)`. Rest days have no row (sparse; `plan-schema.ts:62-63`).
- 1:1 `session_logs` for logged sessions (`init_mvp_schema.sql:227-236`), but `status='done'` is the authoritative completion signal.

**One active plan per user — enforced** by partial unique index `one_active_plan_per_user on plans(user_id) where status='active'` (`init_mvp_schema.sql:117`). "Active" identified by `status='active'`, not latest date — canonical query `getActivePlan` (`src/lib/services/plan.ts:28-39`, `.maybeSingle()`).

**RLS** — all tables RLS-on, `authenticated` + `user_id = auth.uid()`. `plans` has per-operation own-row policies incl. `update` (USING + WITH CHECK) (`init_mvp_schema.sql:123-140`). `plan_sessions` resolves ownership via an `EXISTS` walk up to `plans.user_id` (`:174-221`) — which is why the parent plan row must be inserted before its sessions. Reading for expiry and flipping the old plan's status are both already permitted by existing policies.

**Expiry signals available today (no migration to detect):**
1. **Calendar (recommended):** active plan is expired when `current_date > plans.end_date` (`init_mvp_schema.sql:103`). Equivalent to `start_date + 28`.
2. Per-session date sweep via `plan_sessions.scheduled_date` (`:149`).
3. Completion-count alternative: count `plan_sessions` where `status='done'` for the plan (`:156`) — no existing aggregate helper; would be app-code or a new RPC.
4. `plans.status='expired'` enum value exists (`:13`) but is never set today.

**Gaps:**
- **No code transitions a plan to `expired`** — `status` is not a reliable expiry signal yet; compute from `end_date` at read time, and have the renewal write path set the terminal status. (No migration needed — column + enum already exist, RLS already allows the owner to update status.)
- No per-user timezone anywhere; `date` columns are bare. "Expired on next visit" precision (server UTC date vs client local date) is a product decision, not resolved by the data model.
- No aggregate/RPC for completion counts (only relevant if a count-based expiry is chosen). An RPC would mirror `set_session_status` in `20260615210417_add_set_session_status_rpc.sql`.

### 3. Profile inputs, equipment + FTP model (the FTP gate)

**Common (renewable, non-FTP) fields** — `commonFields` in `src/lib/onboarding-schema.ts:24-37`:
- `goal` = `z.enum(TRAINING_GOALS)`, `TRAINING_GOALS = ["fitness_health","endurance","speed_racing"]` (`:14`).
- `age` int 14–100 (`:26`), `weight_kg` 30–200 (`:27`).
- `available_days` = array of `DAY_CODES = ["mon".."sun"]`, min 1 max 7 + uniqueness refinement (`:16,28-34`).
- `max_workday_minutes` 15–360 (`:35`), `max_weekend_minutes` 15–600 (`:36`).
- Bounds mirror DB CHECKs (`init_mvp_schema.sql:50-59`); DB is declared source of truth (`onboarding-schema.ts:5-9`).

**Equipment + FTP** (`init_mvp_schema.sql`):
- `equipment_type` enum = `'power_meter' | 'hrm' | 'none'` (`:9`; `EquipmentType` at `types.ts:53`). UI labels `OnboardingWizard.tsx:33-37`.
- `ftp_watts smallint` (nullable 50–600), `ftp_source ftp_source` enum `'measured'|'estimated'` (`:41-42,12`).
- **3 coupling CHECK constraints** (`:60-69`): `power_meter_requires_ftp` (power_meter ⇒ ftp_watts AND ftp_source non-null); `hrm_requires_max_hr`; `fitness_level_matches_ftp_source` (`ftp_source='measured'` ⟺ `fitness_level IS NULL`) — measured FTP and fitness_level are mutually exclusive.
- Server-side derivation in `toProfileInsert` (`src/lib/onboarding.ts:37-87`): power_meter + knows_ftp → `ftp_source='measured', fitness_level=null`; power_meter + !knows_ftp → `estimateFtpWatts()`, `ftp_source='estimated'`, keep `fitness_level`; hrm/none → ftp null. Reusable helpers: `estimateFtpWatts` (`onboarding.ts:22-25,12-16`), `defaultMaxHr(age)=220-age` (`:28-30`).

**S-04 deliberately excludes FTP** (3 independent enforcement points):
- `profileEditSchema = commonFields` (`profile-edit-schema.ts:12`), header comment: excludes equipment/FTP/fitness-level/max-HR as "renewal-only (v2 scope)" (`:9-10`).
- `updateProfileFields` updates only the six common columns (`services/profile.ts:41-48`).
- `PATCH /api/profile` validates with `profileEditSchema`, forwards only those fields (`api/profile.ts:28,39-41`).
- `ProfileForm.tsx:307` shows literal copy **"FTP can only be updated at plan renewal."** — S-05 is what makes this true.

**S-04 edit pattern (template for the renewal form):**
- Page: `profile.astro` server-fetches `getProfile`, redirects to `/onboarding` if no profile, renders `<ProfileForm client:load profile={profile} />` (`profile.astro:11-32,46`).
- Island: `ProfileForm.tsx` — numeric fields `number|undefined` (cleared input fails validation, no coerce-to-0) (`:54-61`); `fieldsFromProfile` seeds + filters days through `DAY_CODES` (`:66-75`); dirty-tracking → `canSave = parsed.success && dirty && !submitting` (`:79-89,136-137`); client `profileEditSchema.safeParse` + `z.flattenError` shown after touch (`:124-134`); submit `fetch("/api/profile",{method:"PATCH",...})`, re-baseline snapshot on ok (`:139-168`).
- API: `api/profile.ts` — `prerender=false`, auth 401, JSON parse 400, `safeParse`→400 `{error,fieldErrors}`, SSR client, `updateProfileFields`, generic 500 (no constraint leakage), `{ok:true}` (`:7-48`).
- Service: `services/profile.ts` — `getProfile` (`:12-20`), `upsertProfile` `onConflict:"user_id"` (`:26-32`), `updateProfileFields` partial update (`:41-48`).

**Equipment-conditional rendering precedents (for the FTP gate):**
- `OnboardingWizard.tsx:306-421` — equipment radio, then `equipment_type==="power_meter"` block (`:324-376`) toggling "Do you know your FTP?" → FTP `NumberField` or `FitnessLevelField`; `selectEquipment()` resets branch fields on switch (`:143-155`) so prior-branch values can't leak.
- `ProfileForm.tsx:286-308` — read-only `equipment_type==="power_meter"` FTP row else fitness-level row. **FTP gate = render FTP input only when `profile.equipment_type==="power_meter"`** (mirror `ProfileForm.tsx:288` / `OnboardingWizard.tsx:324`); HRM/none users never see it and must not send it.

**Validation conventions:** nested `z.discriminatedUnion` for equipment↔FTP coupling (Zod 4 needs unique discriminators, hence nesting) (`onboarding-schema.ts:54-84,92-120`); server is the trust boundary — `ftp_source`/`fitness_level`/`max_hr`/estimated FTP are derived server-side, never trusted from client (`onboarding.ts:4-8,37-87`); same schema client+server; generic DB error messages (`api/profile.ts:43-44`); DB CHECKs as final backstop.

**Implication:** the renewal schema can't reuse `profileEditSchema` (no FTP) and shouldn't reuse `updateProfileFields` for power-meter users (would leave `ftp_source`/`fitness_level` stale and risk violating `fitness_level_matches_ftp_source`). Cleanest: a new renewal schema that, for power-meter equipment, accepts updated `ftp_watts` and a server-side derivation setting `ftp_source='measured', fitness_level=null` (reusing `onboarding.ts:51-60` logic).

### 4. Entry-flow interception (routing & middleware)

**`src/middleware.ts`:**
- `PROTECTED_ROUTES = ["/dashboard","/onboarding","/profile"]` (`:5`), matched via `startsWith` (`:19`).
- Resolves `locals.user` via `createClient(request.headers, cookies)` + `auth.getUser()` (`:8-17`; helper `supabase.ts:6` returns null if env missing).
- Unauthenticated on protected route → `redirect("/auth/signin")` (`:20-22`).
- **Existing app-state gate (the precedent to mirror)** (`:24-40`): reads `getProfile`; **no profile + not on `/onboarding` → redirect `/onboarding`** (`:31-33`); **has profile + on `/onboarding` → redirect `/dashboard`** (`:34-36`). The `onOnboarding` flag (`:27`) is the loop-guard. Wrapped in `try/catch` that **fails open** (`:37-40`).

**`src/pages/dashboard.astro`:** reads `Astro.locals.user` (`:7`), builds SSR client (`:15`), `getActivePlan` (`:18`) then `getPlanWithSessions` if a plan exists (`:20`); **no redirect guard** — null plan flows to `<PlanView client:load plan={plan} />` which triggers generation client-side (`:57`); read failures fail open to `plan=null` (`:22-28`). Dashboard is render-only; all gating is upstream in middleware.

**Where the renewal gate should live — middleware**, mirroring `middleware.ts:24-40`, plus a dedicated `/renewal` (or `/plan-renewal`) route exempted by an `onRenewal` loop-guard (analog of `onOnboarding`). Rationale: entry-placement decisions already live in middleware (covers `/dashboard` and `/profile`, not just one page); the gate is a near-exact structural copy (read active plan, if `end_date < today` redirect `/renewal` unless already there, same fail-open wrapper). **Ordering: the renewal gate must run AFTER the profile gate** (an un-onboarded user has no plan and should still go to `/onboarding` first).

**Redirect convention:** no shared helper — Astro built-in used directly. Server-side: `context.redirect(...)` in middleware (`:21,32,35`). Client hand-offs: `window.location.href` (e.g. `OnboardingWizard.tsx:173`). A renewal gate should use `context.redirect("/renewal")`.

**Onboarding → generation hand-off (the two-step shape renewal mirrors):** island POSTs to API then hard-navigates (`OnboardingWizard.tsx:166-174`); `POST /api/onboarding` validates + `toProfileInsert` + `upsertProfile` returns `{ok:true}` (`api/onboarding.ts:17-43`); generation is a *separate* route triggered after landing (`POST /api/plans/generate`). **Renewal divergence:** `generate.ts:50-59` is hard-wired idempotent — it returns the existing active plan rather than regenerating — so renewal must retire the old plan (`active → expired`/`superseded`) before `persistPlan`'s phase-3 activation, or generation hands back the stale plan.

## Code References

- `src/pages/api/plans/generate.ts:40-123` — generation route: auth, idempotency short-circuit (`:50-59`), profile load, retry/budget loop, trust boundary (`:105`), persist (`:112-119`).
- `src/lib/plan.ts:18,23-27,66-131,168-198,209,221-228,236,261` — PROMPT_VERSION, equipment→target-kind, validation, prompt builder, date helpers, insert factories.
- `src/lib/services/plan.ts:22-25,28-39,42-74,95-145` — unique-index note, `getActivePlan`, `getPlanWithSessions`, `persistPlan` (3-phase, 23505-idempotent-win at `:133-141`).
- `src/lib/services/openrouter.ts:16,20,21,90,96,117-121,128-132` — model config, `generateStructured`, deadline handling.
- `src/lib/services/profile.ts:12-20,26-32,41-48` — `getProfile`, `upsertProfile`, `updateProfileFields`.
- `src/lib/onboarding.ts:4-8,12-16,22-30,37-87` — server-side derivation, `estimateFtpWatts`, `defaultMaxHr`, `toProfileInsert`.
- `src/lib/onboarding-schema.ts:14,16,24-37,54-84,92-120` — TRAINING_GOALS, DAY_CODES, commonFields, discriminated unions.
- `src/lib/profile-edit-schema.ts:9-12` — `profileEditSchema = commonFields`, FTP-exclusion comment.
- `src/pages/api/profile.ts:7-48` — PATCH route shape.
- `src/pages/profile.astro:11-46` — server fetch + island render pattern.
- `src/components/profile/ProfileForm.tsx:54-89,124-168,286-308` — form island pattern + equipment-conditional read-only FTP + "renewal" copy (`:307`).
- `src/components/onboarding/OnboardingWizard.tsx:143-155,306-421,166-174` — `selectEquipment` reset, conditional FTP rendering, POST-then-navigate.
- `src/middleware.ts:5,8-40` — protected routes, profile-presence gate, loop-guard, fail-open.
- `src/pages/dashboard.astro:7-57` — render-only entry, `getActivePlan`.
- `supabase/migrations/20260602182721_init_mvp_schema.sql:9,12,13,14,41-42,60-69,99-117,123-140,146-221` — enums, FTP coupling CHECKs, plans/sessions schema, 28-day window, `one_active_plan_per_user`, RLS.
- `supabase/migrations/20260613224500_add_pending_plan_status.sql:8` — `pending` enum value.
- `supabase/migrations/20260615210417_add_set_session_status_rpc.sql` — RPC precedent for any new aggregate.

## Architecture Insights

- **Profile-pure generation core** — generation functions depend only on `Profile`, making renewal a matter of (update profile) → (retire old plan) → (reuse the exact same generation + persist path). Onboarding-specificity lives only in the route's guard messages and the idempotency short-circuit.
- **DB is the final trust boundary** — bounds, enums, and cross-field coupling are CHECK-enforced; app schemas mirror them and are declared subordinate to the DB. Renewal must respect `fitness_level_matches_ftp_source` by deriving server-side, never trusting client-sent derived fields.
- **Crash-safe, single-active-plan invariant** — the `pending → active` persist dance + partial unique index guarantee at most one active plan and no sessionless active plan. Renewal must extend this invariant to "retire-then-activate" atomically.
- **Centralized entry gating with loop-guard + fail-open** — middleware is the established place for app-state redirects; the onboarding gate is a copy-paste-shaped precedent for the renewal gate.
- **Two-step UI hand-off** — POST to API then hard-navigate; generation is a distinct route from input-persistence.

## Historical Context (from prior changes)

- `context/archive/2026-06-10-first-plan-generation/` — S-02; origin of the generation pipeline, prompt builder, trust boundary, OpenRouter integration, and the `pending` plan status. Directly reused here.
- `context/archive/2026-06-15-session-tracking/` — S-03; `session_status` enum + `set_session_status` RPC; relevant if S-05 chooses a completion-count expiry signal.
- `context/archive/2026-06-17-profile-editing/` — S-04; `profileEditSchema`, `ProfileForm`, `updateProfileFields`, and the deliberate FTP exclusion + "FTP can only be updated at plan renewal" copy that S-05 fulfills.
- `context/archive/2026-05-31-data-schema-and-rls/` — F-01; the `plans`/`plan_sessions` schema, 28-day window CHECK, `one_active_plan_per_user` index, and RLS policies.

## Related Research

None — this is the first `research.md` in `context/changes/`. Prior slices were archived without research artifacts.

## Open Questions

These are for `/10x-plan` and product to resolve, not blockers for planning:

1. **Expiry detection mechanism** — date-based (`end_date < today`, recommended; self-contained, no missing transition) vs session-completion count. Roadmap notes date-based is the safe default. Decision also touches timezone: compare against server UTC date or client local date? (Data model has no per-user timezone.)
2. **Old-plan retirement: atomic strategy** — extend `persistPlan` to flip the prior active plan to `expired`/`superseded` in the same phase-3 step, or add a dedicated transaction/RPC (mirroring `set_session_status`). Either way `persistPlan`'s "23505 = idempotent win" branch must not fire for an intentional renewal. Also: which terminal status — `expired` (calendar) vs `superseded` (replaced by renewal)?
3. **Regenerate/force flag** — `generate.ts`'s idempotency short-circuit must be bypassed for renewal. New dedicated renewal endpoint, or a `force`/`regenerate` parameter on the existing route?
4. **Renewal input scope & schema** — confirm the check-in collects exactly {goal, available_days, max_workday_minutes, max_weekend_minutes} for all users plus {ftp_watts} for power-meter users (US-02 AC). New renewal zod schema (since `profileEditSchema` excludes FTP and onboarding schema demands the full equipment branch).
5. **What the user sees if they decline / how "next visit" persists** — must the renewal check-in block all protected routes until completed (like onboarding), or be dismissible? Roadmap says "first screen on next visit"; the onboarding gate is hard (blocks until done) — confirm renewal matches.
