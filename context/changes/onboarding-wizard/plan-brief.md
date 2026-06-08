# Onboarding Wizard — Plan Brief

> Full plan: `context/changes/onboarding-wizard/plan.md`

## What & Why

Build the WattWise onboarding wizard (roadmap slice S-01): the multi-step form where a cyclist declares their goal, equipment, FTP (or a fitness-level estimate), age, weight, and weekly availability, reviews it, and confirms — persisting a profile. This is the data-quality gate for the whole product: the AI plan in S-02 is only as correct as what this form captures, and the PRD's hardest guardrail ("intensity targets must match declared equipment exactly") starts here.

## Starting Point

The `profiles` table and its CHECK constraints already exist (F-01, done). Supabase SSR auth, middleware, and the signup/signin/signout routes are in place. There is no form stack beyond the shadcn `Button`, no `zod` direct dependency, and nothing routes a logged-in-but-profile-less user anywhere.

## Desired End State

A logged-in cyclist with no profile is routed to `/onboarding`, completes a grouped wizard with equipment-driven branching, reviews their answers, confirms, and lands on a `/dashboard` "plan coming soon" stub with a valid `profiles` row written. Returning mid-wizard restores their answers; revisiting onboarding after completion redirects away.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| S-01/S-02 seam | Save profile → dashboard stub | Clean seam; S-02 fills the stub; matches "data persists" outcome | Plan |
| Form layout | Multi-step grouped screens + review | Matches PRD "wizard"; branching feels natural per step; mobile-friendly | Plan |
| Draft persistence | localStorage | Satisfies "survive browser close" with no schema/backend work | Plan |
| FTP estimate | W/kg × weight (beginner 2.0 / intermediate 2.8 / advanced 3.7) | Personalized, physiologically sound, reuses collected weight | Plan |
| Form stack | zod + fetch JSON, plain React state | One schema both sides; inline errors keep wizard state; minimal deps | Plan |
| Route gating | Middleware on profile presence | Single enforcement point; can't skip or re-run; honors "never re-enter" | Plan |
| Max HR (HRM) | Input prefilled with 220−age, overridable | Mirrors "I don't know my FTP" grace; no one blocked | Plan |
| Submit failure | Upsert on user_id + inline error on review | Race-safe vs double-submit; no lost input; no leaked DB errors | Plan |

## Scope

**In scope:** onboarding wizard UI, equipment branching, localStorage draft, review/confirm screen, zod schema (client+server), `POST /api/onboarding`, profile service, server-side FTP/max-HR derivation, middleware gating, signin redirect, dashboard stub.

**Out of scope:** AI plan generation (S-02), profile editing (S-04), FTP editing, server-side draft table, react-hook-form, any schema/migration change.

## Architecture / Approach

One React island (`OnboardingWizard.tsx`) holds all state in `useState`, persists `{answers, step}` to `localStorage`, and POSTs JSON to `/api/onboarding`. A single shared zod schema validates per-step on the client and the request body on the server. The server route derives authoritative FTP/max-HR/fitness-level/ftp-source values (so a tampered body can't violate the DB CHECK constraints), maps to `ProfileInsert`, and upserts via a profile service. Middleware uses profile presence to route users into or out of `/onboarding`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Foundations | zod dep, shadcn primitives, shared schema, derivation helpers | Schema/constraint mismatch with the DB |
| 2. Service + API | profile service + validated, deriving `POST /api/onboarding` | Server derivation must satisfy all 3 equipment CHECK paths |
| 3. Wizard + page | multi-step island, localStorage draft, review, `/onboarding` | Branching + draft-rehydration state correctness |
| 4. Gating + stub | middleware routing, signin redirect, dashboard stub | Redirect loops / leaving a route ungated |

**Prerequisites:** F-01 (done). Authenticated session for manual testing.
**Estimated effort:** ~3–4 focused sessions across 4 phases.

## Open Risks & Assumptions

- localStorage drafts are device/browser-local — a different device starts fresh (accepted for a one-time flow).
- W/kg constants (2.0 / 2.8 / 3.7) are a reasonable default; tune later if plan quality (S-02) suggests otherwise.
- The per-request middleware profile lookup is fine at the PRD's small scale / low QPS.

## Success Criteria (Summary)

- A cyclist completes onboarding for any equipment type and a constraint-valid `profiles` row is written.
- Answers survive a browser close mid-wizard; a completed user is never asked to re-enter data.
- Equipment selection drives exactly the right fields — no power-meter user without an FTP value, no HRM user without max-HR.
