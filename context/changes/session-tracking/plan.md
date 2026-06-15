# Session Tracking (done / skipped + log) Implementation Plan

## Overview

Let a cyclist mark any plan session as **done**, **skipped**, or back to **pending**, and — on done — log actual duration, subjective rating (1–5), and km ridden. Status and log are persisted atomically and reflected in the dashboard plan view: status badges in the 4-week grid and a status line + logged values in the expanded session detail. This is roadmap **S-03** (Stream B, the session loop), satisfying **FR-007** and **FR-008**, and unblocks S-05 (renewal) and S-06 (history).

## Current State Analysis

The data model is already fully provisioned by the init migration — **no schema migration is needed for storage**:

- `plan_sessions.status` is a `session_status` enum: `pending` | `done` | `skipped` (default `pending`). (`supabase/migrations/20260602182721_init_mvp_schema.sql:14,156`)
- `session_logs` is 1:1 with `plan_sessions` (PK = FK `plan_session_id`), columns CHECK-constrained: `actual_duration_min` 1–600, `rating` 1–5, `km_ridden` > 0 and < 500. (`…init_mvp_schema.sql:227-236`)
- RLS is enabled on both, walking up via `EXISTS` to `plans.user_id = auth.uid()`, with per-operation policies for `authenticated`. (`…init_mvp_schema.sql:174-290`)

What's missing is everything above the table: no mutation endpoint, no input schema, no service, and the plan UI is read-only.

Established patterns to follow:

- **API routes**: uppercase `POST` export, `export const prerender = false`, auth gate via `context.locals.user`, zod `safeParse` on the body, RLS-scoped SSR client from `createClient(...)`, **generic** error messages (no constraint/provider leakage). (`src/pages/api/onboarding.ts`, `src/pages/api/plans/generate.ts`)
- **Data-access services**: caller's SSR client injected as first arg so every query runs under the user's RLS session — never service-role. (`src/lib/services/plan.ts`, `src/lib/services/profile.ts`)
- **Migrations**: house style pins `set search_path = ''` and fully-qualifies catalog calls (`pg_catalog.now()`). (`supabase/migrations/20260605065635_pin_set_updated_at_search_path.sql`)
- **Plan UI**: single React island `PlanView.tsx`, server-rendered source of truth, expand-a-day-to-see-detail pattern (`DayCell` → `SessionDetail`). The dashboard fetches the plan server-side and passes it in. (`src/pages/dashboard.astro`, `src/components/plan/PlanView.tsx`)
- **Types**: DB-derived row/insert/update types + narrowed view types live in `src/types.ts`; `SessionLog`/`SessionLogInsert` already exported there (`src/types.ts:37-39`).

## Desired End State

On the dashboard, each session in the 4-week grid shows its status at a glance (check + tint for done, slash + dimmed for skipped, normal for pending). Tapping a session expands the detail, which shows a status line, the logged values when done, and action controls: **Mark done** (opens an inline log form with duration prefilled to the planned minutes, a 1–5 rating selector, and a km input), **Skip** (inline confirm with copy clarifying skip ≠ reschedule), and — when not pending — **Reset to planned**. Marking is instant (optimistic) and persists atomically; an error rolls the cell back and surfaces a message.

Verify: mark a session done with a log → cell shows done, detail shows the values, a page reload still shows them (persisted). Mark skipped → confirm copy appears, cell shows skipped, no log row exists. Reset → status returns to pending and any log is gone. A user cannot mutate another user's session (RLS → 404).

### Key Discoveries:

- Storage already exists; the only DB change is an **RPC** to make the two-write "done" path atomic. (`…init_mvp_schema.sql:14,227-236`)
- The done flow has **no bike field** — PRD FR-008 explicitly removed it (v2 garage). (`context/foundation/prd.md:93`)
- "Skip ≠ defer" is a known data-quality risk (PRD Open Question #1); the resolution in v1 is **UX copy**, not a new state. (`context/foundation/prd.md:142`)
- Showing logged values in detail requires the read path to **embed `session_logs`**, which `getPlanWithSessions` does not currently do. (`src/lib/services/plan.ts:35-56`)

## What We're NOT Doing

- **No session history list** — that's S-06 (FR-009), a separate slice that depends on this one.
- **No bike / equipment field** in the done flow — PRD removed it; v2 garage.
- **No move / reschedule (defer)** — PRD Non-Goal; only done/skipped/pending in v1.
- **No plan adaptation or stats recompute** on completion — mid-plan adaptation is v2 (PRD Business Logic).
- **No new schema/storage migration** beyond the RPC function — tables, enum, and RLS already exist.

## Implementation Approach

Three layers, bottom-up. (1) A single SECURITY INVOKER RPC `set_session_status` handles every transition atomically under the caller's RLS — update status, then upsert the log on `done` or delete it on `skipped`/`pending` — so there is never a half-written done state and a skipped/reset session never retains a stale log. (2) A thin `POST /api/sessions/[id]` route validates input (log required and range-checked only when `status='done'`) and calls the RPC, mapping a not-found/forbidden raise to 404. (3) The island lifts `sessions` into state and mutates optimistically with rollback; the read path is extended to embed the log so done sessions render their values on load.

## Critical Implementation Details

**RPC ownership & atomicity** — `set_session_status` runs SECURITY INVOKER so the caller's RLS applies: an update to a session the user doesn't own affects 0 rows. The function must detect `row_count = 0` and `raise` (distinct SQLSTATE) so the route can answer 404 rather than silently succeeding. The status update and the log upsert/delete run in the function's single implicit transaction — that atomicity is the whole reason for the RPC (the codebase forbids service-role clients, so this can't be done client-side).

**Optimistic log display** — on optimistic `done`, attach the just-entered values as the session's local `log` so detail renders them immediately without a refetch; on rollback, restore the prior session (including its prior `log`/status) from a snapshot taken before the mutation.

## Phase 1: Data layer (RPC, types, schema, service, read path)

### Overview

Add the atomic RPC migration, refresh generated types, define the validated input contract, write the mutation service, and extend the plan read to carry logs.

### Changes Required:

#### 1. RPC migration

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_add_set_session_status_rpc.sql`

**Intent**: One atomic, RLS-respecting entry point for all session-status transitions, so the two-write "done" path can't half-complete and skipped/reset can't leave a stale log.

**Contract**: `public.set_session_status(p_session_id uuid, p_status public.session_status, p_actual_duration_min smallint default null, p_rating smallint default null, p_km_ridden numeric default null) returns void`, `language plpgsql`, `security invoker`, `set search_path = ''`. Behavior: update `public.plan_sessions.status` where `id = p_session_id`; if `row_count = 0` raise (RLS denied / missing) with a distinct errcode; then if `p_status = 'done'` upsert `public.session_logs` (`on conflict (plan_session_id) do update`, refreshing `logged_at = pg_catalog.now()`), else `delete` any log for the session. Grant `execute` to `authenticated`; revoke from `public`/`anon`. The CHECK constraints on `session_logs` remain the storage-level trust boundary.

```sql
create function public.set_session_status(
  p_session_id uuid,
  p_status public.session_status,
  p_actual_duration_min smallint default null,
  p_rating smallint default null,
  p_km_ridden numeric default null
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare v_rows int;
begin
  update public.plan_sessions set status = p_status where id = p_session_id;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'session not found' using errcode = 'P0002';
  end if;
  if p_status = 'done' then
    insert into public.session_logs (plan_session_id, actual_duration_min, rating, km_ridden)
    values (p_session_id, p_actual_duration_min, p_rating, p_km_ridden)
    on conflict (plan_session_id) do update
      set actual_duration_min = excluded.actual_duration_min,
          rating = excluded.rating,
          km_ridden = excluded.km_ridden,
          logged_at = pg_catalog.now();
  else
    delete from public.session_logs where plan_session_id = p_session_id;
  end if;
end;
$$;
```

#### 2. Apply + regenerate types

**File**: `src/db/database.types.ts` (generated)

**Intent**: Apply the migration to the linked remote and refresh generated types so the RPC and any type usage compile.

**Contract**: Run `npx supabase db push --linked` then `npm run db:types`. Generated `Database["public"]["Functions"]["set_session_status"]` should appear; do not hand-edit the file.

#### 3. Session input schema + DTO

**File**: `src/lib/session-schema.ts` (new) and re-export in `src/types.ts`

**Intent**: Server-side trust boundary for the mutation body; the log is required and range-checked only on `done`.

**Contract**: A zod `discriminatedUnion("status", …)`: `done` → `{ status, log: { actual_duration_min: int 1–600, rating: int 1–5, km_ridden } }`; `skipped` → `{ status }`; `pending` → `{ status }`. Export the inferred DTO type; re-export from `src/types.ts` alongside the other DTOs. Integer ranges mirror the `session_logs` CHECK constraints exactly. **`km_ridden`**: round to 2 decimals **before** the range check (e.g. `.transform((n) => Math.round(n * 100) / 100)` then `.refine((n) => n > 0 && n < 500)`), so the zod boundary matches what `numeric(5,2)` actually stores. This closes the edge where 499.999 passes a naive `< 500` but rounds to 500.00 at the column (CHECK violation → generic 500); after rounding it fails zod cleanly with a 400, and the low edge (0.004 → 0.00) likewise rejects.

#### 4. Session mutation service

**File**: `src/lib/services/session.ts` (new)

**Intent**: Thin data-access wrapper calling the RPC under the caller's RLS client, mirroring `plan.ts`/`profile.ts` injection style.

**Contract**: `setSessionStatus(supabase, sessionId, input): Promise<{ ok: true } | { error: string; notFound?: boolean }>`. Maps RPC args from the DTO (log fields → `p_*`, null when not `done`). Detects the `P0002` errcode from the returned error and returns `{ error, notFound: true }`; any other error returns `{ error }`.

#### 5. Extend plan read to embed logs

**File**: `src/lib/services/plan.ts`, `src/types.ts`

**Intent**: Carry each session's log so a done session can render its logged values on server load.

**Contract**: In `getPlanWithSessions`, embed the log via a PostgREST nested select on `plan_sessions` (`select("*, session_logs(*)")`). Because `session_logs.plan_session_id` is both the FK and the PRIMARY KEY (unique), PostgREST detects a **to-one** relationship and returns the embed as a single object or `null` — **not** an array. Normalize as `log: row.session_logs ?? null` (do not index `[0]`). Add a `PlanSessionWithLog = PlanSessionView & { log: SessionLog | null }` type in `src/types.ts` and change `PlanWithSessions.sessions` to that type. Keep `day_index` ordering. After `npm run db:types`, confirm the generated embed shape (object-or-null vs array) and adjust the normalization if the generated type disagrees.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db push --linked`
- Types regenerate and include the function: `npm run db:types`
- Linting (type-checked) passes: `npm run lint`
- Production build passes: `npm run build`

#### Manual Verification:

- In the Supabase SQL editor, calling `set_session_status` for another user's session id raises (0 rows) rather than mutating.
- `done` upserts a `session_logs` row; `skipped`/`pending` deletes it.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: API route

### Overview

Expose the service over a validated, auth-gated endpoint.

### Changes Required:

#### 1. Mark-status route

**File**: `src/pages/api/sessions/[id].ts` (new)

**Intent**: Accept a status (and log on done) for one session and persist it via the service, following the onboarding/generate route shape.

**Contract**: `export const prerender = false`; `export const POST: APIRoute`. Flow: auth gate (401 if no `context.locals.user`); read `id` from `context.params` and reject a non-UUID with 400; `safeParse` the JSON body with `sessionStatusUpdateSchema` (400 + `fieldErrors` on failure, mirroring `onboarding.ts`); build the RLS client (`createClient`, 500 if null); call `setSessionStatus`. Map `{ notFound: true }` → 404, other `{ error }` → 500 (generic copy), success → `{ ok: true }` 200. No plan/session payload is returned — the client already holds the optimistic state.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Production build passes: `npm run build`

#### Manual Verification:

- `POST /api/sessions/<id>` with `{ "status": "done", "log": {…} }` returns 200 and persists; reload shows the values.
- `{ "status": "done" }` with no/invalid log returns 400.
- A random/non-owned session id returns 404; an unauthenticated request returns 401.

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: UI + hook

### Overview

Make the plan island stateful and interactive: optimistic mutation with rollback, status badges in the grid, and status/log/actions in the detail.

### Changes Required:

#### 1. Mutation hook

**File**: `src/components/hooks/useSessionStatus.ts` (new)

**Intent**: Encapsulate the POST + error mapping, leaving optimistic state to the island (mirrors how `usePlanGeneration` owns its fetch concern).

**Contract**: Exposes `mutate(sessionId, input): Promise<{ ok: true } | { ok: false; error: string }>` plus a `pending` flag. Maps a non-OK response to a friendly message from the body's `error`. Does not touch component state directly.

#### 2. Plan island state + optimistic mutate

**File**: `src/components/plan/PlanView.tsx`

**Intent**: Lift `sessions` into state and apply status/log changes optimistically with rollback so marking is instant.

**Contract**: In `PlanOverview`, seed `useState` from `plan.sessions`. A `setStatus(sessionId, input)` handler snapshots the target session, optimistically updates its `status` (and, for `done`, attaches the entered values as a local `log`; for `skipped`/`pending`, clears `log`), calls the hook, and on failure restores the snapshot and shows a transient inline error. `sessionByDay`, `DayCell`, and `SessionDetail` read from state.

#### 3. Status badges in the grid

**File**: `src/components/plan/PlanView.tsx` (`DayCell`)

**Intent**: Show status at a glance in the 4-week grid.

**Contract**: Drive cell appearance off `session.status`: `done` → `Check` icon + emerald tint; `skipped` → `Ban`/slash icon + dimmed/strikethrough; `pending` → current style. Icons from `lucide-react` (already used). Status is conveyed by icon + text/tint, not color alone (accessibility). Extend `aria-label` with status.

#### 4. Detail: status line, logged values, actions, log form, skip confirm

**File**: `src/components/plan/PlanView.tsx` (`SessionDetail`)

**Intent**: Surface status, let the user mark done (with log), skip (with confirm copy), or reset to planned.

**Contract**: Add (a) a status line (`Planned` / `Done` / `Skipped`); (b) when `status='done'` and `log` present, a logged-values block (duration, rating, km); (c) an actions row — `Mark done` opens an inline log form; `Skip` opens an inline confirm; when not `pending`, a `Reset to planned` action sends `{ status: 'pending' }`. The log form prefills duration with `session.planned_duration_min`, renders rating as five 1–5 buttons, and a numeric km input; Save sends `{ status: 'done', log }`, Cancel closes. The skip confirm shows copy ("Skip means you won't do this session — it won't be rescheduled.") with Confirm/Cancel; Confirm sends `{ status: 'skipped' }`. Re-marking is allowed from any status (Mark done is offered even when skipped). Implemented inline (no new modal dependency).

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Production build passes: `npm run build`

#### Manual Verification:

- Marking done shows the log form (duration prefilled), saves, and the cell + detail reflect done with the logged values; a reload still shows them.
- Skip shows the explanatory confirm copy; confirming marks the cell skipped; no log persists.
- Reset returns the session to pending and clears the logged values.
- A forced API failure (e.g. offline) rolls the cell back to its prior status and shows an error.
- Status encoding is legible without relying on color alone.

**Implementation Note**: Final phase — confirm the full flow end-to-end.

---

## Testing Strategy

No automated test runner is configured (per CLAUDE.md); verification is `npm run lint` + `npm run build` plus manual checks.

### Manual Testing Steps:

1. As a user with an active plan, mark a session **done**, fill the log, save → cell shows done, detail shows values; reload → still present.
2. Mark another session **skipped** → confirm copy appears; confirm → cell shows skipped; verify no `session_logs` row exists for it.
3. **Reset** a done session → status pending, log gone.
4. Re-mark a skipped session **done** → log form available, saves correctly.
5. Toggle offline and mark a session → optimistic change rolls back with an error message.
6. Confirm a second account cannot mutate the first account's sessions (404).

## Migration Notes

Apply with `npx supabase db push --linked`, then `npm run db:types`. The RPC is additive (no data migration); existing `pending` sessions are unaffected.

## References

- Roadmap S-03: `context/foundation/roadmap.md:114-125`
- PRD FR-007 / FR-008 / Open Question #1: `context/foundation/prd.md:90-93,142`
- Schema (tables, enum, RLS): `supabase/migrations/20260602182721_init_mvp_schema.sql:14,146-290`
- Migration house style: `supabase/migrations/20260605065635_pin_set_updated_at_search_path.sql`
- Read/persist patterns: `src/lib/services/plan.ts`; route patterns: `src/pages/api/onboarding.ts`, `src/pages/api/plans/generate.ts`
- Plan island: `src/components/plan/PlanView.tsx`; dashboard read: `src/pages/dashboard.astro`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data layer (RPC, types, schema, service, read path)

#### Automated

- [x] 1.1 Migration applies cleanly: `npx supabase db push --linked` — 7eeed09
- [x] 1.2 Types regenerate and include the function: `npm run db:types` — 7eeed09
- [x] 1.3 Linting (type-checked) passes: `npm run lint` — 7eeed09
- [x] 1.4 Production build passes: `npm run build` — 7eeed09

#### Manual

- [x] 1.5 RPC raises (0 rows) for a non-owned session id rather than mutating — 7eeed09
- [x] 1.6 `done` upserts a `session_logs` row; `skipped`/`pending` deletes it — 7eeed09

### Phase 2: API route

#### Automated

- [x] 2.1 Linting passes: `npm run lint` — b8bad27
- [x] 2.2 Production build passes: `npm run build` — b8bad27

#### Manual

- [x] 2.3 `done` with valid log returns 200 and persists (reload shows values) — b8bad27
- [x] 2.4 `done` with missing/invalid log returns 400 — b8bad27
- [x] 2.5 Non-owned id → 404; unauthenticated → 401 — b8bad27

### Phase 3: UI + hook

#### Automated

- [x] 3.1 Linting passes: `npm run lint`
- [x] 3.2 Production build passes: `npm run build`

#### Manual

- [x] 3.3 Mark done shows prefilled log form, saves; cell + detail reflect done with values; persists on reload
- [x] 3.4 Skip shows explanatory confirm copy; confirming marks skipped with no log persisted
- [x] 3.5 Reset returns session to pending and clears logged values
- [x] 3.6 Forced API failure rolls the cell back and shows an error
- [x] 3.7 Status encoding is legible without relying on color alone
