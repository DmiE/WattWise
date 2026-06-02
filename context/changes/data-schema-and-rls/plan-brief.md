# MVP Data Schema and RLS — Plan Brief

> Full plan: `context/changes/data-schema-and-rls/plan.md`

## What & Why

Define the four MVP database tables — `profiles`, `plans`, `plan_sessions`, `session_logs` — with strict per-user Row-Level Security, so every downstream slice (S-01 through S-07) writes against a stable, typed, isolated data layer. RLS is the hardest PRD guardrail ("a user's training data is never visible to or accessible by any other user account") and a misconfiguration here invalidates every later slice — so it ships first, atomically, with automated cross-user isolation tests.

## Starting Point

Supabase project is linked and the auth layer is fully wired (`src/lib/supabase.ts`, `src/middleware.ts`, three auth API routes), but `supabase/migrations/` is empty, `src/types.ts` doesn't exist, `package.json` has no type-generation script, and CI runs lint + build with no schema or RLS check.

## Desired End State

After this slice merges, a fresh database can be brought up with `npx supabase db reset` and contains the four MVP tables with correct FKs, CHECK constraints, indexes, and four per-operation RLS policies on `authenticated` for each table. `src/types.ts` exports `Database` plus entity aliases. `supabase test db` passes locally and runs on every CI build, catching any future RLS regression at PR time. A manual two-account check is documented and signed off once.

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
| RLS verification                      | pgTAP test in `supabase/tests/` + CI step + one-time manual two-account check                   | Cross-user isolation is the PRD's hardest guardrail; mechanical verification survives every future schema change.         | Plan   |
| Migration granularity                 | One atomic file (`init_mvp_schema.sql`)                                                         | Greenfield schema is one coherent unit; review-diff is a single file; rollback is all-or-nothing.                         | Plan   |

## Scope

**In scope:**

- One SQL migration creating extensions, 7 enums, 4 tables, indexes (incl. partial unique on active plans), per-operation RLS policies on `authenticated`, `updated_at` trigger
- Empty `supabase/seed.sql` to resolve the dangling config reference
- `db:types` npm script + initial generated `src/types.ts` with entity aliases
- One-line note in `CLAUDE.md` pointing at the local-reset workflow
- pgTAP RLS test file + CI step + manual-verification checklist

**Out of scope:**

- API endpoints, UI, AI integration (every other slice owns these)
- `src/lib/zones.ts` zone-lookup table (S-02, where it's used)
- Auto-creating a `profiles` row on sign-up (S-01 owns the first INSERT)
- FTP edit logic, fitness-level → FTP estimate mapping (S-01 / S-05)
- Background jobs, expiry detection, observability

## Architecture / Approach

Single atomic migration runs four-table DDL plus per-operation RLS policies in one transaction. `profiles` and `plans` use direct `user_id = auth.uid()` ownership; `plan_sessions` and `session_logs` use `EXISTS` chains through `plans`. Type generation is an npm script that writes `src/types.ts` from the linked Supabase project; the file is committed and regenerated whenever schema changes. Verification is two layers: a pgTAP file (`supabase/tests/rls_test.sql`) running on `ubuntu-latest` in CI (Supabase CLI + local Docker), and a documented one-time manual two-account smoke test.

```
auth.users ──┐
             ├──▶ profiles                    (1:1 with user)
             └──▶ plans ──▶ plan_sessions ──▶ session_logs
                                              (1:1 with done sessions)
```

## Phases at a Glance

| Phase                                | What it delivers                                                                              | Key risk                                                                          |
| ------------------------------------ | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1. Schema, RLS, and Type Generation  | Migration applies cleanly; `src/types.ts` generated; four tables with RLS visible in Studio   | RLS policy chain misconfigured on `plan_sessions` / `session_logs` (caught in P2) |
| 2. Automated RLS Verification (pgTAP)| `supabase test db` passes locally + in CI; manual-verification.md signed off                  | CI Docker setup adds time to every build; pgTAP learning curve (~30 min)          |

**Prerequisites:** Supabase project linked; auth flow working (both already true per baseline). No external blockers.

**Estimated effort:** ~1–2 evening sessions across the two phases for a solo developer comfortable with Supabase + SQL. Phase 1 is mostly mechanical schema writing; Phase 2 is pgTAP learning + CI tweak.

## Open Risks & Assumptions

- **Status-vs-log invariant is app-enforced**, not DB-enforced — `plan_sessions.status='done'` ↔ `session_logs` row existence is upheld by S-03's transactional write. A future agent writing to these tables outside that transaction could violate it. Accepted; documented in Critical Implementation Details.
- **Active-plan transition is app-enforced** — S-05's renewal must flip the old plan to `superseded` before (or atomically with) inserting the new `active`. The partial unique index guarantees only one active row exists, but does not order the transition.
- **CI Docker time cost** — adding `supabase test db` to CI adds ~30–60s per build; acceptable for the safety gained, but noted.
- **Type-gen file overwrite** — the `db:types` script overwrites `src/types.ts` entirely; the hand-added entity aliases live below a boundary comment but a future careless run will erase them. A potential future split into `types.generated.ts` + `types.ts` is intentionally deferred.

## Success Criteria (Summary)

- `npx supabase db reset` recreates the local DB with all four tables + RLS in seconds, with no errors
- `npx supabase test db` passes locally and in CI; cross-user isolation is mechanically verified
- A signed-up user with no profile row reaches an onboarding-ready state; once a profile is inserted, only that user's plans, sessions, and logs are ever visible to them
