# Onboarding Wizard Implementation Plan

## Overview

Build the WattWise onboarding wizard (roadmap slice S-01): a multi-step React-island form that collects a cyclist's profile — training goal, equipment type, FTP (or a fitness-level estimate), age, weight, weekly availability — with equipment-driven conditional branching, persists in-progress answers to `localStorage` so they survive a browser close, shows a review/confirm screen, and upserts the result into the `profiles` table. The slice ends at "profile saved → dashboard stub"; AI plan generation is the next slice (S-02).

## Current State Analysis

- **Schema is done (F-01).** `public.profiles` exists with `user_id` as PK (one profile per user) and a set of CHECK constraints the form must satisfy exactly (`supabase/migrations/20260602182721_init_mvp_schema.sql:35-70`):
  - `power_meter_requires_ftp` — `equipment_type='power_meter'` ⇒ `ftp_watts` **and** `ftp_source` not null.
  - `hrm_requires_max_hr` — `equipment_type='hrm'` ⇒ `max_hr` not null.
  - `fitness_level_matches_ftp_source` — `ftp_source='measured'` ⇒ `fitness_level` **null**; otherwise (`'estimated'` or null) ⇒ `fitness_level` **not null**. Net effect: estimated-FTP power-meter users, HRM users, and no-equipment users all carry a `fitness_level`; only a measured-FTP power-meter user leaves it null.
  - Range checks: `age` 14–100, `weight_kg` 30–200, `ftp_watts` 50–600, `max_hr` 100–230, `max_workday_minutes` 15–360, `max_weekend_minutes` 15–600.
  - `available_days` is `text[]`, subset of `{mon,tue,wed,thu,fri,sat,sun}`, length 1–7.
- **Auth + middleware exist.** `src/middleware.ts:4` protects only `/dashboard`; `context.locals.user` is set on every request (`env.d.ts` types it as `User | null`). The Supabase SSR client factory is `createClient(headers, cookies)` in `src/lib/supabase.ts` and returns `null` when env is unset.
- **Post-auth flow today:** signup → `/auth/confirm-email` → signin → redirect to `/` (`src/pages/api/auth/signin.ts`). Nothing pushes a logged-in-but-profile-less user anywhere.
- **Types are generated.** `src/types.ts` already re-exports `Profile`, `ProfileInsert`, and the enums (`EquipmentType`, `TrainingGoal`, `FitnessLevel`, `FtpSource`) from `src/db/database.types.ts`.
- **Form stack is bare.** Auth forms (`src/components/auth/SignInForm.tsx`) use plain `useState` + native `<form method="POST">` + redirect-on-error. Only the shadcn `Button` is installed; `zod` is present transitively in `node_modules` but is **not** a direct dependency. No `react-hook-form`.
- **API convention (CLAUDE.md):** uppercase `GET`/`POST` exports, validate input with zod, `export const prerender = false`.

## Desired End State

A logged-in cyclist with no profile is routed to `/onboarding`, completes a grouped multi-step wizard, reviews their answers, and confirms. Their profile is written to `profiles` (one row, all constraints satisfied for any of the three equipment types), and they land on a `/dashboard` showing a "your plan is coming" stub. Re-visiting `/onboarding` with a profile already saved bounces to `/dashboard`. Closing the browser mid-wizard and returning restores the answers and step.

Verify by: completing onboarding as each equipment type (power-meter-with-FTP, power-meter-without-FTP, HRM, none) and confirming a valid `profiles` row is created each time; reloading mid-wizard and seeing answers restored; visiting `/onboarding` post-completion and being redirected.

### Key Discoveries:

- The DB CHECK constraints (`init_mvp_schema.sql:60-69`) are the source of truth for the branching logic — the zod schema and the wizard must mirror them, and a server-side upsert is the final guardrail.
- `profiles.user_id` PK ⇒ submission is an **upsert on `user_id`**, which is naturally idempotent against double-submits/concurrent tabs.
- Existing islands hydrate via `client:load` and receive props from the `.astro` page (`src/pages/auth/signin.astro:16`); follow that pattern for the wizard.
- `db:types` script regenerates `src/db/database.types.ts` from the linked remote — no schema change here, so no regeneration needed.

## What We're NOT Doing

- **No AI plan generation, no `plans`/`plan_sessions` rows** — that is S-02. Confirm only writes a `profiles` row.
- **No profile editing after onboarding** — that is S-04.
- **No server-side draft table** — draft persistence is `localStorage` only (device-local is acceptable for a one-time flow).
- **No `react-hook-form`** — plain React state + a shared zod schema.
- **No changes to the schema/migrations** — the schema is complete and archived.
- **No FTP editing affordance** — FTP is captured once at onboarding; updates are a renewal concern (S-05).
- **No new auth/registration work** — signup/signin/signout already exist and are unchanged except the signin success redirect target.

## Implementation Approach

A single React island (`OnboardingWizard.tsx`) owns all wizard state in plain `useState`, persisting a serialized draft to `localStorage` on every change and rehydrating on mount. Validation is driven by one zod schema (`src/lib/onboarding-schema.ts`) shared by the client (per-step gating + review) and the server (`POST /api/onboarding`). The server route derives any computed fields (estimated FTP, default max-HR fallback), maps the validated DTO to a `ProfileInsert`, and upserts via a small profile service. Routing is enforced centrally in middleware: profile presence decides whether a logged-in user belongs in `/onboarding` or `/dashboard`.

## Critical Implementation Details

**State sequencing (FTP/HR derivation must happen server-side, not just client-side).** The client may show an estimated FTP for transparency, but the authoritative `ftp_watts`/`ftp_source`/`fitness_level`/`max_hr` values must be derived on the server from the validated DTO before the upsert, so a tampered request body can never violate the CHECK constraints. The derivation rules:
- `power_meter` + knows FTP → `ftp_watts` = entered value, `ftp_source='measured'`, `fitness_level=null`.
- `power_meter` + doesn't know FTP → `ftp_watts` = `round(wkg[fitness_level] * weight_kg)` clamped to 50–600, `ftp_source='estimated'`, `fitness_level` set.
- `hrm` → `max_hr` = entered value (default-prefilled to `220 − age` in the UI, overridable), `ftp_watts=null`, `ftp_source=null`, `fitness_level` set.
- `none` → `ftp_watts=null`, `ftp_source=null`, `max_hr=null`, `fitness_level` set.

**W/kg constants (pin these):** `beginner = 2.0`, `intermediate = 2.8`, `advanced = 3.7` W/kg. Document them inline as the agreed estimation table.

## Phase 1: Foundations — deps, primitives, schema, helpers

### Overview

Add the dependency and UI primitives the wizard needs, and write the shared validation schema, DTO type, and estimation helpers that Phases 2–3 both consume. No user-visible change yet.

### Changes Required:

#### 1. Add zod as a direct dependency

**File**: `package.json`

**Intent**: Promote `zod` to a declared dependency so the shared onboarding schema can be imported by both client and server per CLAUDE.md's "validate input with zod" convention.

**Contract**: `zod` appears under `dependencies`; `npm install` succeeds and `npm run build` resolves the import.

#### 2. Install shadcn primitives

**File**: `src/components/ui/{input,label,select,checkbox,radio-group,card,progress}.tsx` (generated)

**Intent**: Provide the form controls the multi-step wizard renders. Install via `npx shadcn@latest add input label select checkbox radio-group card progress` (new-york style, per `components.json`).

**Contract**: Each component exists under `src/components/ui/` and imports the existing `cn()` helper. No custom edits in this phase.

#### 3. Shared onboarding zod schema

**File**: `src/lib/onboarding-schema.ts`

**Intent**: One schema describing the wizard's *input* shape (what the user supplies, before server derivation), with a discriminated union on `equipment_type` and a `knows_ftp` discriminator inside the power-meter branch, enforcing the same bounds as the DB. Reused client-side for per-step validation and server-side for request validation.

**Contract**: Export `onboardingInputSchema` (zod) and `type OnboardingInput = z.infer<...>`. Fields: `goal` (enum), `age` (14–100 int), `weight_kg` (30–200), `available_days` (array of the 7 day-codes, 1–7, unique), `max_workday_minutes` (15–360), `max_weekend_minutes` (15–600), plus the equipment-discriminated branch:
- `power_meter` + `knows_ftp: true` → `ftp_watts` (50–600 int).
- `power_meter` + `knows_ftp: false` → `fitness_level` (enum).
- `hrm` → `max_hr` (100–230 int), `fitness_level` (enum).
- `none` → `fitness_level` (enum).

Bounds must match `init_mvp_schema.sql:50-59` exactly.

Additionally export **per-step validators** so Phase 3 can gate each step without re-declaring any bound (the full union can't be `.pick()`/`.partial()`'d per step):
- A base `z.object` of the common fields (`goal`; and `age`, `weight_kg`, `available_days`, `max_workday_minutes`, `max_weekend_minutes`) from which per-step schemas are derived via `.pick(...)` — e.g. `goalStepSchema` (step 1) and `bodyStepSchema` (step 3).
- An `equipmentStepSchema` (step 2) covering `equipment_type` + its branch fields (the discriminated part).
- The full `onboardingInputSchema` is composed from these same pieces, so bounds are defined exactly once and the server and per-step client gating can never drift.

This signature — the full union **plus** the per-step validators — is the contract Phases 2 and 3 depend on.

#### 4. Derivation helpers + DTO export

**File**: `src/lib/onboarding.ts` (helpers) and `src/types.ts` (DTO re-export)

**Intent**: Centralize the FTP-estimate (W/kg × weight) and max-HR (220−age) math, and the mapping from a validated `OnboardingInput` to a `ProfileInsert`. Surface `OnboardingInput` from `src/types.ts` alongside the existing entity types.

**Contract**: Export `estimateFtpWatts(fitness_level, weight_kg): number` (uses `{beginner:2.0, intermediate:2.8, advanced:3.7}`, rounds, clamps 50–600), `defaultMaxHr(age): number` (= `220 − age`), and `toProfileInsert(input: OnboardingInput, userId: string): ProfileInsert` applying the derivation rules in Critical Implementation Details. `src/types.ts` re-exports `OnboardingInput`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build` (or `npx astro check`) — this also proves `zod` resolves as a direct dependency via the shared schema's ESM import
- Linting passes: `npm run lint`

#### Manual Verification:

- The seven shadcn primitives render in isolation without console errors (spot-check one in a scratch page or rely on Phase 3 usage).

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Profile service + onboarding API route

### Overview

Add a thin profile service and the `POST /api/onboarding` endpoint that validates the request with the shared schema, derives computed fields server-side, and upserts the profile. This makes the persistence path testable independently of the UI.

### Changes Required:

#### 1. Profile service

**File**: `src/lib/services/profile.ts`

**Intent**: Encapsulate profile reads/writes so middleware (gating) and the API route share one access path.

**Contract**: Export `getProfile(supabase, userId): Promise<Profile | null>` (selects own row; returns null when absent) and `upsertProfile(supabase, insert: ProfileInsert): Promise<{ error: ... | null }>` (upsert on `user_id`). Uses the passed SSR client so RLS applies under the caller's session.

#### 2. Onboarding API route

**File**: `src/pages/api/onboarding.ts`

**Intent**: Accept the wizard's JSON submission, validate it, derive authoritative profile fields, and persist. Returns JSON (not a redirect) so the island can show inline errors without losing wizard state.

**Contract**: `export const prerender = false;` and `export const POST: APIRoute`. Behavior:
- Reject with 401 JSON if `context.locals.user` is null.
- Parse JSON body; validate with `onboardingInputSchema`. On failure return `400` with `{ error, fieldErrors }` (from `zod` `flatten()`).
- Build `ProfileInsert` via `toProfileInsert(input, user.id)`; call `upsertProfile`.
- On DB error return `500` (or `409`-style message) with a generic `{ error }` — do not leak constraint names.
- On success return `200 { ok: true }`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- `curl -X POST /api/onboarding` (authenticated session cookie) with a valid power-meter-measured body creates a `profiles` row with `ftp_source='measured'`, `fitness_level=null`.
- A power-meter-no-FTP body produces `ftp_source='estimated'`, a clamped `ftp_watts`, and a set `fitness_level`.
- An HRM body stores `max_hr` and null FTP; a none body stores nulls for FTP/max_hr.
- An invalid body (e.g. age 200) returns 400 with field errors and writes nothing.
- Submitting twice for the same user updates the same row (no duplicate-key error).

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: Onboarding wizard island + page

### Overview

Build the multi-step wizard React island with equipment branching, a progress indicator, localStorage draft persistence, a review screen, and fetch-based submission with inline errors; mount it on `/onboarding.astro`.

### Changes Required:

#### 1. Wizard island

**File**: `src/components/onboarding/OnboardingWizard.tsx`

**Intent**: The full client-side wizard. Holds all answers in `useState`, advances through grouped steps, branches on `equipment_type`, validates each step with the shared schema before allowing "next", renders a final review screen, and POSTs to `/api/onboarding`.

**Contract**: Default-exported React component (mounted `client:load`). Steps (grouped): (1) goal; (2) equipment type → conditional sub-fields (power-meter: knows-FTP toggle → FTP input *or* fitness-level select; HRM: max-HR input prefilled with `220−age`; none: fitness-level select); (3) body + availability (age, weight, day checkboxes, workday/weekend max minutes); (4) review (read-only summary of all answers) with a confirm button. Progress indicator reflects current step. "Next" is disabled until the current step's matching per-step validator (from Phase 1 §3) passes. On confirm: POST JSON, and on `200` clear the draft and `window.location` to `/dashboard`; on non-200 show the returned error inline on the review screen with all answers intact. Uses shadcn primitives + the `bg-cosmic`/`white/10` styling idiom from existing pages.

#### 2. Draft persistence

**File**: `src/components/hooks/useOnboardingDraft.ts`

**Intent**: Persist `{ answers, step }` to `localStorage` on change and rehydrate on mount so a browser close mid-wizard doesn't lose data (PRD guardrail). Cleared on successful submit.

**Contract**: Export a hook returning `[draft, setDraft, clearDraft]` backed by a fixed `localStorage` key (e.g. `wattwise:onboarding-draft`). Guards against SSR (`typeof window`) and malformed JSON (falls back to empty draft).

#### 3. Onboarding page

**File**: `src/pages/onboarding.astro`

**Intent**: Server-rendered shell that mounts the wizard island for an authenticated user.

**Contract**: Wraps the island in `Layout`, renders `<OnboardingWizard client:load />`. Auth/profile gating is handled centrally in middleware (Phase 4), so the page itself stays thin.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- Each equipment path can be completed end-to-end and lands on `/dashboard` with the correct `profiles` row.
- "Next" stays disabled until the current step is valid; out-of-range inputs show inline messages.
- Filling part of the wizard, closing the tab, and reopening `/onboarding` restores the answers and step.
- On successful submit the draft is cleared (reopening starts fresh — though gating will now redirect).
- The wizard is usable on a mobile-width viewport (PRD NFR).

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 4: Routing/gating + dashboard stub

### Overview

Wire onboarding into the navigation flow: middleware forces profile-less users into onboarding and keeps profile-having users out, the signin success redirect points at the app, and the dashboard shows a plan-coming stub.

### Changes Required:

#### 1. Middleware profile gating

**File**: `src/middleware.ts`

**Intent**: Make profile presence decide placement. Add `/onboarding` to the protected set; for a logged-in user, look up their profile and redirect: no profile + not on `/onboarding` (within app routes) → `/onboarding`; has profile + on `/onboarding` → `/dashboard`.

**Contract**: Extend `PROTECTED_ROUTES` to include `/onboarding`. After resolving `context.locals.user`, when authenticated call `getProfile`; branch on presence as above. Avoid redirect loops (don't redirect `/onboarding`→`/onboarding`). Public routes (`/`, `/auth/*`) remain reachable without a profile. Keep the existing unauthenticated→`/auth/signin` behavior for protected routes.

#### 2. Signin success redirect

**File**: `src/pages/api/auth/signin.ts`

**Intent**: Send a freshly-signed-in user into the app (`/dashboard`) so middleware can route them to onboarding when they have no profile yet, rather than dropping them on the public landing page.

**Contract**: Change the success redirect target from `/` to `/dashboard`. No other change.

#### 3. Dashboard stub

**File**: `src/pages/dashboard.astro`

**Intent**: For a user who has completed onboarding, show a clear "your 4-week plan is coming" placeholder (the seam S-02 will fill) instead of only the email/sign-out card.

**Contract**: Add a plan-coming-soon section to the existing authenticated dashboard card; keep email display and sign-out. No data fetching beyond what middleware already resolved.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- A new user (no profile) signing in is taken to `/onboarding`, not `/dashboard` or `/`.
- After completing onboarding, the user lands on `/dashboard` and sees the plan-coming stub.
- Navigating back to `/onboarding` with a saved profile redirects to `/dashboard` (no re-entry).
- An unauthenticated visit to `/onboarding` redirects to `/auth/signin`.
- No redirect loops on any route; `/` and `/auth/*` remain reachable.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation. This is the final phase.

---

## Testing Strategy

No test runner is configured (per CLAUDE.md), so verification is build/lint + manual. Each phase's automated gate is `npm run build` + `npm run lint`.

### Manual Testing Steps:

1. Sign up a fresh account → confirm → sign in → land on `/onboarding`.
2. Complete the wizard as a **power-meter user who knows FTP**: confirm a `profiles` row with `ftp_source='measured'`, `fitness_level=null`.
3. Repeat as **power-meter, no FTP**: confirm `ftp_source='estimated'`, `ftp_watts` ≈ `wkg × weight` clamped, `fitness_level` set.
4. Repeat as **HRM**: `max_hr` stored (prefilled `220−age`, overridable), FTP null.
5. Repeat as **no equipment**: FTP and max_hr null, `fitness_level` set.
6. Mid-wizard, close the tab and reopen `/onboarding` → answers and step restored.
7. With a saved profile, visit `/onboarding` → redirected to `/dashboard`.
8. Submit an out-of-range value → inline error, nothing written.
9. Exercise on a mobile-width viewport.

## Performance Considerations

The added middleware profile lookup runs per request on protected routes; at the PRD's stated small scale / low QPS this is negligible. Keep the query to a single-row select on the PK. No caching needed for the MVP.

## Migration Notes

None — no schema changes. The `profiles` table from F-01 is used as-is.

## References

- Change identity: `context/changes/onboarding-wizard/change.md`
- Roadmap slice S-01: `context/foundation/roadmap.md` (§S-01)
- PRD: `context/foundation/prd.md` (FR-002, US-01, NFRs, Guardrails)
- Schema + constraints: `supabase/migrations/20260602182721_init_mvp_schema.sql:35-93`
- Island/auth-form pattern: `src/components/auth/SignInForm.tsx`, `src/pages/auth/signin.astro`
- Supabase SSR client: `src/lib/supabase.ts`
- Middleware: `src/middleware.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Foundations — deps, primitives, schema, helpers

#### Automated

- [x] 1.1 Type checking passes: `npm run build` (also proves `zod` resolves via the shared schema import) — abbce47
- [x] 1.2 Linting passes: `npm run lint` — abbce47

#### Manual

- [x] 1.3 Seven shadcn primitives render without console errors — abbce47

### Phase 2: Profile service + onboarding API route

#### Automated

- [x] 2.1 Type checking passes: `npm run build` — 7409ca7
- [x] 2.2 Linting passes: `npm run lint` — 7409ca7

#### Manual

- [x] 2.3 Power-meter-measured body creates row with `ftp_source='measured'`, `fitness_level=null` — 7409ca7
- [x] 2.4 Power-meter-no-FTP body produces `ftp_source='estimated'`, clamped `ftp_watts`, set `fitness_level` — 7409ca7
- [x] 2.5 HRM body stores `max_hr`/null FTP; none body stores null FTP and max_hr — 7409ca7
- [x] 2.6 Invalid body returns 400 with field errors and writes nothing — 7409ca7
- [x] 2.7 Submitting twice for the same user updates one row (no duplicate-key error) — 7409ca7

### Phase 3: Onboarding wizard island + page

#### Automated

- [x] 3.1 Type checking passes: `npm run build` — d32584d
- [x] 3.2 Linting passes: `npm run lint` — d32584d

#### Manual

- [x] 3.3 Each equipment path completes end-to-end and lands on `/dashboard` with the correct row — d32584d
- [x] 3.4 "Next" disabled until step valid; out-of-range inputs show inline messages — d32584d
- [x] 3.5 Close-and-reopen mid-wizard restores answers and step — d32584d
- [x] 3.6 Draft cleared on successful submit — d32584d
- [x] 3.7 Wizard usable on a mobile-width viewport — d32584d

### Phase 4: Routing/gating + dashboard stub

#### Automated

- [x] 4.1 Type checking passes: `npm run build` — f13d8ff
- [x] 4.2 Linting passes: `npm run lint` — f13d8ff

#### Manual

- [x] 4.3 New user (no profile) signing in is routed to `/onboarding` — f13d8ff
- [x] 4.4 After onboarding, user lands on `/dashboard` with plan-coming stub — f13d8ff
- [x] 4.5 Visiting `/onboarding` with a saved profile redirects to `/dashboard` — f13d8ff
- [x] 4.6 Unauthenticated visit to `/onboarding` redirects to `/auth/signin` — f13d8ff
- [x] 4.7 No redirect loops; `/` and `/auth/*` remain reachable — f13d8ff
