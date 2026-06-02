# MVP Data Schema and RLS — Plan Brief

> Full plan: `context/changes/data-schema-and-rls/plan.md`

## What & Why

Define the four MVP database tables — `profiles`, `plans`, `plan_sessions`, `session_logs` — with strict per-user Row-Level Security, so every downstream slice (S-01 through S-07) writes against a stable, typed, isolated data layer. RLS is the hardest PRD guardrail ("a user's training data is never visible to or accessible by any other user account") and a misconfiguration here invalidates every later slice — so it ships first, atomically, with automated cross-user isolation tests.

## Starting Point

Supabase project is linked (`yfigasipwpqrzakwxcxl`) and the auth layer is fully wired (`src/lib/supabase.ts`, `src/middleware.ts`, three auth API routes). Per commit 2c3a4d5, the project runs against the remote Supabase only — local Docker is disabled (preserved as commented-out fallback in `.dev.vars`). `supabase/migrations/` is empty, `src/types.ts` doesn't exist, `package.json` has no type-generation script, and CI runs lint + build with no schema check.

## Desired End State

After this slice merges, `npx supabase db push --linked` has applied the migration to the linked remote project, which now hosts the four MVP tables with correct FKs, CHECK constraints, indexes, and four per-operation RLS policies on `authenticated` for each table. `src/types.ts` exports `Database` plus entity aliases. A one-time two-account cross-user isolation check is documented and signed off in `manual-verification.md`. Automated RLS testing in CI is deferred — see Open Risks.

## Key Decisions Made

| Decision                              | Choice                                                                                          | Why (1 sentence)                                                                                                          | Source |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------ |
| Intensity-target storage              | Zone number only (1–7) per segment                                                              | One canonical AI output works for all three equipment types; FTP refresh at renewal auto-refreshes prescribed watts.      | Plan   |
| Session content shape                 | JSONB `structure` column (ordered segments with kind/duration/zone/repeats)                     | Matches the LLM's natural output shape; no extra table to RLS-protect; sessions are always read whole.                    | Plan   |
| HR anchor                             | `max_hr` defaulted to `220 − age` with user override                                            | HR zones need an anchor; PRD says HRM users see HR zones; explicit measured-or-overridden value beats hidden formula.     | Plan   |
| `fitness_level` collection            | Collected whenever measured FTP is absent (power-meter-no-test + all HRM + all no-equipment)    | AI needs a fitness magnitude to size intervals; FTP doubles as magnitude for measured users; everyone else needs a proxy. | Plan   |
| Session-log shape                     | Separate `session_logs` table, 1:1 with `plan_sessions`                                         | Matches roadmap F-01's "four tables" outcome; cleaner separation of prescription vs execution.                            | Plan   |
| Weekly availability shape             | Three structured columns (`available_days text[]`, `max_workday_minutes`, `max_weekend_minutes`)| Validated at schema level via CHECK; AI prompt builds cleanly from named columns.                                         | Plan   |
| Active-plan resolution                | `plans.status` enum + partial unique index `(user_id) WHERE status='active'`                    | Single indexed read for the most common query; database enforces the "one active plan" invariant.                         | Plan   |
| RLS verification                      | One-time manual two-account check against the linked remote project; pgTAP-in-CI deferred       | Remote-only project has no local stack to run `supabase test db` against; manual check satisfies the POC budget.          | Plan   |
| Migration granularity                 | One atomic file (`init_mvp_schema.sql`)                                                         | Greenfield schema is one coherent unit; review-diff is a single file; rollback is all-or-nothing.                         | Plan   |

## Scope

**In scope:**

- One SQL migration creating extensions, 7 enums, 4 tables, indexes (incl. partial unique on active plans), per-operation RLS policies on `authenticated`, `updated_at` trigger
- Empty `supabase/seed.sql` to resolve the dangling config reference
- `db:types` npm script + initial generated `src/types.ts` with entity aliases
- `CLAUDE.md` correction (replace stale "Local Supabase" line with remote-only guidance) + one-line workflow note
- `manual-verification.md` checklist; one-time execution and sign-off against the linked remote project

**Out of scope:**

- API endpoints, UI, AI integration (every other slice owns these)
- `src/lib/zones.ts` zone-lookup table (S-02, where it's used)
- Auto-creating a `profiles` row on sign-up (S-01 owns the first INSERT)
- FTP edit logic, fitness-level → FTP estimate mapping (S-01 / S-05)
- Background jobs, expiry detection, observability
- pgTAP RLS test file + `supabase test db` in CI (deferred under remote-only POC posture; design preserved in plan Open Risks for future reactivation)

## Architecture / Approach

Single atomic migration runs four-table DDL plus per-operation RLS policies in one transaction, applied via `npx supabase db push --linked` to the remote project. `profiles` and `plans` use direct `user_id = auth.uid()` ownership; `plan_sessions` and `session_logs` use `EXISTS` chains through `plans`. Type generation is an npm script that writes `src/types.ts` from the linked Supabase project; the file is committed and regenerated whenever schema changes. Verification is a one-time manual two-account check against the linked project, documented in `manual-verification.md` and signed off after execution.

```
auth.users ──┐
             ├──▶ profiles                    (1:1 with user)
             └──▶ plans ──▶ plan_sessions ──▶ session_logs
                                              (1:1 with done sessions)
```

## Phases at a Glance

| Phase                              | What it delivers                                                                                       | Key risk                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| 1. Schema, RLS, and Type Generation| Migration pushed to linked remote; `src/types.ts` generated; four tables with RLS visible in Studio    | RLS policy chain misconfigured on `plan_sessions` / `session_logs` (caught in P2) |
| 2. Manual RLS Verification         | `manual-verification.md` executed against the linked project; cross-user denial confirmed; signed off  | Manual gate — regressions on future schema changes only caught when re-run        |

**Prerequisites:** Supabase project linked; auth flow working; developer logged in to Supabase CLI (`supabase login`). No external blockers.

**Estimated effort:** ~1 evening session. Phase 1 is mostly mechanical schema writing; Phase 2 is a ~30-minute scripted manual check.

## Open Risks & Assumptions

- **Automated RLS testing deferred** — Without a local Supabase stack (project is remote-only per commit 2c3a4d5), `supabase test db` cannot run. Verification is one-time manual; future migrations that touch RLS rely on the developer re-running `manual-verification.md`. If the project later reactivates a local Docker stack — or adopts Supabase branch databases — a pgTAP test file can be added in a follow-up slice. Pre-designed pgTAP assertions: anon role denied SELECT × 4 tables; user A inserts each entity, user B sees zero rows × 4 tables; UPDATE/DELETE denial × 4 tables; partial-unique-on-active-plans violation; CHECK violations on `power_meter_requires_ftp` and `fitness_level_matches_ftp_source`.
- **Status-vs-log invariant is app-enforced**, not DB-enforced — `plan_sessions.status='done'` ↔ `session_logs` row existence is upheld by S-03's transactional write. A future agent writing to these tables outside that transaction could violate it. Accepted; documented in Critical Implementation Details.
- **Active-plan transition is app-enforced** — S-05's renewal must flip the old plan to `superseded` before (or atomically with) inserting the new `active`. The partial unique index guarantees only one active row exists, but does not order the transition.
- **(Resolved during planning)** Originally `db:types` overwrote `src/types.ts` with truncation risk to hand-added aliases. Resolved by splitting into `src/db/database.types.ts` (generated, regenerable) and `src/types.ts` (hand-maintained wrapper importing `Database`). Regen never touches `src/types.ts`.
- **Types-drift not CI-enforced** — A future migration PR that forgets to re-run `npm run db:types` ships stale `src/db/database.types.ts`. Under remote-only, the CI-side guard would require Supabase CLI auth in GH Actions (talks to the remote). Accepted for the POC; mitigation is the CLAUDE.md workflow note. Revisit when the team scales beyond solo.
- **Migration rollback on remote** — `supabase db push --linked` writes directly to the production-like database; a bad migration requires a counter-migration to undo (per `context/foundation/infrastructure.md:96`). Mitigation: verify the linked project is empty before first push.

## Success Criteria (Summary)

- `npx supabase db push --linked` deploys the migration to the linked project with no errors; all four tables + RLS visible in Studio
- `manual-verification.md` is signed off, with two-account isolation, constraint violations, and anon denial all confirmed against the linked project
- A signed-up user with no profile row reaches an onboarding-ready state; once a profile is inserted, only that user's plans, sessions, and logs are ever visible to them
