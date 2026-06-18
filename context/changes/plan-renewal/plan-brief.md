# Plan Renewal (S-05) — Plan Brief

> Full plan: `context/changes/plan-renewal/plan.md`
> Research: `context/changes/plan-renewal/research.md`

## What & Why

When a user's 28-day training plan expires, intercept their next visit with a renewal check-in: confirm/update goal, weekly availability, and — for power-meter users only — current FTP, then regenerate a fresh 4-week AI plan. This closes the core training loop (Stream B) and fulfils the "FTP can only be updated at plan renewal" promise already shown in the profile editor (PRD FR-012, FR-013, US-02).

## Starting Point

The S-02 generation pipeline is profile-pure and reusable, but hard-wired for *first* plans: `POST /api/plans/generate` short-circuits when an active plan exists (no LLM call), and `persistPlan` treats an activation conflict as an "idempotent win" — returning the old plan. The `one_active_plan_per_user` index guarantees one never-replaced active plan. `plans.end_date` and the `superseded`/`expired` enum values already exist, but nothing ever transitions a plan off `active`.

## Desired End State

A user whose plan's `end_date` is past is redirected to `/renewal`, sees their current inputs prefilled, submits, watches a ~22s progress screen, and lands on `/dashboard` with a new active plan — the old one marked `superseded`. Non-expired users are never gated.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Endpoint shape | Dedicated `POST /api/plans/renew` | Keeps S-02's idempotent first-plan contract untouched; renewal guards live alone | Plan |
| Atomic plan swap | Insert pending+sessions, then a transactional RPC flips old→superseded + new→active | Truly atomic; reuses crash-safe phased persist; mirrors `set_session_status` precedent | Plan |
| Old plan status | `superseded`; expiry detected by `end_date` at read time | "Superseded" = replaced by renewal; no background job needed to mark expiry | Plan |
| Expiry date source | Server UTC date in middleware | Self-contained, deterministic, testable; no client round-trip; negligible boundary skew on a 28-day plan | Plan |
| Renewal input scope | Goal + availability + FTP (power-meter only); no age/weight | Matches PRD US-02 exactly; keeps the gate focused | Plan |
| FTP field behavior | Editable, prefilled; confirming sets `ftp_source='measured'` | Honors "update current FTP"; matches `toProfileInsert` measured branch | Plan |
| Gate behavior | Hard gate (like onboarding) | Mirrors the one proven gating pattern; guarantees "first screen on next visit" | Plan |

## Scope

**In scope:** expiry detection (date-based), middleware gate → `/renewal`, prefilled check-in form (goal, availability, power-meter FTP), synchronous regeneration, atomic supersede of the old plan.

**Out of scope:** editing age/weight at renewal (stays in profile editor), background/cron expiry marking, changes to the first-plan route, dismissible gate, session history (S-06), intensity reference (S-07), per-user timezones.

## Architecture / Approach

Middleware (server UTC date) reads the active plan after the existing profile gate; if expired, redirects to `/renewal`. The page server-fetches profile + plan to prefill a React form island. On submit, the island POSTs to `/api/plans/renew`, which: validates → guards eligibility (must be expired) → guards power-meter FTP → builds an in-memory merged profile → generates (reusing the S-02 pipeline) → and only on a valid plan persists the profile update + the new plan via `persistPlan({ supersede: true })`, which calls the RPC to atomically retire the old plan and activate the new one. Generation-before-mutation ordering means a failed generation leaves the old plan active.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Atomic RPC | `supersede_and_activate_plan` migration + types | Status-swap ordering vs the non-deferrable unique index |
| 2. Domain logic | renewal schema, merge/FTP derivation, expiry helper, `supersede` persist option | FTP coupling (`fitness_level_matches_ftp_source`) |
| 3. Renew route | `POST /api/plans/renew`, synchronous generate + atomic persist | Generation-before-mutation ordering; eligibility/FTP guards |
| 4. Page + form | `/renewal` page + prefilled island with progress UI | FTP gate correctness; ~22s wait UX |
| 5. Middleware gate | Expiry → `/renewal` redirect, loop-guard, fail-open | Gate ordering after the profile gate |

**Prerequisites:** S-02 (generation) and S-03 (session tracking) — both done. Supabase remote linked for migration push.
**Estimated effort:** ~2-3 sessions across 5 phases.

## Open Risks & Assumptions

- Assumes the new RPC can run RLS-scoped via `SECURITY INVOKER` + `auth.uid()` exactly like `set_session_status` — verify during Phase 1.
- A power-meter user who originally *estimated* FTP and just confirms the prefilled value silently promotes it to `measured`; mitigated with field copy ("Enter your current FTP").
- Boundary timezone skew (server UTC vs user local) can shift the check-in by up to ~a day — accepted for a 28-day cycle.

## Success Criteria (Summary)

- An expired plan reliably triggers the renewal check-in on next visit; non-expired plans never do.
- Confirming produces exactly one new active plan (old one `superseded`), with intensity targets matching the user's (possibly updated) inputs.
- The FTP field appears only for power-meter users, and a generation failure never destroys the existing plan.
