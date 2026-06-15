# Session Tracking (done / skipped + log) — Plan Brief

> Full plan: `context/changes/session-tracking/plan.md`

## What & Why

Let a cyclist mark any plan session as **done**, **skipped**, or back to **pending**, and on done log actual duration, subjective rating, and km ridden. This is roadmap S-03 (the session loop) satisfying FR-007/FR-008 — without it the plan is read-only and renewal (S-05) and history (S-06) have nothing to build on.

## Starting Point

The data model is already complete: `plan_sessions.status` enum (`pending`/`done`/`skipped`) and a CHECK-constrained `session_logs` table (1:1 with sessions), both under RLS. The plan view (`PlanView.tsx`, fed server-side by `dashboard.astro`) renders sessions but is read-only — there is no mutation endpoint, service, or input schema.

## Desired End State

The 4-week grid shows status at a glance (check + tint for done, slash + dimmed for skipped). Tapping a session reveals a status line, logged values when done, and actions: Mark done (inline log form, duration prefilled), Skip (inline confirm clarifying skip ≠ reschedule), and Reset to planned. Marking is instant (optimistic) and persists atomically; errors roll back.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Refresh flow | Optimistic local state + API call | Tiny data delta; instant UX, no reload flash | Plan |
| Done = 2 writes atomicity | Postgres RPC (SECURITY INVOKER) | True atomicity under RLS; no service-role client | Plan |
| Mutability | Re-markable; done upserts log, skip/reset deletes it | Forgiving — fixes mis-taps without a separate edit flow | Plan |
| Skip UX | Confirm dialog with explanatory copy | Directly addresses PRD Open Question #1 (skip ≠ defer) | Plan |
| Log form | Duration prefilled, rating 1–5 buttons, km numeric | Fast happy-path; maps to CHECK constraints | Plan |
| Status display | Cell badge (icon + tint) + detail status line/values | Legible in grid; not color-alone (a11y) | Plan |
| Log read path | Embed `session_logs` in `getPlanWithSessions` | Needed to render logged values on load | Plan |

## Scope

**In scope:** mark done/skipped/pending; done-flow log (duration, rating, km); atomic RPC; mutation route; optimistic UI with status badges, log form, and skip confirm; embed logs in the read path.

**Out of scope:** session history list (S-06); bike field (PRD: v2); move/reschedule (PRD Non-Goal); plan adaptation / stats on completion (v2); any new storage migration beyond the RPC.

## Architecture / Approach

Bottom-up across three layers. **DB:** one `set_session_status` RPC does every transition atomically under caller RLS — update status, then upsert the log on done or delete it on skipped/pending; a 0-row update raises so the route can 404. **API:** `POST /api/sessions/[id]` validates input (log required + range-checked only on done) and calls the RPC. **UI:** `PlanView` lifts sessions into state, mutates optimistically with rollback, and renders status in `DayCell` + actions/form in `SessionDetail`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Data layer | RPC migration, types refresh, zod schema, service, log-embedded read | RPC ownership/atomicity (0-row detection, errcode mapping) |
| 2. API route | Validated, auth-gated `POST /api/sessions/[id]` | Edge mapping (400 vs 404 vs 500) |
| 3. UI + hook | Optimistic island, status badges, log form, skip confirm | Optimistic rollback correctness; a11y of status encoding |

**Prerequisites:** S-02 (active plan with sessions) — done. Supabase linked-remote access for `db push` + `db:types`.
**Estimated effort:** ~1–2 sessions across 3 phases.

## Open Risks & Assumptions

- RPC must map the no-rows raise to a distinct SQLSTATE (`P0002`) so the service can return 404 rather than a generic 500.
- Optimistic `done` must snapshot the prior session (status + log) so rollback restores it exactly.
- Assumes the PostgREST embed `plan_sessions.select("*, session_logs(*)")` returns the 1:1 log as a single-element array to normalize.

## Success Criteria (Summary)

- A user can mark a session done (with a logged duration/rating/km), skipped, or reset — and the change persists across reload.
- Skip presents copy clarifying it won't be rescheduled; status is visible at a glance in the grid.
- A user can never mutate another user's session (RLS → 404).
