# MVP Data Schema and RLS Implementation Plan

## Overview

Define the four MVP database tables — `profiles`, `plans`, `plan_sessions`, `session_logs` — with strict per-user Row-Level Security, in a single atomic Supabase migration. Add a `db:types` script to generate `src/types.ts` so every downstream slice has typed access. Verify cross-user isolation with a pgTAP test plus a manual two-account check; wire `supabase test db` into CI so future migrations can't weaken RLS unnoticed. Scope is DB-only — no API, no UI, no AI integration.

## Current State Analysis

- **Supabase project linked** (`yfigasipwpqrzakwxcxl`); SSR client and `context.locals.user` middleware are wired (`src/lib/supabase.ts:7-23`, `src/middleware.ts:6-16`).
- **Auth flow complete** (signin/signup/signout API routes under `src/pages/api/auth/`); `auth.users` populates on sign-up; FR-001 and FR-003 are already satisfied per the baseline.
- **No migrations exist** — `supabase/migrations/` directory is absent; `supabase/seed.sql` is absent; `supabase/config.toml:57` shows `schema_paths = []`.
- **No DB types generated** — `src/types.ts` is absent; `package.json` has no `supabase gen types` or `db:types` script.
- **CI** (`.github/workflows/ci.yml`) runs lint + build with `SUPABASE_URL`/`SUPABASE_KEY` secrets but performs no schema or RLS check.
- **PRD privacy guardrail** (`context/foundation/prd.md:111`: "A user's training data … is never visible to or accessible by any other user account") is this slice's hardest constraint and the verification target for Phase 2.

### Key Discoveries:

- The PRD's three equipment types each need a different rendering anchor: FTP for power, max HR for HRM, nothing for RPE (`context/foundation/prd.md:84`) — schema accommodates all three via nullable anchor columns.
- The "I don't know my FTP" path requires a separate `fitness_level` signal so the AI has a fitness magnitude when measured FTP is absent (`context/foundation/prd.md:74-75`). `fitness_level` is set iff FTP is not measured — covers both power-meter-with-no-test users and all HRM / no-equipment users.
- Postgres does **not** auto-index FK columns; `plan_sessions(plan_id)` and `plans(user_id)` need explicit indexes.
- `CLAUDE.md:39` mandates "granular per-operation, per-role policies" — four policies per table (SELECT/INSERT/UPDATE/DELETE) on `authenticated`, default-deny for `anon`.
- Supabase project is linked to a remote ref, so `supabase db push` is the deploy path; local Docker (`supabase start` + `supabase test db`) is the test path; CI uses the latter.

## Desired End State

A merged commit on `main` such that:

1. `supabase/migrations/<timestamp>_init_mvp_schema.sql` exists and applies cleanly (`npx supabase db reset` succeeds).
2. The four tables exist with correct columns, FKs, CHECK constraints, indexes, and the partial unique on active plans.
3. RLS is enabled on all four tables; each has four per-operation policies on `authenticated`; `anon` has no policies (default-deny).
4. `src/types.ts` re-exports the generated `Database` type plus entity aliases (`Profile`, `Plan`, `PlanSession`, `SessionLog`, with `Insert`/`Update` variants).
5. `package.json` has a `db:types` script that regenerates `src/types.ts` from the linked project.
6. `supabase/tests/rls_test.sql` exists; `npx supabase test db` passes locally and in CI.
7. CI runs `supabase test db` on every push, blocking RLS regressions.
8. Manual two-account check documented in `manual-verification.md` and signed off once.

## What We're NOT Doing

- **No API endpoints** — `/api/profile`, `/api/plans`, `/api/sessions/[id]/log` are S-01 / S-02 / S-03 scope.
- **No UI** — onboarding wizard, plan view, session detail, history list are S-01 / S-02 / S-06 / S-07.
- **No AI integration** — Anthropic SDK install, prompt construction, model selection are S-02.
- **No zones lookup table** (`src/lib/zones.ts`) — used only at view time; belongs to S-02 where it gates rendering. F-01 stores raw `smallint` zone numbers (1–7) with a CHECK.
- **No FTP-edit logic** — PRD defers FTP edits to v2 / renewal-only (FR-010, FR-012). Schema accepts updates but enforces no edit-time business rule.
- **No "fitness level → starting FTP" mapping function** — schema accepts both fields independently; the mapping lives in S-01.
- **No data seeding** — `seed.sql` is created empty for forward compatibility; no fixtures.
- **No background jobs / expiry detection** — plan-status transitions happen on user visit during S-05.
- **No automatic profile creation on sign-up** — a signed-up user has zero `profiles` rows until they complete onboarding; S-01 owns the first INSERT.

## Implementation Approach

One atomic migration introduces the entire MVP schema as a single reviewable diff (~250–350 lines of SQL). Type generation is a `db:types` npm script run once at the end of Phase 1 to produce `src/types.ts`; the file is committed and regenerated on every future migration. RLS policies follow the chain pattern — direct `auth.uid()` for `profiles` and `plans`, `EXISTS` subqueries for `plan_sessions` and `session_logs`. Phase 1 lands the schema and types; Phase 2 lands the verification harness (pgTAP file + CI step + manual checklist).

## Critical Implementation Details

**Status-vs-log invariant across tables.** `plan_sessions.status = 'done'` must coincide with the existence of a `session_logs` row; `status = 'skipped'` must not. Postgres cannot enforce this with a cross-table CHECK without a deferred trigger — kept at the app layer in S-03, which writes the status flip and the log insert in a single transaction. This is an explicit acceptance, not an oversight.

**Active-plan uniqueness.** The partial unique index `plans(user_id) WHERE status='active'` enforces "one active plan per user" at the database level. S-05's renewal flow must flip the old plan to `superseded` and insert the new `active` plan in one transaction, in that order, or the new INSERT will fail the index.

**`fitness_level` consistency.** Encoded as a CHECK constraint using `IS DISTINCT FROM` to handle three-valued logic correctly: `(ftp_source IS NOT DISTINCT FROM 'measured' AND fitness_level IS NULL) OR (ftp_source IS DISTINCT FROM 'measured' AND fitness_level IS NOT NULL)`. This correctly rejects `ftp_source='measured' AND fitness_level NOT NULL`, accepts `ftp_source=NULL AND fitness_level NOT NULL` (HRM / none-equipment), and accepts `ftp_source='estimated' AND fitness_level NOT NULL` (no-FTP-test path).

**Pre-onboarding state.** A signed-up user has no `profiles` row. S-01's route guard checks `profiles` existence (not just `auth.users`) to decide between routing to onboarding vs the dashboard. F-01 deliberately does not auto-create a profile via trigger — the NOT NULL columns are strict, and onboarding owns the first write.

---

## Phase 1: Schema, RLS, and Type Generation

### Overview

Introduce the entire MVP schema in one atomic migration: extensions, seven enums, four tables, indexes (including the partial unique), RLS policies, `updated_at` triggers. Add type generation; produce `src/types.ts`. Resolve the dangling `seed.sql` reference. Append a one-line dev-workflow note to `CLAUDE.md`.

### Changes Required:

#### 1. SQL migration file

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_init_mvp_schema.sql`

**Intent**: Atomic creation of every MVP entity — extensions, enums, tables with FKs and CHECK constraints, indexes, RLS policies for the `authenticated` role on all four tables, and the `updated_at` trigger. Greenfield, no data migration.

**Contract**:

- **Extensions**: `CREATE EXTENSION IF NOT EXISTS pgcrypto` (for `gen_random_uuid()`).
- **Enums** (all in `public`):
  - `equipment_type`: `power_meter`, `hrm`, `none`
  - `training_goal`: `fitness_health`, `endurance`, `speed_racing`
  - `fitness_level`: `beginner`, `intermediate`, `advanced`
  - `ftp_source`: `measured`, `estimated`
  - `plan_status`: `active`, `expired`, `superseded`
  - `session_status`: `pending`, `done`, `skipped`
  - `session_type`: `endurance`, `intervals`, `recovery`
- **Tables**:
  - `profiles`: `user_id uuid PK REFERENCES auth.users(id) ON DELETE CASCADE`, `equipment_type`, `goal`, `age smallint`, `weight_kg numeric(5,2)`, `ftp_watts smallint NULL`, `ftp_source NULL`, `fitness_level NULL`, `max_hr smallint NULL`, `available_days text[]`, `max_workday_minutes smallint`, `max_weekend_minutes smallint`, `created_at timestamptz DEFAULT now()`, `updated_at timestamptz DEFAULT now()`. CHECKs: range bounds (age 14–100, weight_kg 30–200, ftp_watts 50–600, max_hr 100–230, workday minutes 15–360, weekend minutes 15–600); `available_days <@ ARRAY['mon','tue','wed','thu','fri','sat','sun']::text[]` and `array_length(available_days,1) BETWEEN 1 AND 7`; equipment-specific consistency:
    ```sql
    CONSTRAINT power_meter_requires_ftp CHECK (
      equipment_type <> 'power_meter' OR (ftp_watts IS NOT NULL AND ftp_source IS NOT NULL)
    ),
    CONSTRAINT hrm_requires_max_hr CHECK (
      equipment_type <> 'hrm' OR max_hr IS NOT NULL
    ),
    CONSTRAINT fitness_level_matches_ftp_source CHECK (
      (ftp_source IS NOT DISTINCT FROM 'measured' AND fitness_level IS NULL)
      OR (ftp_source IS DISTINCT FROM 'measured' AND fitness_level IS NOT NULL)
    )
    ```
  - `plans`: `id uuid PK DEFAULT gen_random_uuid()`, `user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`, `start_date date NOT NULL`, `end_date date NOT NULL CHECK (end_date - start_date = 27)` (inclusive 28-day plan), `status plan_status NOT NULL DEFAULT 'active'`, `goal_at_generation training_goal NOT NULL`, `ftp_at_generation smallint NULL`, `max_hr_at_generation smallint NULL`, `fitness_level_at_generation fitness_level NULL`, `equipment_at_generation equipment_type NOT NULL`, `generation_metadata jsonb NULL`, `created_at`, `updated_at`. The `*_at_generation` snapshots exist so renewals can compare against the input that produced the prior plan without re-reading a profile that may have changed mid-cycle.
  - `plan_sessions`: `id uuid PK DEFAULT gen_random_uuid()`, `plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE`, `scheduled_date date NOT NULL`, `day_index smallint NOT NULL CHECK (day_index BETWEEN 1 AND 28)`, `session_type session_type NOT NULL`, `planned_duration_min smallint NOT NULL CHECK (planned_duration_min BETWEEN 15 AND 360)`, `title text NOT NULL`, `description text NULL`, `structure jsonb NOT NULL CHECK (jsonb_typeof(structure) = 'object' AND structure ? 'segments')`, `status session_status NOT NULL DEFAULT 'pending'`, `created_at`, `updated_at`. UNIQUE `(plan_id, day_index)`.
  - `session_logs`: `plan_session_id uuid PK REFERENCES plan_sessions(id) ON DELETE CASCADE`, `actual_duration_min smallint NOT NULL CHECK (actual_duration_min BETWEEN 1 AND 600)`, `rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5)`, `km_ridden numeric(5,2) NOT NULL CHECK (km_ridden > 0 AND km_ridden < 500)`, `logged_at timestamptz NOT NULL DEFAULT now()`. Existence == "user logged a done session"; skipped sessions have `plan_sessions.status='skipped'` and no log row.

- **Indexes**:
  - `plans(user_id)`
  - `CREATE UNIQUE INDEX one_active_plan_per_user ON plans(user_id) WHERE status='active'`
  - `plan_sessions(plan_id)`
  - `plan_sessions(plan_id, scheduled_date)`

- **RLS** (per `CLAUDE.md:39` — per-operation, per-role; on each table run `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and `ALTER TABLE ... FORCE ROW LEVEL SECURITY`):
  - `profiles` × 4 policies on `authenticated`: `USING/WITH CHECK (user_id = auth.uid())`
  - `plans` × 4 policies on `authenticated`: `USING/WITH CHECK (user_id = auth.uid())`
  - `plan_sessions` × 4 policies on `authenticated`: ownership via `EXISTS (SELECT 1 FROM plans WHERE plans.id = plan_sessions.plan_id AND plans.user_id = auth.uid())`
  - `session_logs` × 4 policies on `authenticated`: ownership via `EXISTS (SELECT 1 FROM plan_sessions JOIN plans ON plans.id = plan_sessions.plan_id WHERE plan_sessions.id = session_logs.plan_session_id AND plans.user_id = auth.uid())`
  - `anon` role gets no policies — default-deny applies.

- **Trigger**: `set_updated_at()` plpgsql function (sets `NEW.updated_at = now()`) + `BEFORE UPDATE` triggers on `profiles`, `plans`, `plan_sessions`. Not on `session_logs` (insert-only; `logged_at` is sufficient).

#### 2. Empty seed file

**File**: `supabase/seed.sql`

**Intent**: Resolve the dangling reference in `supabase/config.toml:64` (`sql_paths = ["./seed.sql"]`) so `supabase db reset` doesn't warn. Header-only file; no fixtures yet.

**Contract**: One line: `-- Seed data for WattWise local development. Intentionally empty until a slice requires seed fixtures.`

#### 3. Type generation script + initial `src/types.ts`

**File**: `package.json` (modify), `src/types.ts` (new)

**Intent**: Add `db:types` script that regenerates types from the linked Supabase project. Run it once locally to produce `src/types.ts`. Commit the result. Below the generated `Database` block, hand-add entity aliases that downstream slices import.

**Contract**:

- `package.json` scripts add: `"db:types": "supabase gen types typescript --linked > src/types.ts && npm run format"`
- `src/types.ts` shape:
  ```ts
  // Generated by `npm run db:types` from the linked Supabase project — do not edit by hand
  // (everything above the manual aliases boundary regenerates)
  export type Database = { /* generated tables, enums, views */ };

  // === entity aliases (manual — kept below regenerated block) ===
  export type Profile = Database['public']['Tables']['profiles']['Row'];
  export type ProfileInsert = Database['public']['Tables']['profiles']['Insert'];
  export type ProfileUpdate = Database['public']['Tables']['profiles']['Update'];
  // same for Plan, PlanSession, SessionLog
  // re-export enum string-literal unions: EquipmentType, TrainingGoal, FitnessLevel, FtpSource, PlanStatus, SessionStatus, SessionType
  ```
  Note: the supabase CLI emits a self-contained file; the boundary comment is informational so future regens don't silently overwrite the aliases. If the CLI overwrites them, restore from git. (A follow-up slice could split this into `src/types.generated.ts` + `src/types.ts` re-export wrapper; intentionally deferred.)

#### 4. Local dev workflow note

**File**: `CLAUDE.md` (modify — append one sentence to the Environment section)

**Intent**: Point future contributors at the schema-reset command after pulling a migration. One sentence, no formatting changes.

**Contract**: At the end of the `### Environment` section, append: `After pulling a new migration, run \`npx supabase db reset\` to recreate the local DB and \`npm run db:types\` to refresh \`src/types.ts\`.`

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset`
- Type generation succeeds: `npm run db:types` exits 0 and `src/types.ts` is non-empty
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`
- Astro typecheck passes: `npx astro sync && npx astro check`
- Partial unique index enforced: manual psql `INSERT INTO plans` of two `status='active'` rows for the same `user_id` fails with a unique-violation

#### Manual Verification:

- Supabase Studio (linked project) schema graph shows four tables with correct FK relationships
- Each table has exactly four RLS policies (SELECT/INSERT/UPDATE/DELETE) on `authenticated`; no `anon` policies
- Two-account smoke test: sign up users A and B; using each user's JWT in Supabase Studio's SQL editor, user B selects 0 rows from user A's `profiles`

**Implementation Note**: After Phase 1's automated checks pass, pause here for manual confirmation that the two-account smoke test succeeded before starting Phase 2. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section.

---

## Phase 2: Automated RLS Verification (pgTAP)

### Overview

Add a pgTAP test file that exercises cross-user isolation on every table × every operation, plus the partial unique on active plans. Wire `supabase test db` into CI so a future migration weakening RLS is caught before merge. Land a manual verification checklist alongside.

### Changes Required:

#### 1. pgTAP test file

**File**: `supabase/tests/rls_test.sql`

**Intent**: Run inside a transaction (BEGIN/ROLLBACK) so tests leave no state. Insert two synthetic `auth.users` rows; switch the JWT claim to each via `set_config('request.jwt.claims', ...)`; assert per-operation denial for every table.

**Contract**:

- Standard pgTAP envelope: `BEGIN; SELECT plan(N); …; SELECT * FROM finish(); ROLLBACK;`
- Two fixed test UUIDs (e.g., `'a1111111-1111-1111-1111-111111111111'`, `'b2222222-2222-2222-2222-222222222222'`) inserted into `auth.users` with minimal required columns (id, email, encrypted_password placeholder)
- Helper to switch user context: `SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub', '<uuid>')::text, true);`
- Assertions (~25–30 total):
  - anon role denied SELECT on all 4 tables (4 × `throws_ok`)
  - user A inserts own profile, plan, session, log; user B sees zero rows (4 × `is_empty`)
  - user B cannot UPDATE user A's row in each table (4 × `throws_ok` or zero affected rows)
  - user B cannot DELETE user A's row in each table (4 × `throws_ok` or zero affected rows)
  - Partial unique index: user A inserts second `status='active'` plan; expect unique violation (1 × `throws_ok`)
  - CHECK constraints: insert `profiles` with `equipment_type='power_meter'` + `ftp_watts=NULL`; expect check violation (1 × `throws_ok`)
  - CHECK constraints: insert with `ftp_source='measured'` AND `fitness_level='advanced'`; expect violation (1 × `throws_ok`)

#### 2. CI step

**File**: `.github/workflows/ci.yml`

**Intent**: After the existing lint + build steps, add a new step (or job) that starts Supabase locally, applies migrations, runs `supabase test db`, then stops. Any failed assertion fails the build.

**Contract**:

- New step appended to the existing job: `- run: npx supabase db start && npx supabase db reset && npx supabase test db && npx supabase stop`
- Or, if cleaner, a separate job `rls-test` running on `ubuntu-latest` with Docker (default on GH runners) — depends on the existing job
- No additional secrets needed; runs against local Docker only

#### 3. Manual verification doc

**File**: `context/changes/data-schema-and-rls/manual-verification.md`

**Intent**: One-page checklist of the manual two-account test, runnable by any future maintainer when schema changes ship. Numbered steps; expected outcomes; checkbox for sign-off.

**Contract**: Numbered procedure — (1) sign up users A and B via the existing `/auth/signup` flow; (2) via Supabase Studio SQL editor with each user's JWT, `SELECT * FROM profiles`; (3) confirm each sees only their own row; (4) attempt cross-user UPDATE and DELETE; confirm zero rows affected. Includes a "checked off by <name> on <date>" line.

### Success Criteria:

#### Automated Verification:

- `npx supabase test db` reports `ok` for every assertion locally
- CI runs `supabase test db` and is green on the PR introducing this slice
- One-time validation: a temporary commit with a deliberately broken policy (e.g., `USING (true)`) fails CI — record the result in `manual-verification.md`, then revert

#### Manual Verification:

- `manual-verification.md` checklist completed and signed off
- `npx supabase test db` runs locally in under 60 seconds on the developer's machine

**Implementation Note**: After Phase 2's automated checks pass, pause for manual confirmation that the manual checklist was executed and the broken-RLS validation was performed (and reverted).

---

## Testing Strategy

### Unit Tests:

No unit tests in this slice — there is no application code beyond `src/types.ts`. CHECK constraints are exercised by pgTAP via INSERT attempts.

### Integration Tests:

- `supabase/tests/rls_test.sql` is the integration test layer. Every operation × every table × cross-user denial is exercised. Partial unique index and key CHECK constraints are exercised.

### Manual Testing Steps:

1. `npx supabase db reset` locally; confirm no errors and the four tables exist in `psql`.
2. Open Supabase Studio (linked project); confirm the four-table FK graph and each table's RLS-policy count (4 per table).
3. Sign up two test accounts via the existing auth flow; from Studio SQL editor, attempt cross-user SELECT/UPDATE/DELETE per `manual-verification.md`.
4. Attempt to manually INSERT a second `status='active'` plan for the same user; confirm a unique-violation error.
5. Run `npm run db:types`; confirm `src/types.ts` regenerates and `git diff` shows only intentional changes (e.g., new tables on first run).

## Performance Considerations

Target scale (per PRD frontmatter: `users: small`, `qps: low`, `data_volume: small`) puts the entire system well under any RLS performance threshold. Expected per-user row counts: ~12 plans lifetime × ~25 sessions/plan = ~300 plan_sessions; ~300 session_logs; 1 profile. Indexes on FK columns and the partial unique on active plans are the only performance-relevant choices in this slice. RLS `EXISTS` subqueries add ~1–2 ms per query at this volume — not a concern.

## Migration Notes

Forward-only — no existing rows to migrate. Local devs run `npx supabase db reset` after pulling. Remote deploy is `npx supabase db push` from a clean state; verify the linked project has no existing public-schema tables before pushing (Studio → Table Editor → `public` schema). If anything exists, abort and consult the user — do not overwrite.

## References

- Roadmap: `context/foundation/roadmap.md` lines 67–78 (F-01) and Unlocks list (`S-01 … S-07`)
- PRD: `context/foundation/prd.md`
  - Privacy NFR: line 111
  - Onboarding fields (FR-002): lines 74–75
  - Equipment-adapted intensity (FR-005): lines 84–85
  - Session tracking (FR-007/FR-008): lines 90–93
  - Plan renewal (FR-012/FR-013): lines 100–101
- Tech stack: `context/foundation/tech-stack.md`
- Supabase SSR client: `src/lib/supabase.ts:7-23`
- Middleware: `src/middleware.ts:6-16`
- Migration naming + RLS convention: `CLAUDE.md` lines 39–40

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Schema, RLS, and Type Generation

#### Automated

- [ ] 1.1 Migration applies cleanly: `npx supabase db reset`
- [ ] 1.2 Type generation succeeds: `npm run db:types` exits 0 and `src/types.ts` is non-empty
- [ ] 1.3 Linting passes: `npm run lint`
- [ ] 1.4 Build succeeds: `npm run build`
- [ ] 1.5 Astro typecheck passes: `npx astro sync && npx astro check`
- [ ] 1.6 Partial unique index enforced: second `status='active'` plan INSERT fails

#### Manual

- [ ] 1.7 Supabase Studio schema graph shows four tables with correct FKs
- [ ] 1.8 Each table has 4 policies (SELECT/INSERT/UPDATE/DELETE) on `authenticated`; no anon policies
- [ ] 1.9 Two-account smoke test: user B cannot SELECT user A's profile

### Phase 2: Automated RLS Verification (pgTAP)

#### Automated

- [ ] 2.1 `npx supabase test db` reports `ok` for every assertion locally
- [ ] 2.2 CI runs `supabase test db` and is green on this PR
- [ ] 2.3 One-time validation: deliberately broken-RLS commit fails CI (then reverted)

#### Manual

- [ ] 2.4 `manual-verification.md` checklist completed and signed off
- [ ] 2.5 `supabase test db` runs locally in under 60 seconds
