# Session History (S-06) Implementation Plan

## Overview

Add a read-only `/history` page that lists every **completed** (`status = 'done'`) session across all of the user's plans — current and past — newest first. Each row shows the session date, type, logged duration, subjective rating, and km ridden. This delivers FR-009 and the PRD's secondary success criterion: history persists across plan renewals so the app "feels like a real training log."

The feature is a pure read over existing tables. No schema, migration, API route, or client-side state is introduced. The page is rendered entirely server-side as Astro (no React island) because nothing on it is interactive.

## Current State Analysis

- **Data exists and is RLS-scoped.** `plan_sessions` (`status` enum `pending`/`done`/`skipped`, `scheduled_date date`, `session_type` enum, `title`) is 1:1 with `session_logs` (`actual_duration_min`, `rating`, `km_ridden`, `logged_at`) via `session_logs.plan_session_id` being both FK and PK. RLS on both tables walks up via `EXISTS` to `plans.user_id = auth.uid()` — `supabase/migrations/20260602182721_init_mvp_schema.sql:145,176,227,240`. A query that omits any `plan_id` filter therefore returns only the caller's own sessions across every plan they own.
- **Query pattern is established.** `getPlanWithSessions` (`src/lib/services/plan.ts:55`) embeds the log with `select("*, session_logs(*)")` and normalizes the to-one embed (`{ session_logs, ...session } → { ...session, log: session_logs }`) into `PlanSessionWithLog[]`. The history query is the same shape minus the `plan_id` filter, plus a `status` filter and a `scheduled_date` order.
- **Types are ready.** `PlanSessionWithLog = PlanSessionView & { log: SessionLog | null }` (`src/types.ts:41`). A `done` session always has a log row (the `set_session_status` RPC upserts it), so `log` is non-null in practice for history rows.
- **Page pattern is established.** `dashboard.astro:7,14-30` reads `Astro.locals.user`, creates a per-request `createClient(Astro.request.headers, Astro.cookies)`, fetches server-side inside try/catch (fail-open to a null/empty fallback so a transient read never 500s the page), and renders inside `Layout`.
- **`formatDate` helper exists** but is local to `PlanView.tsx:105-113` (UTC-safe `YYYY-MM-DD → "Jun 15"`). It is not exported or shared.
- **Middleware renewal gate** (`src/middleware.ts:6,45-50`) redirects *every* protected route to `/renewal` when the active plan is expired. A naive `/history` would be unreachable exactly when a user with a lapsed plan wants to review past work.
- **`Card` exists** in `src/components/ui/card.tsx`; there is no `table` component. Existing layouts use manual grid/flex. There is an `.astro` `LibBadge` but session-type styling in PlanView is done with inline Tailwind.

## Desired End State

A signed-in, onboarded user can open `/history` (via a link on the dashboard) and see a scrollable, reverse-chronological list of all their completed sessions, each row showing date, session type, logged duration, rating, and km. When they have no completed sessions, a friendly empty state is shown. The page is reachable even when their plan has expired. No other user's data is ever visible.

Verify: sign in as a user with completed sessions across two plans → `/history` lists all of them newest-first with correct logged values; a fresh user sees the empty state; `npm run lint` and `npm run build` pass.

### Key Discoveries:

- RLS makes the cross-plan query safe by construction — no `user_id` filter needed, only the implicit `auth.uid()` scope (`...init_mvp_schema.sql:176,240`).
- The to-one embed must be read as a single object/null, never `[0]` — see the normalization note at `src/lib/services/plan.ts:64-85`.
- `formatDate` is private to `PlanView.tsx:105`; reuse requires lifting it to a shared helper (see Phase 2 decision).
- The renewal gate is the only non-obvious blocker; it needs a targeted exemption (Phase 3).

## What We're NOT Doing

- No pagination, "load more", or infinite scroll — render all rows; the list is CSS-scrollable. PRD declares small data volumes (~20 sessions/plan, v1 horizon).
- No React island / client interactivity — the page is read-only.
- No grouping by week or plan block — flat reverse-chronological list.
- No skipped or pending sessions — `done` only (FR-009 = "completed sessions").
- No new aggregate stats (totals, streaks), filters, sorting controls, or detail expansion.
- No schema, migration, RPC, API route, or `src/types.ts` table-type changes.
- No new shadcn `table` component install.

## Implementation Approach

Three thin phases, each independently verifiable:

1. **Data access** — one new service function on the existing plan service that runs the cross-plan completed-session query under the caller's RLS client.
2. **History page & component** — a server-rendered Astro page that fetches via the new service and renders a presentational Astro list component with an empty state.
3. **Routing & navigation** — register `/history` as protected, exempt it from the renewal gate, and link to it from the dashboard.

## Phase 1: Data access

### Overview

Add a service function returning the caller's completed sessions across all plans, newest first, with logs embedded — reusing the embed/normalization pattern from `getPlanWithSessions`.

### Changes Required:

#### 1. Completed-sessions query

**File**: `src/lib/services/plan.ts`

**Intent**: Add `getCompletedSessions(supabase)` that returns every `done` session belonging to the caller (all plans), embedding the 1:1 `session_logs` row, ordered by `scheduled_date` descending so the newest session is first. RLS scopes the rows to the current user, so no `user_id`/`plan_id` argument or filter is needed. Mirror the to-one embed normalization already used in `getPlanWithSessions` (return objects shaped as `PlanSessionWithLog`, never `[0]` on the embed).

**Contract**: `export async function getCompletedSessions(supabase: SupabaseClient): Promise<PlanSessionWithLog[]>`. Query: `.from("plan_sessions").select("*, session_logs(*)").eq("status", "done").order("scheduled_date", { ascending: false }).order("day_index", { ascending: false })`. The secondary `day_index` key makes ordering deterministic when two plans (e.g. after a renewal) share a `scheduled_date` — without it, same-date rows reshuffle between loads. On a Supabase error, throw `Error("getCompletedSessions failed: ...")` consistent with the file's existing error style. Normalize each row `{ session_logs, ...session } → { ...(session as PlanSessionView), log: session_logs }`.

### Success Criteria:

#### Automated Verification:

- Type checking / lint passes: `npm run lint`
- Production build passes: `npm run build`

#### Manual Verification:

- (Deferred to Phase 2.) There is no test runner and no caller yet, so the function's behavior — returns completed sessions newest-first with non-null `log`, `[]` for a user with none — is confirmed when `/history` renders in Phase 2 (criteria 2.3/2.4). Lint + build are the real Phase-1 gate.

**Implementation Note**: Phase 1's gate is automated (lint + build) — its runtime behavior is observed in Phase 2, so don't block on a manual check that can't be run in isolation. Proceed once automated verification passes.

---

## Phase 2: History page & component

### Overview

Create the `/history` page (server fetch + auth guard, fail-open) and a presentational Astro component that renders the rows and an empty state.

### Changes Required:

#### 1. Shared date formatter

**File**: `src/lib/format.ts` (new) — the single home for the UTC-safe date formatter

**Intent**: Make `format.ts` the *one* UTC-safe date formatter and have both call sites consume it, rather than shipping a second near-identical parser alongside the private `formatDate` at `PlanView.tsx:106`. Both produce the same UTC-parsed date; they differ only in output detail (the plan grid wants `"Jun 15"`; history spans plans/months and wants a fuller, unambiguous label like `"Mon, Jun 15"`). Express that single difference as a format option, not a duplicated function.

**Contract**: `export function formatSessionDate(iso: string, opts?: { weekday?: boolean }): string` (or two thin wrappers over one private UTC parser). Must parse and format in UTC (`Date.UTC(...)` + `timeZone: "UTC"`) to avoid timezone drift. **Then delete `formatDate` from `PlanView.tsx` and point its 3 call sites (`PlanView.tsx:168` ×2 for the plan date range, `:326` for the session row) at the shared helper** — this refactor is in scope (it is trivial) so no duplicate UTC parser remains.

#### 2. History list component

**File**: `src/components/history/SessionHistory.astro` (new)

**Intent**: Presentational, read-only. Accept the completed sessions and render a flat, reverse-chronological list — one row per session showing date (via `formatSessionDate(scheduled_date)`), `session_type`, logged `actual_duration_min`, `rating`, and `km_ridden`. Render an empty state ("No completed sessions yet — mark a session done to start your log." or similar) when the array is empty. Use the existing `Card` styling/Tailwind idioms; the outer container is CSS-scrollable (`overflow-y-auto` with a max height) to satisfy the "scrollable list" requirement. Defensively skip/guard a row whose `log` is unexpectedly null.

**Contract**: Astro component with `Props { sessions: PlanSessionWithLog[] }`. No client directives, no event handlers. Rating shown in a compact readable form (e.g. `4/5`); duration as minutes (`{log.actual_duration_min} min`, matching `PlanView.tsx:362`); km as `{log.km_ridden} km`.

#### 3. History page

**File**: `src/pages/history.astro` (new)

**Intent**: Server-render the page. Read `Astro.locals.user`; create the per-request Supabase client; call `getCompletedSessions` inside try/catch and fall open to `[]` on a transient read error (mirroring `dashboard.astro:22-28`). Wrap in `Layout` with a top bar consistent with the dashboard (a "← Dashboard" back link; reuse the dashboard's bar markup/classes). Render `<SessionHistory sessions={...} />`.

**Contract**: `src/pages/history.astro` using `Layout title="History"`. Must set up the same auth/fetch posture as `dashboard.astro:7-30`. No `prerender` export needed (SSR is the default; this is a page, not an API route).

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Production build passes: `npm run build`

#### Manual Verification:

- `/history` renders a reverse-chronological list with correct date/type/duration/rating/km for a user with completed sessions spanning two plans.
- A user with no completed sessions sees the empty state, not a broken/blank page.
- The list scrolls when it exceeds the viewport; the page is usable on a mobile-width viewport (per PRD NFR).
- "← Dashboard" link returns to the dashboard.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding.

---

## Phase 3: Routing & navigation

### Overview

Make `/history` a protected route, exempt it from the renewal-gate redirect, and surface a link to it from the dashboard.

### Changes Required:

#### 1. Protect the route + exempt from renewal gate

**File**: `src/middleware.ts`

**Intent**: Add `/history` to `PROTECTED_ROUTES` (line 6) so it requires auth + a profile like other app pages. Then exempt it from the renewal redirect: when the active plan is expired, the user should still reach `/history` instead of being bounced to `/renewal`. Introduce an `onHistory` check (mirroring `onRenewal`/`onOnboarding`) and add it to the condition guarding the `/renewal` redirect so an expired-plan user on `/history` is not redirected away.

**Contract**: `PROTECTED_ROUTES` includes `"/history"`. The renewal redirect at `src/middleware.ts:48` fires only when `expired && !onRenewal && !onHistory`. The profile gate (no-profile → `/onboarding`) still applies to `/history`. Do not otherwise alter the gate ordering.

#### 2. Dashboard navigation link

**File**: `src/pages/dashboard.astro`

**Intent**: Add a "History" link in the dashboard top bar next to "Profile" (`dashboard.astro:40-45`), reusing the exact anchor styling.

**Contract**: An `<a href="/history">History</a>` styled identically to the adjacent Profile link.

#### 3. Renewal-page navigation link

**File**: `src/pages/renewal.astro`

**Intent**: The renewal-gate exemption (Phase 3 #1) only delivers its purpose — "an expired-plan user can review past work without renewing first" — if such a user can *navigate* to `/history`. But an expired-plan user is redirected `/dashboard → /renewal`, so the dashboard link (Phase 3 #2) is unreachable for them, and `renewal.astro` currently renders only `RenewalForm` with no nav. Add a "View history" link on the renewal page so the exempted route is actually reachable by its intended audience.

**Contract**: An `<a href="/history">View history</a>` on `renewal.astro`, placed near the `RenewalForm` (e.g. above or below it within the centered container). Reuse an existing anchor styling idiom (e.g. the dashboard top-bar link classes). No new layout/top-bar is required.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Production build passes: `npm run build`

#### Manual Verification:

- Unauthenticated request to `/history` redirects to `/auth/signin`.
- A user with an **expired** plan can open `/history` directly without being redirected to `/renewal` (and the dashboard→renewal redirect for other routes still works).
- A user with no profile hitting `/history` is sent to `/onboarding`.
- The "History" link appears on the dashboard and navigates to the list.
- The "View history" link appears on the `/renewal` page and navigates to `/history` for an expired-plan user.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation.

---

## Testing Strategy

No automated test runner is configured (per CLAUDE.md), so verification is lint + build + manual.

### Manual Testing Steps:

1. Seed/produce a user with several `done` sessions across two plans (one expired, one active or none). Open `/history` → all completed sessions appear newest-first with correct values.
2. Sign in as a user with zero completed sessions → empty state renders.
3. Force the active plan expired → confirm `/history` is reachable while `/dashboard` still redirects to `/renewal`.
4. Sign out, hit `/history` → redirected to sign-in.
5. View on a narrow (mobile) viewport → list is readable and scrolls.
6. Confirm a second user never sees the first user's sessions (RLS).

## Performance Considerations

A single RLS-scoped query over a small table; render-all is well within the PRD's documented small data volume. Note the existing `plan_sessions_plan_scheduled_idx` is keyed `(plan_id, scheduled_date)`, so this cross-plan `ORDER BY scheduled_date` is served by a sort over the (tiny) result set rather than the index — negligible at v1 volumes. No pagination needed for v1.

## Migration Notes

None — no schema or data changes.

## References

- Query/embed pattern to mirror: `src/lib/services/plan.ts:55-87`
- Page/fetch/fail-open pattern: `src/pages/dashboard.astro:7-30`
- Existing date formatter to share: `src/components/plan/PlanView.tsx:105-113`
- Renewal-gate logic to amend: `src/middleware.ts:6,45-54`
- Schema + RLS: `supabase/migrations/20260602182721_init_mvp_schema.sql:145,176,227,240`
- Types: `src/types.ts:33,41,49`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data access

#### Automated

- [x] 1.1 Type checking / lint passes: `npm run lint`
- [x] 1.2 Production build passes: `npm run build`

#### Manual

- [ ] 1.3 `getCompletedSessions` behavior (newest-first, non-null log, `[]` when none) — deferred to Phase 2 render (2.3/2.4)

### Phase 2: History page & component

#### Automated

- [ ] 2.1 Lint passes: `npm run lint`
- [ ] 2.2 Production build passes: `npm run build`

#### Manual

- [ ] 2.3 `/history` renders reverse-chronological list with correct fields across two plans
- [ ] 2.4 Empty state shown for a user with no completed sessions
- [ ] 2.5 List scrolls past viewport and is usable on mobile width
- [ ] 2.6 "← Dashboard" link returns to dashboard

### Phase 3: Routing & navigation

#### Automated

- [ ] 3.1 Lint passes: `npm run lint`
- [ ] 3.2 Production build passes: `npm run build`

#### Manual

- [ ] 3.3 Unauthenticated `/history` redirects to `/auth/signin`
- [ ] 3.4 Expired-plan user reaches `/history`; other routes still redirect to `/renewal`
- [ ] 3.5 No-profile user hitting `/history` is sent to `/onboarding`
- [ ] 3.6 "History" link appears on dashboard and navigates to the list
- [ ] 3.7 "View history" link appears on `/renewal` and navigates to `/history` for an expired-plan user
