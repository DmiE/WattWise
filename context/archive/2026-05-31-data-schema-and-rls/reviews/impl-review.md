<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: MVP Data Schema and RLS

- **Plan**: context/changes/data-schema-and-rls/plan.md
- **Scope**: Phases 1–2 of 2 (full plan)
- **Date**: 2026-06-04
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Success Criteria Verification

- `npm run lint` — PASS (no errors; only `astro-eslint-parser` projectService notices)
- `npx astro sync && npx astro check` — PASS (30 files, 0 errors, 0 warnings, 4 hints)
- `npx supabase db push --linked` — implementer-verified (Progress 1.1 — f95bbef); requires remote credentials, not re-run in review
- `npm run db:types` — implementer-verified (Progress 1.2 — f95bbef); requires linked project
- `npm run build` — implementer-verified (Progress 1.4 — f95bbef)
- Manual Studio checks + two-account RLS isolation + constraint/anon checks — signed off in manual-verification.md (Progress 1.6–1.7, 2.1–2.5 — e68a16c)

## Findings

### F1 — set_updated_at() has a mutable search_path

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260602182721_init_mvp_schema.sql:21-29
- **Detail**: The trigger function is `language plpgsql` with no `set search_path` clause — exactly the Supabase advisor warning `function_search_path_mutable`. Low exploitability (body only touches `new.updated_at` and `now()`) but will flag on the linked project's linter.
- **Fix**: Pin the search path and qualify now():
  ```sql
  create or replace function public.set_updated_at()
  returns trigger language plpgsql
  set search_path = ''
  as $$ begin new.updated_at = pg_catalog.now(); return new; end; $$;
  ```
  - Strength: Clears the Supabase advisor warning; standard hardening for SECURITY-relevant trigger functions.
  - Tradeoff: Minor — one function definition, must qualify `now()` as `pg_catalog.now()`.
  - Confidence: HIGH — well-documented Supabase lint rule.
  - Blind spot: None significant.
- **Decision**: FIXED — new follow-up migration `supabase/migrations/20260605065635_pin_set_updated_at_search_path.sql` re-creates the function with `set search_path = ''` and `pg_catalog.now()`. Needs `npx supabase db push --linked` to apply to remote.

### F2 — Unplanned changes: eslint ignore + db:types script shape

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: eslint.config.js:73 ; package.json:13
- **Detail**: Two benign deviations from the plan's file contract. (a) eslint.config.js adds `{ ignores: ["src/db/database.types.ts"] }` — not in plan, but a sensible exclusion of a generated file from type-checked lint. (b) The `db:types` script differs from the plan's literal one-liner — uses `mkdir -p src/db` + `printf` header prepend + `prettier --write` on the single file. This is arguably an improvement: it actually produces the "// Generated … do not edit" header the plan's contract required.
- **Fix**: None needed — accept as benign scope additions. Optionally note the eslint ignore in the plan as an addendum.
- **Decision**: SKIPPED — accepted as benign scope additions.

### F3 — db:types truncates the types file if generation fails

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: package.json:13
- **Detail**: The `{ printf …; supabase gen types …; } > src/db/database.types.ts` redirect truncates the target before the command runs. If generation fails (auth expired, not linked) the file is left near-empty. No injection risk — the printf format string and header arg are static. Low impact: regenerable and caught by typecheck.
- **Fix**: Generate to a temp file and `mv` on success: `… supabase gen types … > src/db/database.types.tmp && mv src/db/database.types.tmp src/db/database.types.ts && prettier --write …`
- **Decision**: FIXED — `package.json` `db:types` now writes to `src/db/database.types.ts.tmp` and `mv`s on success; a failed `gen types` leaves the existing file intact.

### F4 — actual vs planned duration bound asymmetry

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: migration:160 (planned 15–360) vs :233 (actual 1–600)
- **Detail**: `plan_sessions.planned_duration_min` is bounded 15–360 while `session_logs.actual_duration_min` is 1–600. Both match the plan contract exactly (zero drift), so this is plan-as-designed. Flagging only to confirm the wider actual-duration window is intentional (a real ride can run longer/shorter than planned) rather than a typo.
- **Fix**: Confirm intent; no code change expected.
- **Decision**: ACCEPTED — bounds intentionally kept at 1–600; asymmetry documented in `plan.md` (Critical Implementation Details → "Duration bounds, planned vs. actual").

## Notes

Plan-drift analysis found zero drift/missing/extra across the migration, `src/types.ts`, and `seed.sql`: all 7 enums, 4 tables, every CHECK bound, all 4 indexes (incl. the partial unique active-plan index), exactly 4 RLS policies per table scoped `to authenticated` (anon default-denied), RLS ENABLE (no FORCE), and the `set_updated_at` trigger on the correct 3 tables. The two highest-risk RLS isolation holes — UPDATE without `WITH CHECK`, and cross-user INSERT on the chained `plan_sessions`/`session_logs` tables — are both correctly closed. Policies use the Supabase-recommended `(select auth.uid())` initplan form.
