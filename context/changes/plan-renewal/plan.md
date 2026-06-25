# Plan Renewal (S-05) Implementation Plan

## Overview

When a user's 28-day training plan expires, intercept their next visit with a renewal check-in. The user confirms or updates their training goal, weekly availability, and — for power-meter users only — current FTP. Confirming regenerates a fresh 4-week AI plan reflecting the updated inputs and atomically retires the old plan. This closes the core training loop (Stream B) and fulfils the existing "FTP can only be updated at plan renewal" promise shown in the profile editor.

## Current State Analysis

The generation pipeline from S-02 is profile-pure and reusable, but it is hard-wired for *first-plan* generation:

- `POST /api/plans/generate` short-circuits when an active plan exists, returning it with **no LLM call** (`src/pages/api/plans/generate.ts:50-59`). There is no force/regenerate path.
- `persistPlan` (`src/lib/services/plan.ts:95-145`) activates as its phase-3 step and treats a `23505` unique-violation as an **idempotent win** — it deletes its pending row and returns the *existing* active plan. The `one_active_plan_per_user` partial unique index (`init_mvp_schema.sql:117`) guarantees at most one active plan and is never replaced.
- Expiry: `plans.end_date` already exists with a hard 28-day window CHECK (`end_date - start_date = 27`). The `plan_status` enum already includes `expired` and `superseded`, but **nothing in the code ever transitions a plan off `active`** — every plan stays active forever.
- FTP coupling: three DB CHECK constraints (`init_mvp_schema.sql:60-69`) enforce the equipment↔FTP relationship; `fitness_level_matches_ftp_source` makes a measured FTP and a `fitness_level` mutually exclusive. `toProfileInsert` (`src/lib/onboarding.ts:49-86`) encodes the authoritative server-side derivation.
- S-04 profile editing *deliberately* excludes FTP (`src/lib/profile-edit-schema.ts:9-12`); `updateProfileFields` (`src/lib/services/profile.ts:41-48`) updates only the six common columns and never touches FTP.
- Entry gating lives in middleware: the onboarding profile-gate (`src/middleware.ts:24-40`) reads the profile and redirects with a loop-guard + fail-open `try/catch`. This is the structural precedent for the renewal gate.

Full evidence: `context/changes/plan-renewal/research.md`.

## Desired End State

A user whose active plan's `end_date` is before today (server UTC) is redirected to `/renewal` from any protected route. They see their current goal, availability, and (if power-meter) FTP prefilled. On submit, a ~22s progress screen covers generation; the server regenerates a 4-week plan from the updated inputs, atomically supersedes the old plan, and the user lands on `/dashboard` viewing the new active plan. Non-expired users are never gated. Verified by: an expired plan triggers the gate; renewal produces exactly one new active plan with the old one marked `superseded`; the FTP field appears only for power-meter users; generation failure leaves the old plan active and the user able to retry.

### Key Discoveries:

- Reusable generation core: `buildPlanMessages`, `validateGeneratedPlan`, `generateStructured`, `toPlanInsert`, `toSessionInserts`, `nextMonday` are all profile-pure (`src/pages/api/plans/generate.ts:73-119`).
- The crash-safe phased persist (`persistPlan`, `src/lib/services/plan.ts:95-145`) is reusable for phases 1–2 (insert pending plan + sessions); only phase-3 activation must change for renewal.
- RPC precedent for an atomic, RLS-scoped status mutation: `set_session_status` in `supabase/migrations/20260615210417_add_set_session_status_rpc.sql`.
- FTP derivation precedent (measured branch): `src/lib/onboarding.ts:51-60` (`ftp_source='measured', fitness_level=null`).
- Middleware gate precedent: `src/middleware.ts:24-40` (read state → redirect with loop-guard → fail-open).
- Synchronous generation + progress UX precedent: `usePlanGeneration` (`src/components/hooks/usePlanGeneration.ts`) and the dashboard generating branch.

## What We're NOT Doing

- Not editing age/weight at renewal — those stay in the profile editor (S-04). Renewal scope is exactly goal + availability + power-meter FTP (PRD US-02).
- Not adding a background job / cron to proactively flip plans to `expired`. Expiry is computed from `end_date` at read time; the old plan is set to `superseded` only when a renewal actually replaces it.
- Not changing the first-plan path: `POST /api/plans/generate` keeps its idempotent contract untouched.
- Not making the gate dismissible — it is a hard gate mirroring onboarding.
- Not building session history (S-06) or intensity reference (S-07).
- Not introducing per-user timezones; expiry uses the server UTC date.

## Implementation Approach

A dedicated `POST /api/plans/renew` route owns the renewal contract so the S-02 route stays simple. The route updates the profile (only after a valid plan is in hand, so a generation failure doesn't mutate the profile), reuses the generation pipeline against an in-memory merged profile, and persists via `persistPlan` with a new `supersede` option. That option swaps phase-3 activation for a single transactional RPC that flips the old `active` plan → `superseded` and the new `pending` plan → `active` in one statement-ordered transaction, satisfying the `one_active_plan_per_user` index without ever hitting the 23505-idempotent-win branch. A middleware gate (server UTC date) routes expired users to a new `/renewal` page rendering a prefilled form island that shows a progress screen during the synchronous generation, then navigates to the dashboard.

## Critical Implementation Details

- **Status-swap ordering inside the RPC.** The partial unique index `one_active_plan_per_user` is non-deferrable, so within the transaction the old plan must be flipped *off* `active` **before** the new plan is flipped *to* `active`, or the second `UPDATE` violates the index. Do the `superseded` update first, the `active` update second.
- **Generation-before-mutation ordering in the route.** Build the merged profile in memory and generate first; only persist the profile update and the new plan *after* a valid plan is in hand. **Precise failure invariant:** a *generation* failure leaves both the old plan active and the profile untouched (nothing was written). A *post-generation persist* failure (profile update succeeds, then the supersede RPC fails) may leave the profile updated while the old plan stays active — but this is **recoverable**: the old plan remains `active` and expired, so the eligibility guard still passes and a retry regenerates from the same merged profile. The order is deliberate: reversing it (plan-then-profile) would be worse — a profile-update failure after a successful supersede leaves the new plan active+non-expired, so the eligibility guard returns 409 and the now-stale FTP can't be fixed via renewal (FTP isn't editable in the profile editor).
- **FTP trust boundary.** `equipment_type` comes from the stored profile, never the request body. The renewal zod schema carries `ftp_watts` as optional; the *route* requires it when (and only when) the profile is `power_meter`, and the derivation sets `ftp_source='measured', fitness_level=null` to satisfy `fitness_level_matches_ftp_source`. Never accept `ftp_source`/`fitness_level` from the client.

## Phase 1: Atomic supersede-and-activate RPC

### Overview

Add a transactional Postgres function that retires the caller's current active plan and activates a freshly-persisted pending plan in one atomic step, so renewal can replace a plan without tripping the single-active-plan index.

### Changes Required:

#### 1. New migration: supersede-and-activate RPC

**File**: `supabase/migrations/<timestamp>_add_supersede_and_activate_plan_rpc.sql`

**Intent**: Create a `SECURITY INVOKER` function that, in a single transaction, sets the caller's `status='active'` plan to `superseded` and sets the given pending plan to `active`. Runs under the caller's RLS session (mirroring `set_session_status`), so it can only touch the caller's own rows. Returns the activated plan row.

**Contract**: `supersede_and_activate_plan(p_new_plan_id uuid) returns plans`. Body, in order: (1) `update plans set status='superseded', updated_at=now() where user_id = auth.uid() and status='active';` (2) `update plans set status='active', updated_at=now() where id = p_new_plan_id and user_id = auth.uid() and status='pending' returning *` into the result; (3) if no row was activated, `raise exception` so the caller treats it as a failure. `auth.uid()`-scoping + `SECURITY INVOKER` keep RLS in force. Mirror the **boilerplate** of `20260615210417_add_set_session_status_rpc.sql` — `language plpgsql`, `security invoker`, `set search_path = ''`, `revoke execute ... from public, anon` + `grant execute ... to authenticated`. The **contract intentionally differs** from that precedent: it `returns plans` (not `void`) and uses explicit `where user_id = auth.uid()` filters (the precedent relies on RLS alone and signals via raised exceptions). Verify-note: under `search_path = ''`, `auth.uid()` must remain schema-qualified (it lives in the `auth` schema, so `auth.uid()` already resolves correctly); schema-qualify every other object (`public.plans`, `pg_catalog.now()`) as the precedent does.

#### 2. Refresh generated types

**File**: `src/db/database.types.ts` (and re-exports in `src/types.ts` if needed)

**Intent**: Regenerate Supabase types so the new RPC is callable type-safely via `supabase.rpc(...)`.

**Contract**: Run `npm run db:types` after `npx supabase db push --linked`. No hand edits.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db push --linked`
- Types regenerate without error: `npm run db:types`
- Type checking passes: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- In the Supabase SQL editor (as an authenticated role), calling the RPC with a pending plan id flips old→superseded and new→active in one call; calling with a bogus id raises and changes nothing.
- After a manual call, exactly one `active` plan remains for the user.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 2: Renewal domain logic

### Overview

Add the validation schema, the in-memory profile merge + FTP derivation, the expiry helper, the renewal profile-update service function, and the `supersede` option on `persistPlan`.

### Changes Required:

#### 1. Renewal validation schema

**File**: `src/lib/renewal-schema.ts`

**Intent**: Define the renewal check-in input shape — the four equipment-independent fields the user can change plus an optional FTP value. Equipment gating is enforced server-side against the stored profile, not here (the client payload never carries `equipment_type`).

**Contract**: Export `renewalInputSchema` = an object with `goal`, `available_days`, `max_workday_minutes`, `max_weekend_minutes` (picked from `commonFields` in `onboarding-schema.ts` so bounds stay DB-synced) plus `ftp_watts: z.number().int().min(50).max(600).optional()`. Export `type RenewalInput = z.infer<...>`. Header comment noting FTP-required-for-power-meter is a route-level (profile-aware) rule, not a schema rule.

#### 2. Renewal merge + FTP derivation

**File**: `src/lib/renewal.ts`

**Intent**: Produce both the in-memory merged profile (for prompt building + plan snapshot) and the DB update object from a validated renewal input + the stored profile, applying the measured-FTP derivation for power-meter users. Mirrors `toProfileInsert`'s measured branch.

**Contract**: `applyRenewal(profile: Profile, input: RenewalInput): { mergedProfile: Profile; update: Partial<ProfileUpdate> }`. The `update` always contains `goal, available_days, max_workday_minutes, max_weekend_minutes`. When `profile.equipment_type === "power_meter"`, it additionally sets `ftp_watts: input.ftp_watts!, ftp_source: "measured", fitness_level: null`. For `hrm`/`none`, no FTP/fitness fields are touched. `mergedProfile` is `{ ...profile, ...update }`. Does not perform IO.

#### 3. Expiry helper

**File**: `src/lib/services/plan.ts`

**Intent**: A pure predicate deciding whether a plan has expired relative to a given calendar day, used by both the middleware gate and the renew route's eligibility guard.

**Contract**: `export function isPlanExpired(plan: Plan, todayIso: string): boolean` returning `plan.end_date < todayIso`. `todayIso` is a `YYYY-MM-DD` string; callers pass `new Date().toISOString().slice(0, 10)` (server UTC date). Lexicographic comparison is correct for zero-padded ISO dates.

#### 4. Renewal profile-update service

**File**: `src/lib/services/profile.ts`

**Intent**: Persist the renewal field subset (which differs from `updateProfileFields`' six-column set — it omits age/weight and may include the FTP trio) for the caller's own row under RLS.

**Contract**: `export async function updateProfileForRenewal(supabase, userId, update: Partial<ProfileUpdate>): Promise<{ error: { message: string } | null }>` doing `.update(update).eq("user_id", userId)`. The route builds `update` via `applyRenewal`, so the trust boundary stays in app code.

#### 5. `supersede` option on persistPlan

**File**: `src/lib/services/plan.ts`

**Intent**: Let the renewal path reuse the crash-safe phase 1–2 persist (insert pending plan + sessions) but replace phase-3 activation with the atomic RPC, so the old plan is retired in the same transaction the new one activates.

**Contract**: Add an optional fourth arg `opts?: { supersede?: boolean }` to `persistPlan`. When `opts.supersede` is true, phase 3 calls `supabase.rpc("supersede_and_activate_plan", { p_new_plan_id: plan.id })` instead of the plain `update status='active'`; on RPC error, delete the pending row and return `{ error }` (the 23505-idempotent-win branch is *not* used in this mode — the RPC is atomic). On success return `{ plan: <rpc row> }`. Default (no opts) behavior is unchanged for the first-plan path.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- `applyRenewal` for a power-meter profile yields `ftp_source='measured', fitness_level=null` and the new `ftp_watts`; for hrm/none it leaves FTP fields absent from `update`.
- `isPlanExpired` returns true for `end_date` strictly before the given day and false on/after it.

**Implementation Note**: Pause here for manual confirmation before proceeding.

---

## Phase 3: Renewal API route

### Overview

The synchronous endpoint that validates the check-in, guards eligibility, regenerates the plan from the merged profile, and atomically persists the profile update + superseding plan.

### Changes Required:

#### 1. Renew route

**File**: `src/pages/api/plans/renew.ts`

**Intent**: Own the renewal contract end-to-end, mirroring `generate.ts`'s generation loop/budget but with renewal-specific guards and a generation-before-mutation ordering.

**Contract**: `export const prerender = false; export const POST: APIRoute`. Flow:
1. Auth gate → 401 if no `context.locals.user`.
2. Parse JSON (400 on bad) → `renewalInputSchema.safeParse` → 400 `{ error, fieldErrors }` (via `z.flattenError`).
3. SSR client (`createClient`) → 500 if null.
4. Load profile (`getProfile`); 409 if absent.
5. **Eligibility guard**: `getActivePlan`; if none → 409 ("no plan to renew"); if `!isPlanExpired(plan, todayIso)` → 409 ("plan not expired yet").
6. **FTP guard**: if `profile.equipment_type === "power_meter"` and `input.ftp_watts == null` → 400 with a `fieldErrors.ftp_watts` message.
7. `{ mergedProfile, update } = applyRenewal(profile, input)`.
8. Generation loop (copy `generate.ts`'s budget + `MAX_GENERATION_ATTEMPTS` + `generateStructured` + `validateGeneratedPlan(result.content, mergedProfile)` shape, `startDate = nextMonday(new Date())`).
9. On a valid plan: `updateProfileForRenewal(supabase, user.id, update)` (500 on error), then `persistPlan(supabase, toPlanInsert(mergedProfile, startDate, meta), factory, { supersede: true })` (500 on error). Return `{ plan }` 200.
10. Exhausted attempts → 502, generic message (no provider/constraint leakage), matching `generate.ts`.

Use the shared `json()` helper and generation constants extracted in sub-item 2 below (do not re-declare them); match `generate.ts`'s error-copy conventions.

#### 2. Extract shared generation helpers

**File**: `src/lib/services/generation.ts` (new) + edit `src/pages/api/plans/generate.ts`

**Intent**: `json()`, `MAX_GENERATION_ATTEMPTS`, and `GENERATION_BUDGET_MS` are currently module-private in `generate.ts` (`:11-15,21,28`). Lift them into a shared module so the renew and generate routes share one source of truth and the budget/retry caps can't silently diverge.

**Contract**: Move `json`, `MAX_GENERATION_ATTEMPTS`, `GENERATION_BUDGET_MS` into `src/lib/services/generation.ts` as named exports; update `generate.ts` to import them (behavior unchanged — single caller, no signature change); `renew.ts` imports the same. No change to values or semantics.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- POST with an expired plan returns a new plan; the DB shows the old plan `superseded` and exactly one new `active` plan with sessions.
- POST when the active plan is *not* expired returns 409.
- POST as a power-meter user without `ftp_watts` returns 400; with `ftp_watts` it persists `ftp_source='measured'`.
- Simulated generation failure (e.g. bad API key locally) leaves the old plan `active` and the profile unchanged.
- Simulated *persist* failure after the profile update (e.g. force the supersede RPC to error) leaves the old plan `active`; a subsequent retry succeeds (eligibility guard still passes).

**Implementation Note**: Pause here for manual confirmation before proceeding.

---

## Phase 4: Renewal page + form island

### Overview

The `/renewal` destination: a server-rendered page that prefills from the active plan/profile, and a React island that gathers the check-in, gates FTP to power-meter users, and shows a progress screen during the synchronous regeneration.

### Changes Required:

#### 1. Renewal page

**File**: `src/pages/renewal.astro`

**Intent**: Server-fetch the profile (for prefill + equipment) and the active plan (defensive eligibility), then render the form island. Mirror `profile.astro`'s fetch-and-pass pattern and fail-open posture.

**Contract**: Auth via middleware (route added to `PROTECTED_ROUTES` in Phase 5). Fetch `getProfile`; redirect `/onboarding` if no profile. Fetch `getActivePlan`; if no active plan or `!isPlanExpired(plan, todayIso)`, `Astro.redirect("/dashboard")` (defensive — middleware is the primary gate). Render `<RenewalForm client:load profile={profile} />` inside the existing `Layout`.

#### 2. Renewal form island

**File**: `src/components/renewal/RenewalForm.tsx`

**Intent**: Prefilled check-in form for goal + availability (+ FTP for power-meter), validated client-side with `renewalInputSchema`, that POSTs to `/api/plans/renew` and shows a generating progress UI during the ~22s call before navigating to `/dashboard`. Reuse `ProfileForm`'s field/validation/dirty patterns. For the progress UX, **copy and adapt — do not import**: `usePlanGeneration` (`usePlanGeneration.ts:25,54,63`) hardcodes the `/api/plans/generate` endpoint, `window.location.reload()` on success, and a module-level sessionStorage flag (`wattwise:plan-generated`), and the progress markup is an un-exported local `PlanGenerating()` inside `PlanView.tsx:38-72`. Renewal needs a different endpoint (`/api/plans/renew`) and a different success nav (`window.location.href="/dashboard"`), so it gets its own local submit logic and a copy of the progress markup. This leaves the first-plan generate flow (PlanView, dashboard) untouched.

**Contract**: `export default function RenewalForm({ profile }: { profile: Profile })`. Seed fields from `profile` (goal, available_days filtered through `DAY_CODES`, workday/weekend minutes, and `ftp_watts` when `equipment_type === "power_meter"`). Render the FTP `NumberField` only for power-meter users (mirror `OnboardingWizard.tsx:324` / `ProfileForm.tsx:288`), with copy clarifying "Enter your current FTP" (confirming promotes an estimated value to measured). Submit gating: `renewalInputSchema.safeParse` AND, for power-meter, `ftp_watts` present. On submit: switch to a local "generating" state (spinner/error markup adapted from `PlanGenerating()` in `PlanView.tsx:38-72`, rendered inline in this component — not the shared hook), `fetch("/api/plans/renew", { method: "POST", body: JSON.stringify(parsed) })`; on `res.ok` → `window.location.href = "/dashboard"` (no reload, no shared sessionStorage flag); on failure → surface `{ error, fieldErrors }`, leave the form editable. Guard against double-submit with a local in-flight ref (the same pattern as `usePlanGeneration`, reimplemented locally).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Linting passes: `npm run lint`
- Dev server serves `/renewal` without runtime error: `npm run dev` (manual hit)

#### Manual Verification:

- Visiting `/renewal` (with an expired plan) shows current values prefilled.
- FTP field appears only for power-meter users; hidden for hrm/none.
- Submitting shows the generating progress UI, then lands on `/dashboard` with the new plan.
- Validation errors (e.g. cleared availability, out-of-range FTP) show inline and block submit.

**Implementation Note**: Pause here for manual confirmation before proceeding.

---

## Phase 5: Middleware renewal gate

### Overview

Wire expiry detection into the entry flow so expired users are routed to `/renewal` on their next visit, and ineligible users are kept off it — completing the end-to-end loop.

### Changes Required:

#### 1. Add /renewal to protected routes

**File**: `src/middleware.ts`

**Intent**: Bring `/renewal` under auth + gating like the other app routes.

**Contract**: Add `"/renewal"` to `PROTECTED_ROUTES`.

#### 2. Renewal gate

**File**: `src/middleware.ts`

**Intent**: After the existing profile gate, for an onboarded user not on `/onboarding`, read the active plan and redirect to `/renewal` when it's expired (server UTC date), and bounce off `/renewal` when not eligible. Same loop-guard + fail-open shape as the profile gate.

**Contract**: Inside the existing `try` block, after the profile checks: compute `onRenewal = context.url.pathname.startsWith("/renewal")` and `todayIso = new Date().toISOString().slice(0, 10)`. When `profile` exists and not `onOnboarding`: `const active = await getActivePlan(supabase, user.id)`; `const expired = !!active && isPlanExpired(active, todayIso)`. If `expired && !onRenewal` → `context.redirect("/renewal")`. If `!expired && onRenewal` → `context.redirect("/dashboard")`. The renewal gate must run **after** the profile gate (an un-onboarded user has no plan and must reach `/onboarding` first). Leave the `catch` fail-open behavior unchanged.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- A user with an expired active plan hitting `/dashboard` or `/profile` is redirected to `/renewal`.
- A user with a non-expired plan is never redirected to `/renewal`; hitting `/renewal` directly bounces to `/dashboard`.
- After completing renewal, the user is no longer gated and sees the new plan on `/dashboard`.
- An un-onboarded user still goes to `/onboarding`, not `/renewal`.
- A transient plan-read error falls open to the requested route (no misrouting).

**Implementation Note**: Pause here for final manual confirmation. End-to-end: expire a plan (set `end_date` to a past date in the DB), reload, complete the check-in, confirm a new active plan and a `superseded` old plan.

---

## Testing Strategy

No automated test runner is configured (per CLAUDE.md). Verification is `npm run lint` + `npm run build` (type-checked) + migration apply, plus manual flow testing.

### Manual Testing Steps:

1. Seed/expire: set the active plan's `end_date` to a past date in Supabase.
2. Visit `/dashboard` → expect redirect to `/renewal` with prefilled current values.
3. As a power-meter user: confirm the FTP field is shown and required; submit and confirm `ftp_source='measured'`, `fitness_level=null` in the DB.
4. As an hrm/none user: confirm no FTP field; submit goal/availability changes.
5. After submit: progress UI → `/dashboard` shows the new 4-week plan; the old plan is `superseded`; exactly one `active` plan exists.
6. Edge: non-expired plan never gates; bogus direct `/renewal` visit bounces to `/dashboard`; generation failure leaves old plan active and profile unchanged.

## Performance Considerations

The renew call is synchronous and includes the LLM generation (~22–23s cold, per S-02). The form covers this with the generating progress UI; the route reuses S-02's shared `GENERATION_BUDGET_MS` deadline and retry caps so a degraded upstream can't multiply into minutes.

**Steady-state middleware cost.** Phase 5 adds a `getActivePlan` read to middleware, which runs on every request to every protected route. Combined with the existing per-request `getProfile` (`middleware.ts:24-40`), every onboarded user's protected navigation now performs two sequential Supabase reads in the worker. This is acceptable at MVP scale and mirrors the existing fail-open profile read, but is a candidate for later optimization (cache the active-plan lookup, or short-circuit the plan read on routes that don't gate on expiry).

## Migration Notes

One new migration (Phase 1 RPC). Apply with `npx supabase db push --linked`, then `npm run db:types`. No data backfill — existing active plans simply become eligible for renewal once their `end_date` passes. No schema change to `plans`/`plan_sessions` (the `superseded`/`expired` enum values and `end_date` already exist).

## References

- Research: `context/changes/plan-renewal/research.md`
- Generation pipeline: `src/pages/api/plans/generate.ts:39-124`, `src/lib/services/plan.ts:95-145`
- FTP derivation: `src/lib/onboarding.ts:37-87`
- RPC precedent: `supabase/migrations/20260615210417_add_set_session_status_rpc.sql`
- Middleware gate precedent: `src/middleware.ts:24-40`
- Form island precedent: `src/components/profile/ProfileForm.tsx`, `src/components/hooks/usePlanGeneration.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Atomic supersede-and-activate RPC

#### Automated

- [x] 1.1 Migration applies cleanly: `npx supabase db push --linked` — db19ed9
- [x] 1.2 Types regenerate without error: `npm run db:types` — db19ed9
- [x] 1.3 Type checking passes: `npm run build` — db19ed9
- [x] 1.4 Linting passes: `npm run lint` — db19ed9

#### Manual

- [x] 1.5 RPC flips old→superseded and new→active atomically; bogus id raises and changes nothing — db19ed9
- [x] 1.6 Exactly one active plan remains after a manual call — db19ed9

### Phase 2: Renewal domain logic

#### Automated

- [x] 2.1 Type checking passes: `npm run build` — f5f5761
- [x] 2.2 Linting passes: `npm run lint` — f5f5761

#### Manual

- [x] 2.3 `applyRenewal` derives measured FTP for power-meter, no FTP fields for hrm/none — f5f5761
- [x] 2.4 `isPlanExpired` true for end_date before the day, false on/after — f5f5761

### Phase 3: Renewal API route

#### Automated

- [x] 3.1 Type checking passes: `npm run build` — d224f4d
- [x] 3.2 Linting passes: `npm run lint` — d224f4d

#### Manual

- [x] 3.3 POST with expired plan → new plan; old plan superseded; one active plan with sessions — d224f4d
- [x] 3.4 POST with non-expired plan → 409 — d224f4d
- [x] 3.5 Power-meter without ftp_watts → 400; with it → ftp_source='measured' — d224f4d
- [x] 3.6 Generation failure leaves old plan active and profile unchanged — d224f4d
- [x] 3.7 Persist failure after profile update leaves old plan active; retry succeeds — d224f4d

### Phase 4: Renewal page + form island

#### Automated

- [x] 4.1 Type checking passes: `npm run build` — d24fbfc
- [x] 4.2 Linting passes: `npm run lint` — d24fbfc
- [x] 4.3 Dev server serves `/renewal` without runtime error — d24fbfc

#### Manual

- [x] 4.4 `/renewal` shows current values prefilled — d24fbfc
- [x] 4.5 FTP field shown only for power-meter users — d24fbfc
- [x] 4.6 Submit shows progress UI then lands on `/dashboard` with the new plan — d24fbfc
- [x] 4.7 Validation errors show inline and block submit — d24fbfc

### Phase 5: Middleware renewal gate

#### Automated

- [x] 5.1 Type checking passes: `npm run build` — 930b91d
- [x] 5.2 Linting passes: `npm run lint` — 930b91d

#### Manual

- [x] 5.3 Expired-plan user redirected to `/renewal` from `/dashboard` and `/profile` — 930b91d
- [x] 5.4 Non-expired user never gated; direct `/renewal` visit bounces to `/dashboard` — 930b91d
- [x] 5.5 After renewal, user no longer gated and sees the new plan — 930b91d
- [x] 5.6 Un-onboarded user still routed to `/onboarding`, not `/renewal` — 930b91d
- [x] 5.7 Transient plan-read error falls open to the requested route — 930b91d
