# MVP Data Schema and RLS Implementation Plan

## Overview

Define the four MVP database tables — `profiles`, `plans`, `plan_sessions`, `session_logs` — with strict per-user Row-Level Security, in a single atomic Supabase migration. Add a `db:types` script to generate `src/types.ts` so every downstream slice has typed access. Verify cross-user isolation with a manual two-account check against the linked remote project (automated pgTAP-in-CI is deferred under remote-only POC posture per commit 2c3a4d5; see Open Risks). Scope is DB-only — no API, no UI, no AI integration.

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
- Supabase project is linked to a remote ref (`yfigasipwpqrzakwxcxl`); per commit 2c3a4d5, local Docker is disabled for this project (the active `.dev.vars` points at remote credentials with local Docker preserved only as commented-out fallback). `supabase db push --linked` is the deploy and apply path; there is no local stack against which to run `supabase test db` or `supabase db reset`. CLAUDE.md line 48 (`Local Supabase: \`npx supabase start\` (requires Docker)`) is stale and should be updated in this slice.

## Desired End State

A merged commit on `main` such that:

1. `supabase/migrations/<timestamp>_init_mvp_schema.sql` exists and applies cleanly to the linked remote project via `npx supabase db push --linked`.
2. The four tables exist with correct columns, FKs, CHECK constraints, indexes, and the partial unique on active plans.
3. RLS is enabled on all four tables; each has four per-operation policies on `authenticated`; `anon` has no policies (default-deny).
4. `src/types.ts` re-exports the generated `Database` type plus entity aliases (`Profile`, `Plan`, `PlanSession`, `SessionLog`, with `Insert`/`Update` variants).
5. `package.json` has a `db:types` script that regenerates `src/types.ts` from the linked project.
6. `context/changes/data-schema-and-rls/manual-verification.md` exists and is signed off after a one-time two-account cross-user isolation check against the linked project.

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

One atomic migration introduces the entire MVP schema as a single reviewable diff (~250–350 lines of SQL). Type generation is a `db:types` npm script run once at the end of Phase 1 to produce `src/types.ts`; the file is committed and regenerated on every future migration. RLS policies follow the chain pattern — direct `auth.uid()` for `profiles` and `plans`, `EXISTS` subqueries for `plan_sessions` and `session_logs`. Phase 1 lands the schema, types, and applies the migration to the linked project; Phase 2 lands the manual verification checklist and executes the two-account cross-user check. Automated RLS testing (pgTAP in CI) is intentionally deferred — it requires a local Supabase stack that this project does not maintain; the trade-off is recorded in Open Risks.

## Critical Implementation Details

**Status-vs-log invariant across tables.** `plan_sessions.status = 'done'` must coincide with the existence of a `session_logs` row; `status = 'skipped'` must not. Postgres cannot enforce this with a cross-table CHECK without a deferred trigger — kept at the app layer in S-03, which writes the status flip and the log insert in a single transaction. This is an explicit acceptance, not an oversight.

**Active-plan uniqueness.** The partial unique index `plans(user_id) WHERE status='active'` enforces "one active plan per user" at the database level. S-05's renewal flow must flip the old plan to `superseded` and insert the new `active` plan in one transaction, in that order, or the new INSERT will fail the index.

**`fitness_level` consistency.** Encoded as a CHECK constraint using `IS DISTINCT FROM` to handle three-valued logic correctly: `(ftp_source IS NOT DISTINCT FROM 'measured' AND fitness_level IS NULL) OR (ftp_source IS DISTINCT FROM 'measured' AND fitness_level IS NOT NULL)`. This correctly rejects `ftp_source='measured' AND fitness_level NOT NULL`, accepts `ftp_source=NULL AND fitness_level NOT NULL` (HRM / none-equipment), and accepts `ftp_source='estimated' AND fitness_level NOT NULL` (no-FTP-test path).

**Duration bounds, planned vs. actual.** `plan_sessions.planned_duration_min` is bounded 15–360 (a generated session is always a deliberate 15-min-to-6-hour block), while `session_logs.actual_duration_min` is intentionally wider at 1–600. A logged ride is real-world data: it can be a 2-minute aborted start or a 9-hour epic that bears little relation to what was planned. The log table therefore accepts a broader range than the planner emits — this asymmetry is by design, not a typo. (Recorded after impl-review F4.)

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

- **Extensions**: none required for this slice. `gen_random_uuid()` is a Postgres 17 core function (no extension needed).
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

- **RLS** (per `CLAUDE.md:39` — per-operation, per-role; on each table run `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`; `FORCE` is not applied, matching the documented Supabase pattern):
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

#### 3. Type generation script + split types file

**File**: `package.json` (modify), `src/db/database.types.ts` (new, generated), `src/types.ts` (new, hand-maintained wrapper)

**Intent**: Add `db:types` script that regenerates types from the linked Supabase project to a dedicated file under `src/db/`. The hand-maintained `src/types.ts` imports `Database` from that file and defines entity aliases that downstream slices consume. Regeneration only ever overwrites `src/db/database.types.ts` — `src/types.ts` is safe from `>`-truncation.

**Contract**:

- `package.json` scripts add: `"db:types": "supabase gen types --lang=typescript --linked > src/db/database.types.ts && npm run format"`
- `src/db/database.types.ts` (generated, fully overwritten by `db:types`):
  - Top of file has a header comment: `// Generated by \`npm run db:types\` — do not edit by hand.`
  - Exports `Database` type and per-enum literal unions.
- `src/types.ts` (hand-maintained, never overwritten):

  ```ts
  import type { Database } from "@/db/database.types";

  export type { Database };

  export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
  export type ProfileInsert = Database["public"]["Tables"]["profiles"]["Insert"];
  export type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"];
  // same for Plan, PlanSession, SessionLog
  // re-export enum string-literal unions: EquipmentType, TrainingGoal, FitnessLevel, FtpSource, PlanStatus, SessionStatus, SessionType
  ```

- `src/types.ts` remains the canonical import surface per `CLAUDE.md:50` ("Shared types go in `src/types.ts`") — downstream code imports `Profile`, `Plan`, etc. from `@/types`, never from `@/db/database.types`.

#### 4. CI branch fix (pre-existing bug)

**File**: `.github/workflows/ci.yml`

**Intent**: CI currently triggers on `master` (lines 5, 8), but the repo's default branch is `main`. As-is, CI never runs on the actual default branch. This slice is the first to make CI substantively relevant for schema work, so the fix lands here.

**Contract**: Replace both occurrences of `branches: [master]` with `branches: [main]` on lines 5 and 8.

#### 5. CLAUDE.md updates (local-dev workflow + correction)

**File**: `CLAUDE.md` (modify)

**Intent**: (a) Correct the stale local-Supabase line (line 48) that contradicts commit 2c3a4d5's remote-only switch. (b) Append a remote-only migration workflow note.

**Contract**:

- Replace line 48 (`Local Supabase: \`npx supabase start\` (requires Docker)`) with: `Supabase: remote linked project only (commit 2c3a4d5); apply migrations via \`npx supabase db push --linked\`. Local Docker stack is preserved as commented-out fallback in \`.dev.vars\` but not used in the active workflow.`
- At the end of the `### Environment` section, append: `After adding a migration, run \`npx supabase db push --linked\` to apply it to the remote, then \`npm run db:types\` to refresh \`src/types.ts\`.`

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly to the linked remote: `npx supabase db push --linked` succeeds
- Type generation succeeds: `npm run db:types` exits 0 and `src/types.ts` is non-empty
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`
- Astro typecheck passes: `npx astro sync && npx astro check`

#### Manual Verification:

- Supabase Studio (linked project) schema graph shows four tables with correct FK relationships
- Each table has exactly four RLS policies (SELECT/INSERT/UPDATE/DELETE) on `authenticated`; no `anon` policies

**Implementation Note**: After Phase 1's automated checks pass, pause here for manual confirmation of the two Studio checks before starting Phase 2 (which executes the deeper two-account RLS verification). Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section.

---

## Phase 2: Manual RLS Verification

### Overview

Document and execute a one-time two-account cross-user isolation check against the linked remote project. Confirms the PRD privacy guardrail end-to-end before downstream slices begin writing user data. Automated pgTAP-in-CI is deferred — see Open Risks.

### Changes Required:

#### 1. Manual verification document

**File**: `context/changes/data-schema-and-rls/manual-verification.md`

**Intent**: Single-page numbered checklist for the two-account RLS smoke test against the linked remote project, runnable by any future maintainer whenever the schema changes. Each step has an expected outcome and a checkbox; the document ends with a "signed off by <name> on <date>" line.

**Contract**: Numbered procedure with these sections:

1. **Setup** — sign up users A and B via the existing `/auth/signup` against the linked project; capture each user's `auth.users.id` from Studio.
2. **Direct ownership checks** (`profiles` + `plans`) — using Studio SQL editor's "Impersonate user" feature (or the user's JWT in a `request.jwt.claims` setting), as user A INSERT a profile + a plan; as user B run `SELECT * FROM profiles`, `SELECT * FROM plans` → expect zero rows. Attempt `UPDATE profiles SET goal='endurance' WHERE user_id='<A>'` and `DELETE FROM plans WHERE user_id='<A>'` as user B → expect zero rows affected.
3. **Chained ownership checks** (`plan_sessions` + `session_logs`) — as user A insert a `plan_sessions` row referencing A's plan, plus a `session_logs` row referencing that session. As user B run the same four ops (SELECT/UPDATE/DELETE) → expect zero rows.
4. **Constraint sanity checks** — as user A: (a) INSERT a second `status='active'` plan → expect unique-violation; (b) INSERT a `profiles` row with `equipment_type='power_meter'` + `ftp_watts NULL` → expect `power_meter_requires_ftp` CHECK violation; (c) INSERT with `ftp_source='measured'` + `fitness_level='advanced'` → expect `fitness_level_matches_ftp_source` CHECK violation.
5. **Anon role check** — switch Studio SQL editor to `anon` role; `SELECT * FROM profiles` (and the other three tables) → expect zero rows (RLS default-deny on tables with no `anon` policies).
6. **Sign-off line** — "Checked off by <name> on <date>; outcomes match expectations."

After sign-off, the document is committed to the repo as the live evidence that F-01 satisfied the PRD privacy guardrail.

### Success Criteria:

#### Manual Verification:

- `manual-verification.md` exists with numbered procedure covering all four tables × {SELECT, UPDATE, DELETE} cross-user denial, plus the three constraint sanity checks
- All steps executed against the linked remote project; expected outcomes observed and recorded
- Document signed off with name + date
- Test data created during verification is cleaned up (DELETE the test users via Supabase Studio Auth panel) after sign-off

**Implementation Note**: This phase has no automated verification. The manual checklist is the gate. If the linked project accumulates test data the developer cannot delete (or doesn't want to), perform the check against a freshly-created Supabase project that mirrors the migration, then transfer the sign-off.

---

## Testing Strategy

### Unit Tests:

No unit tests in this slice — there is no application code beyond `src/types.ts`.

### Integration Tests:

None automated in this slice. CHECK constraints and RLS isolation are exercised manually via `manual-verification.md` in Phase 2. (Pre-written pgTAP test design from the planning round is preserved in this plan's Open Risks section for future reactivation if local Docker is re-enabled.)

### Manual Testing Steps:

1. Run `npx supabase db push --linked` from a developer machine logged in to Supabase; confirm the migration applies with no errors.
2. Open Supabase Studio (linked project); confirm the four-table FK graph and each table's RLS-policy count (4 per table on `authenticated`, 0 on `anon`).
3. Execute the procedure in `manual-verification.md` end-to-end (two-account isolation + constraint sanity + anon denial); record outcomes; sign off.
4. Run `npm run db:types`; confirm `src/types.ts` regenerates and `git diff` shows only intentional changes (e.g., new tables on first run).

## Performance Considerations

Target scale (per PRD frontmatter: `users: small`, `qps: low`, `data_volume: small`) puts the entire system well under any RLS performance threshold. Expected per-user row counts: ~12 plans lifetime × ~25 sessions/plan = ~300 plan_sessions; ~300 session_logs; 1 profile. Indexes on FK columns and the partial unique on active plans are the only performance-relevant choices in this slice. RLS `EXISTS` subqueries add ~1–2 ms per query at this volume — not a concern.

## Migration Notes

Forward-only — no existing rows to migrate. Deploy path is `npx supabase db push --linked` against the linked project; there is no local stack to apply against (per commit 2c3a4d5). Before the first push, verify the linked project has no existing public-schema tables (Studio → Table Editor → `public` schema). If anything exists, abort and consult the user — do not overwrite. After push, any rollback requires a counter-migration (Supabase does not auto-rollback migrations on the remote — see `context/foundation/infrastructure.md:96`).

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

- [x] 1.1 Migration applies cleanly to linked remote: `npx supabase db push --linked` succeeds — f95bbef
- [x] 1.2 Type generation succeeds: `npm run db:types` exits 0 and `src/types.ts` is non-empty — f95bbef
- [x] 1.3 Linting passes: `npm run lint` — f95bbef
- [x] 1.4 Build succeeds: `npm run build` — f95bbef
- [x] 1.5 Astro typecheck passes: `npx astro sync && npx astro check` — f95bbef

#### Manual

- [x] 1.6 Supabase Studio schema graph shows four tables with correct FKs — f95bbef
- [x] 1.7 Each table has 4 policies (SELECT/INSERT/UPDATE/DELETE) on `authenticated`; no anon policies — f95bbef

### Phase 2: Manual RLS Verification

#### Manual

- [x] 2.1 `manual-verification.md` exists with the full procedure (two-account isolation + constraint checks + anon denial) — e68a16c
- [x] 2.2 Two test accounts created; cross-user SELECT/UPDATE/DELETE denied on all four tables — e68a16c
- [x] 2.3 Constraint sanity checks pass: partial-unique-on-active-plans, power_meter_requires_ftp, fitness_level_matches_ftp_source — e68a16c
- [x] 2.4 Anon role denied on all four tables — e68a16c
- [x] 2.5 Document signed off with name + date; test users deleted from the linked project — e68a16c
