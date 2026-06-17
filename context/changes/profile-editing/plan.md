# Profile Editing Implementation Plan

## Overview

Let an onboarded cyclist edit their **training goal, age, weight, and weekly availability** (training days + max workday/weekend session minutes) after onboarding, on a dedicated `/profile` page. Changes save immediately via a single Save action. The active plan is **not** regenerated, and FTP / equipment / fitness-level / max-HR are **not** editable here (v2 scope) — they render read-only with a note that FTP changes at plan renewal. Roadmap slice **S-04**, PRD **FR-010**.

## Current State Analysis

- **Profile row** lives in `profiles` (PK `user_id`), defined in `supabase/migrations/20260602182721_init_mvp_schema.sql:35-70`. The six FR-010-editable columns are `goal`, `age`, `weight_kg`, `available_days`, `max_workday_minutes`, `max_weekend_minutes`. The non-editable columns (`equipment_type`, `ftp_watts`, `ftp_source`, `fitness_level`, `max_hr`) are governed by cross-field CHECK constraints (`migration:50-69`) tying equipment to FTP/HR/fitness-level — none of which the editable set touches.
- **The editable set maps 1:1 to `commonFields`** in `src/lib/onboarding-schema.ts:24-37` — a zod object whose bounds already mirror the DB CHECK constraints exactly. No new bounds need authoring, and crucially **no server-side derivation is required** (derivation in `src/lib/onboarding.ts` only computes FTP/ftp_source/fitness_level/max_hr, which are out of scope here).
- **Write path exists**: `src/lib/services/profile.ts` exposes `getProfile()` (read) and `upsertProfile()` (idempotent upsert on `user_id`). All calls go through the caller's RLS-scoped SSR client.
- **API pattern** is set by `src/pages/api/onboarding.ts`: `prerender = false`, auth via `context.locals.user`, parse JSON, `schema.safeParse` → `z.flattenError` field errors on 400, create RLS client, generic 500 message that never leaks constraint names.
- **Form pattern** is set by `src/components/onboarding/OnboardingWizard.tsx`: plain React `useState`, per-field `touched` tracking, zod `.safeParse` for client gating, shadcn primitives (`Input`, `RadioGroup`, `Checkbox`, `Label`, `Button`), `FieldError` helper, `toNum()` for numeric inputs. No react-hook-form.
- **Page pattern** is set by `src/pages/onboarding.astro`: thin Astro shell mounting a React island `client:load` inside `Layout.astro` with the cosmic background.
- **Route protection**: `src/middleware.ts` resolves the user, gates `PROTECTED_ROUTES`, and redirects onboarded users away from `/onboarding` (and un-onboarded users to it). `/profile` must be added to `PROTECTED_ROUTES`.
- **Entry point**: `src/pages/dashboard.astro` header currently holds only the user email and a Sign-out form — room for a "Profile" link.

## Desired End State

An onboarded user clicks "Profile" in the dashboard header, lands on `/profile`, sees their current goal/age/weight/availability pre-filled and their equipment + FTP (or fitness level) shown read-only with "FTP can only be updated at plan renewal." They change any of the four editable areas, click Save (enabled only when something changed), and the change persists — verifiable by reloading the page and by the value being reflected on next plan renewal. The current active plan is unchanged. Verify: `npm run lint` and `npm run build` pass; manual edit + reload round-trips each field; a non-power-meter user sees fitness level (not FTP) in the read-only block; an unauthenticated request to `PATCH /api/profile` returns 401.

### Key Discoveries:

- FR-010 editable set == `commonFields` shape (`src/lib/onboarding-schema.ts:24-37`) — reuse verbatim, no new validation, no derivation.
- `upsertProfile` (`src/lib/services/profile.ts:25-31`) and `getProfile` (`:11-19`) already cover the data access; only a focused column `update()` is new.
- API error/response contract to mirror: `src/pages/api/onboarding.ts:10-49`.
- Equipment/FTP CHECK constraints (`migration:50-69`) are never touched because those columns aren't in the update set — so a partial column `update()` is safe.

## What We're NOT Doing

- **Not** editing FTP, equipment type, fitness level, or max-HR (v2 — renewal-only per PRD FR-012 / Non-Goals).
- **Not** regenerating or mutating the active plan or its sessions when goal/availability change (PRD Non-Goal: no mid-plan adaptation).
- **Not** warning/confirming on save or blocking availability edits — saves are silent with an inline "applies at next renewal" note.
- **Not** adding autosave/per-field PATCH — single Save button, full 6-field body.
- **Not** building a shared Topbar/nav component refactor — just a link in the existing dashboard header.
- **Not** adding a shadcn Dialog/Sheet primitive — `/profile` is a full page.
- **Not** persisting a client-side draft to localStorage (single-page form, unlike the multi-step wizard).

## Implementation Approach

Two phases, backend then frontend. Phase 1 adds a reusable `profileEditSchema` (the exported `commonFields` shape) and a `PATCH /api/profile` route plus a `updateProfileFields` service call that updates exactly the six columns scoped to `user_id` (RLS-enforced). Phase 2 builds the `/profile` Astro page + a `ProfileForm` React island that loads the current profile (server-rendered into the island as a prop, matching how `dashboard.astro` passes `plan`), edits the four areas, renders the fixed fields read-only, and saves via the new endpoint with a dirty-flag-gated button. A "Profile" link is added to the dashboard header and `/profile` to `PROTECTED_ROUTES`.

## Critical Implementation Details

- **No derivation, partial column update is safe**: because the update set excludes every column involved in the equipment/FTP/fitness-level CHECK constraints, a `.update()` of only the six editable columns can never violate a constraint regardless of the row's equipment branch. Do not route this through `toProfileInsert`/`upsertProfile` (those rebuild the full row and expect equipment fields).
- **Read-only field source**: which fixed field to show depends on the row — `equipment_type === 'power_meter'` → show `ftp_watts` (+ `ftp_source`); otherwise show `fitness_level`. HRM additionally has `max_hr`. Drive this off the loaded `Profile` row, not off form state.

## Phase 1: Edit schema + PATCH API route

### Overview

Expose the shared validation shape and a focused update endpoint, independently testable with curl/lint/build before any UI exists.

### Changes Required:

#### 1. Export the shared edit schema

**File**: `src/lib/onboarding-schema.ts`

**Intent**: Make the existing equipment-independent field group reusable by the profile editor without duplicating bounds, so onboarding and profile-edit stay DB-synced from one source.

**Contract**: Add `export` to the existing `commonFields` const (currently module-private at line 24). Do not change its shape or bounds.

**File**: `src/lib/profile-edit-schema.ts` (new)

**Intent**: Provide a named schema + inferred type for the profile-edit request, decoupled from the onboarding union so future divergence is cheap.

**Contract**: `export const profileEditSchema = commonFields;` (imported from `@/lib/onboarding-schema`) and `export type ProfileEditInput = z.infer<typeof profileEditSchema>;`. The validated object has exactly: `goal`, `age`, `weight_kg`, `available_days`, `max_workday_minutes`, `max_weekend_minutes`.

#### 2. Service: focused column update

**File**: `src/lib/services/profile.ts`

**Intent**: Add a data-access function that updates only the six editable columns for the caller's own row, under RLS.

**Contract**: `export async function updateProfileFields(supabase, userId: string, fields: ProfileEditInput): Promise<{ error: { message: string } | null }>` — calls `supabase.from("profiles").update(fields).eq("user_id", userId)`, returning the same `{ error }` envelope shape as `upsertProfile`. Does not touch equipment/FTP columns.

#### 3. PATCH route

**File**: `src/pages/api/profile.ts` (new)

**Intent**: Validate and persist the four editable areas for the authenticated user, mirroring the onboarding route's auth/validation/error contract.

**Contract**: `export const prerender = false;` and `export const PATCH: APIRoute`. Flow: 401 if no `context.locals.user`; parse JSON (400 on bad JSON); `profileEditSchema.safeParse` → on failure `{ error: "Validation failed", fieldErrors }` via `z.flattenError` (400); create RLS client (`createClient(context.request.headers, context.cookies)`, 500 if null); `updateProfileFields(...)` → generic `{ error: "Could not save your profile. Please try again." }` on error (500); `{ ok: true }` (200) on success. Reuse the local `json()` helper pattern from `onboarding.ts:10-14`.

### Success Criteria:

#### Automated Verification:

- Type checking + lint pass: `npm run lint`
- Production build succeeds: `npm run build`

#### Manual Verification:

- `PATCH /api/profile` with no session returns 401.
- A valid body updates the row (verify via Supabase or a follow-up `getProfile`) and leaves `equipment_type`, `ftp_watts`, `ftp_source`, `fitness_level`, `max_hr` unchanged.
- An out-of-bounds value (e.g. `age: 5`, empty `available_days`) returns 400 with `fieldErrors` and does not write.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Profile page, form island, and entry point

### Overview

Build the user-facing `/profile` page and form, wire navigation, and protect the route.

### Changes Required:

#### 1. Protect the route

**File**: `src/middleware.ts`

**Intent**: Require auth for `/profile` and confirm onboarded users aren't bounced away from it.

**Contract**: Add `/profile` to the `PROTECTED_ROUTES` list. Verify the existing onboarded/un-onboarded redirect logic doesn't redirect `/profile` (only `/onboarding` is gated that way).

#### 2. Profile page shell

**File**: `src/pages/profile.astro` (new)

**Intent**: Server-render the current profile and mount the form island, mirroring `dashboard.astro`'s server-fetch-then-prop pattern.

**Contract**: Use `Layout.astro`. Server-side: get `user` from `Astro.locals`, create RLS client, `getProfile(supabase, user.id)`; pass the `Profile` row to `<ProfileForm client:load profile={profile} />`. Handle the two non-happy reads distinctly (note `getProfile` *throws* on a read failure — `services/profile.ts:15-18`):
- `getProfile` returns **null** (no profile) → redirect to `/onboarding` (mirrors middleware intent; largely a defensive cover since middleware already gates this).
- `getProfile` **throws** (transient read error) → catch and redirect to `/dashboard`, not `/onboarding` — an onboarded user hit a blip and must not be bounced into onboarding. Mirrors `dashboard.astro:21-29`'s deliberate fail-open posture (don't 500 the page).

#### 3. Profile form island

**File**: `src/components/profile/ProfileForm.tsx` (new)

**Intent**: Editable form for the four FR-010 areas with read-only display of the fixed fields, single dirty-gated Save, and inline notes about renewal + plan drift.

**Contract**: Props: `{ profile: Profile }`. Local `useState` seeded from `profile` for the six editable fields; `touched` tracking and `FieldError` display mirroring `OnboardingWizard.tsx`. Editable controls: goal (`RadioGroup`), age + weight (`Input`/number via `toNum`), available_days (`Checkbox` per `DAY_CODES`; rebuild the selected array by filtering `DAY_CODES` in order so it stays canonical — the dirty compare against the baseline is then order-stable and a toggle-off/on doesn't falsely mark the form dirty), max_workday_minutes + max_weekend_minutes (`Input`/number). Client-side `profileEditSchema.safeParse` gates Save; Save also disabled unless state differs from a `savedSnapshot` baseline (dirty flag). The baseline is a `useState` seeded from the six editable fields of `profile`, and is **reset to the just-saved values on a successful PATCH** — so the form re-disables Save after save without a page reload (single-page island, no reload flash). Read-only block: if `profile.equipment_type === 'power_meter'` show FTP (+ source); else show `fitness_level`; if `hrm` also show `max_hr` — each non-editable, with helper text "FTP can only be updated at plan renewal." One-line note near availability/goal: "Changes apply to your next plan; your current plan stays as-is." On Save: `PATCH /api/profile` with the full six-field body; on success, update `savedSnapshot` to the submitted values (re-disabling Save) and show an inline success state; on failure show inline error states (parse `fieldErrors` like the wizard does).

#### 4. Entry point link

**File**: `src/pages/dashboard.astro`

**Intent**: Give users a way to reach `/profile`.

**Contract**: Add a "Profile" link (anchor to `/profile`) in the header row alongside the email/Sign-out, styled to match the existing Sign-out button.

### Success Criteria:

#### Automated Verification:

- Type checking + lint pass: `npm run lint`
- Production build succeeds: `npm run build`

#### Manual Verification:

- Visiting `/profile` unauthenticated redirects to sign-in; authenticated + onboarded loads the form pre-filled with current values.
- Editing each of goal, age, weight, days, workday minutes, weekend minutes and clicking Save persists — confirmed by a page reload showing the new values.
- Save button is disabled until a field changes and re-disables after a successful save.
- A power-meter user sees FTP read-only; an HRM/none user sees fitness level (and HRM sees max-HR) — none editable, with the renewal note visible.
- Invalid input (e.g. blank required field, age below 14) shows an inline field error and blocks Save.
- The active plan on the dashboard is unchanged after editing availability/goal.

**Implementation Note**: After automated verification passes, pause for manual confirmation.

---

## Testing Strategy

No test runner is configured (per CLAUDE.md), so verification is lint + build + manual.

### Manual Testing Steps:

1. As an onboarded power-meter user, open the dashboard, click "Profile", confirm fields are pre-filled and FTP shows read-only with the renewal note.
2. Change goal, age, weight, toggle a training day, change workday/weekend minutes; confirm Save enables only after a change.
3. Save; reload `/profile`; confirm all values round-trip.
4. Return to the dashboard; confirm the existing plan is unchanged.
5. Repeat as an HRM user (sees fitness level + max-HR read-only) and a no-equipment user (sees fitness level read-only).
6. Try an invalid value (age 5, clear all days); confirm inline error and blocked Save.
7. Hit `PATCH /api/profile` with no session (e.g. curl); confirm 401.

## Migration Notes

No schema migration — all six columns and their constraints already exist. No data backfill.

## References

- Roadmap slice S-04: `context/foundation/roadmap.md`
- Change identity: `context/changes/profile-editing/change.md`
- Onboarding API contract to mirror: `src/pages/api/onboarding.ts:10-49`
- Shared field bounds: `src/lib/onboarding-schema.ts:24-37`
- Profile data access: `src/lib/services/profile.ts:11-31`
- Form conventions: `src/components/onboarding/OnboardingWizard.tsx`
- Page+island pattern: `src/pages/onboarding.astro`, `src/pages/dashboard.astro`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Edit schema + PATCH API route

#### Automated

- [x] 1.1 Type checking + lint pass: `npm run lint`
- [x] 1.2 Production build succeeds: `npm run build`

#### Manual

- [x] 1.3 `PATCH /api/profile` with no session returns 401
- [x] 1.4 Valid body updates the six columns and leaves equipment/FTP columns unchanged
- [x] 1.5 Out-of-bounds value returns 400 with `fieldErrors` and does not write

### Phase 2: Profile page, form island, and entry point

#### Automated

- [ ] 2.1 Type checking + lint pass: `npm run lint`
- [ ] 2.2 Production build succeeds: `npm run build`

#### Manual

- [ ] 2.3 `/profile` redirects unauthenticated; loads pre-filled for onboarded user
- [ ] 2.4 Each editable field persists and round-trips on reload
- [ ] 2.5 Save disabled until dirty; re-disables after successful save
- [ ] 2.6 Read-only block correct per equipment type with renewal note
- [ ] 2.7 Invalid input shows inline error and blocks Save
- [ ] 2.8 Active plan unchanged after editing availability/goal
