# Session History (S-06) — Plan Brief

> Full plan: `context/changes/session-history/plan.md`

## What & Why

Add a read-only `/history` page listing every completed session across all of a user's plans (current and past), newest first — date, type, logged duration, rating, km. Delivers FR-009 and the PRD's secondary success criterion: persisted history that makes WattWise "feel like a real training log."

## Starting Point

Session data already exists: `plan_sessions` (status `done`/`skipped`/`pending`) is 1:1 with `session_logs` (duration, rating, km), both RLS-scoped to the owning user. The query pattern (`getPlanWithSessions`), the server-fetch page pattern (`dashboard.astro`), and a UTC-safe date formatter (private inside `PlanView.tsx`) all exist. There is no history surface yet.

## Desired End State

A signed-in user opens `/history` from a dashboard link and scrolls a reverse-chronological list of their completed sessions with correct logged values; a fresh user sees an empty state. The page is reachable even when the plan has expired. No cross-user data is ever visible.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Scope | All plans (full log) | History must persist across renewals to be a real training log; RLS scopes by user so dropping the plan filter is enough | Plan |
| Layout | Flat reverse-chronological | Simplest; matches a log scroll; date per row gives enough context at MVP volumes | Plan |
| Volume | Render all, CSS-scrollable | Small documented data volumes; avoids pagination + a forced React island | Plan |
| Renewal gate | Exempt `/history` | A user with an expired plan can review past work without being forced to renew first | Plan |
| Render tech | Pure Astro (no island) | Read-only page; no interactivity → per CLAUDE.md convention | Plan |

## Scope

**In scope:** cross-plan `done`-session query; `/history` Astro page + presentational list component; empty state; shared date formatter; protect route + renewal-gate exemption; dashboard nav link.

**Out of scope:** pagination, grouping, stats/filters/sorting, skipped/pending sessions, React interactivity, any schema/migration/API-route change.

## Architecture / Approach

`history.astro` (server fetch, fail-open like `dashboard.astro`) → new `getCompletedSessions(supabase)` in `plan.ts` (reuses the to-one `session_logs` embed + normalization) → `SessionHistory.astro` presentational list. Middleware adds `/history` to `PROTECTED_ROUTES` and exempts it from the expired-plan → `/renewal` redirect.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Data access | `getCompletedSessions` cross-plan query | Misreading the 1:1 embed as an array (`[0]`) — mitigated by mirroring existing normalization |
| 2. Page & component | `/history` page + list + empty state | Date timezone drift; mobile readability |
| 3. Routing & nav | Protected route, renewal-gate exemption, dashboard link | Breaking the existing expired-plan → `/renewal` redirect for other routes |

**Prerequisites:** S-03 (session tracking) — done. No new deps.
**Estimated effort:** ~1 session across 3 thin phases.

## Open Risks & Assumptions

- Assumes every `done` session has a `session_logs` row (guaranteed by the `set_session_status` RPC); component still guards a null log defensively.
- Render-all assumes the PRD's small-data-volume claim holds for v1; no pagination fallback.

## Success Criteria (Summary)

- A user sees all their completed sessions, newest-first, across plans, with correct logged values.
- A user with none sees a clear empty state; the list scrolls and works on mobile.
- `/history` is reachable with an expired plan; other users' data never appears.
