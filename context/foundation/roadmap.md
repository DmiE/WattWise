---
project: WattWise
version: 1
status: draft
created: 2026-05-31
updated: 2026-06-15
prd_version: 1
main_goal: speed
top_blocker: time
---

# Roadmap: WattWise

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

Amateur road cyclists who already know their FTP have no tool that converts their fitness number, training goal, and weekly schedule into today's specific session — with exact watts, heart-rate zones, or RPE targets they can execute immediately. WattWise is prescriptive where Strava and TrainingPeaks are analytical: it generates the next action, not a retrospective. The MVP proves this works by taking a cyclist through a single onboarding flow and producing a 4-week AI-generated training plan with intensity targets adapted to whatever equipment they own.

## North star

**S-02: User confirms onboarding inputs and receives a first AI-generated 4-week plan with equipment-adapted intensity targets.**

> *"North star"* here means the smallest end-to-end slice whose successful delivery would prove the core product hypothesis — the bet that an AI model can turn FTP + goal + availability into a correct, equipment-adapted training plan — placed as early as Prerequisites allow because everything else only matters if this works. For WattWise, that proof moment is when a real cyclist sees watts (or heart-rate zones, or RPE descriptions) they can act on immediately.

## At a glance

| ID   | Change ID               | Outcome (user can …)                                                                 | Prerequisites | PRD refs                    | Status   |
| ---- | ----------------------- | ------------------------------------------------------------------------------------ | ------------- | --------------------------- | -------- |
| F-01 | data-schema-and-rls     | (foundation) MVP schema live; profile, plan, and session tables with RLS in place    | —             | §NFRs (data privacy)        | done     |
| S-01 | onboarding-wizard       | complete the onboarding wizard and see a confirmation screen; data persists          | F-01          | FR-001, FR-002, FR-003, US-01 | done     |
| S-02 | first-plan-generation   | confirm inputs and receive a 4-week AI plan with equipment-adapted intensity targets | S-01          | FR-004, FR-005, FR-006, US-01 | done     |
| S-04 | profile-editing         | edit goal, availability, age, and weight after onboarding                            | S-01          | FR-010                      | proposed |
| S-03 | session-tracking        | mark any session done (with log) or skipped                                          | S-02          | FR-007, FR-008              | done |
| S-07 | intensity-reference     | see zone definitions or RPE scale within a session view                              | S-02          | FR-011                      | proposed |
| S-05 | plan-renewal            | see a renewal check-in when the plan expires and receive a new AI plan               | S-02, S-03    | FR-012, FR-013, US-02       | proposed |
| S-06 | session-history         | view a scrollable list of completed sessions                                         | S-03          | FR-009                      | proposed |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                 | Chain                                    | Note                                                                                   |
| ------ | --------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------- |
| A      | Schema & north star   | `F-01` → `S-01` → `S-02`                | Critical path to the north star; with `main_goal: speed`, nothing is deferred here.   |
| B      | Session loop          | `S-02` → `S-03` → `S-05`                | Downstream of north star; closes the training loop with session tracking and renewal. |
| C      | Profile (parallel)    | `S-01` → `S-04`                          | Parallel with Stream A from S-02 onward; lowest risk, ships any time after S-01.      |
| D      | Nice-to-have polish   | `S-02` → `S-07` / `S-03` → `S-06`       | Park first if 6-week budget is tight; secondary success criterion and reference UX.    |

## Baseline

What's already in place in the codebase as of `2026-05-31` (auto-researched + user-confirmed).
Foundations below assume these layers are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 6 + React 19 + Tailwind 4; file-based routing via `/src/pages`; minimal shadcn-style component library in `/src/components/ui/`
- **Backend / API:** partial — three auth routes only (`/src/pages/api/auth/`); no domain-logic endpoints (plan, sessions, profile)
- **Data:** partial — Supabase + PostgreSQL configured; no migration files or schema; seed.sql absent
- **Auth:** present — full Supabase SSR auth; `middleware.ts` enforces protected routes; FR-001 (register) and FR-003 (login/logout) are satisfied
- **Deploy / infra:** partial — Cloudflare Workers target configured; GitHub Actions CI runs lint + build; no CD step
- **Observability:** absent — no logging library, no error tracking, no metrics
- **AI integration:** present as of S-02 — OpenRouter (OpenAI-compatible REST, called with plain `fetch`, no vendor SDK) routing to a config-driven model (`OPENROUTER_MODEL`, currently `anthropic/claude-sonnet-4.5`); plan-generation route, prompt builder, and zod trust-boundary live under `src/lib/`. (Baseline through S-01 had no AI integration; the earlier "Anthropic SDK not installed" note is superseded.)

## Foundations

### F-01: MVP data schema and RLS

- **Outcome:** (foundation) All MVP database tables exist in Supabase with correct Row-Level Security policies: user profile, training plans, plan sessions, and session logs. The auth layer can safely write and read user-scoped data before any vertical slice begins.
- **Change ID:** `data-schema-and-rls`
- **PRD refs:** `§Non-Functional Requirements` — "A user's training data — FTP, plan, session history — is never visible to or accessible by any other user account."
- **Unlocks:** S-01 (profile write on onboarding), S-02 (plan + session reads), S-03 (session log writes), S-04 (profile update), S-05 (renewal plan write), S-06 (session history reads), S-07 (session detail reads)
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** An RLS misconfiguration would leak training data across accounts — the hardest PRD privacy guardrail ("never visible to any other user account"). Sequenced first; any mistake here invalidates every downstream slice.
- **Status:** done

## Slices

### S-01: Onboarding wizard

- **Outcome:** User can complete the onboarding wizard — declaring training goal, equipment type, FTP (or a fitness-level estimate via the "I don't know my FTP" path), age, weight, and weekly availability — and see a confirmation/review screen before triggering plan generation. All data persists across browser close.
- **Change ID:** `onboarding-wizard`
- **PRD refs:** FR-001, FR-002, FR-003, US-01
  > *FR-001 (register) and FR-003 (login/logout) are already implemented in the baseline (auth layer present). They appear here because the onboarding flow begins with account creation and login — both must be verified end-to-end as part of this slice.*
- **Prerequisites:** F-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - How should the "I don't know my FTP" path present fitness-level options, and what starting FTP estimate does each option map to? — Owner: product. Block: no (decidable during planning; doesn't gate the slice).
- **Risk:** Onboarding form quality directly determines data quality for AI plan generation. A confusing form leads to wrong equipment type → wrong intensity targets → destroyed trust (PRD guardrail: "intensity targets must match declared equipment exactly"). Sequenced before plan generation so any UX problems are caught before the AI call is layered on top.
- **Status:** done

---

### S-02: First plan generation *(north star)*

- **Outcome:** User can confirm their onboarding inputs and immediately receive an AI-generated 4-week training plan. Every session shows type, duration, and intensity targets adapted to declared equipment: watts for power-meter users, heart-rate zones for HRM users, RPE descriptions for users with no equipment. The plan is presented as a week-overview with session detail accessible per session.
- **Change ID:** `first-plan-generation`
- **PRD refs:** FR-004, FR-005, FR-006, US-01
- **Prerequisites:** S-01
- **Parallel with:** S-04
- **Blockers:** —
- **Unknowns:** _(both resolved in S-02 implementation, 2026-06-13)_
  - ~~What prompt structure reliably produces a correctly structured 4-week plan with equipment-appropriate intensity targets across all three equipment types?~~ **Resolved:** a system+user prompt builder (`src/lib/plan.ts`, versioned via `prompt_version`) carrying the weekday anchor, equipment→target-kind mapping, and duration caps, enforced by a zod + equipment/availability refinement trust boundary, reliably yields valid plans across all three equipment types.
  - ~~Which Anthropic model balances plan quality and latency within "a normal loading wait" (PRD NFR)?~~ **Resolved:** routed via OpenRouter to a config-driven model; `anthropic/claude-sonnet-4.5` verified — cold generation ~22–23s, within the progress-UI-covered wait.
- **Risk:** The riskiest technical bet — the hypothesis that an AI model can map FTP + goal + availability to a correct, equipment-adapted plan — is tested here for the first time. Sequenced as the second slice (immediately after onboarding) so this risk surfaces while the codebase is still small and a course-correction is cheap. A failed plan here is far cheaper to fix than discovering the same failure after session tracking and renewal are built on top.
- **Status:** done

---

### S-03: Session tracking

- **Outcome:** User can mark any session as done — logging actual duration, subjective rating, and km ridden — or as skipped. Status is persisted and reflected in the plan view.
- **Change ID:** `session-tracking`
- **PRD refs:** FR-007, FR-008
- **Prerequisites:** S-02
- **Parallel with:** S-04, S-07
- **Blockers:** —
- **Unknowns:**
  - How should UX copy distinguish "skip" from "defer" to reduce history pollution? (PRD Open Question: "deferred ≠ skipped") — Owner: product. Block: no (copy decision; doesn't block planning, but must be resolved before S-03 ships).
- **Risk:** Low technical risk — straightforward write operation. Main risk is UX: if "skip" is ambiguous, users who want to reschedule will mark sessions skipped, corrupting history data (noted as known v1 limitation in PRD Open Questions).
- **Status:** done

---

### S-04: Profile editing

- **Outcome:** User can edit their profile — training goal, weekly availability, age, and weight — after completing onboarding. Changes are saved immediately. The active plan is not regenerated (FTP editing and plan regeneration are explicitly v2 scope per PRD).
- **Change ID:** `profile-editing`
- **PRD refs:** FR-010
- **Prerequisites:** S-01
- **Parallel with:** S-02, S-03
- **Blockers:** —
- **Unknowns:** —
- **Risk:** PRD explicitly excludes FTP editing from this slice. Risk is shipping a profile screen that visually implies FTP is editable — the interface must clearly communicate that FTP can only be updated at plan renewal.
- **Status:** proposed

---

### S-05: Plan renewal

- **Outcome:** When the 4-week plan expires, user sees a renewal check-in as the first screen on next visit. They can confirm or update their training goal, weekly availability, and — for power-meter users only — current FTP. Confirming immediately generates a new AI-generated 4-week plan reflecting any updated inputs.
- **Change ID:** `plan-renewal`
- **PRD refs:** FR-012, FR-013, US-02
- **Prerequisites:** S-02, S-03
- **Parallel with:** S-06
- **Blockers:** —
- **Unknowns:**
  - How is plan expiry detected — by calendar date (plan start + 28 days) or by session completion count? Date-based is implied by the PRD but not specified. — Owner: product. Block: no (decidable during planning; date-based is the safe default).
- **Risk:** Renewal reuses the AI generation service from S-02; the key correctness risk is that the FTP update field is shown exclusively to power-meter users (PRD US-02 AC). Sequenced after S-03 so the plan-period model — sessions marked done or skipped across 4 weeks — is already in place when the renewal logic needs to detect expiry.
- **Status:** proposed

---

### S-06: Session history *(nice-to-have)*

- **Outcome:** User can view a scrollable list of their completed sessions, each showing date, session type, logged duration, subjective rating, and km ridden.
- **Change ID:** `session-history`
- **PRD refs:** FR-009
- **Prerequisites:** S-03
- **Parallel with:** S-05
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Read-only query over completed sessions; low technical risk. Nice-to-have (secondary success criterion in PRD). **Park first if the 6-week budget is under pressure** — this slice adds polish but does not prove the core hypothesis.
- **Status:** proposed

---

### S-07: Intensity reference *(nice-to-have)*

- **Outcome:** User can tap or expand an inline reference within the session view to see zone definitions (for power-meter and HRM users) or the RPE scale (for no-equipment users).
- **Change ID:** `intensity-reference`
- **PRD refs:** FR-011
- **Prerequisites:** S-02
- **Parallel with:** S-03, S-04
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Static reference content; no technical risk. Nice-to-have added in response to the FR-005 challenge (users new to structured training may not know what Zone 3 means). **Park first if the 6-week budget is under pressure.**
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID             | Suggested issue title                            | Ready for `/10x-plan` | Notes                                    |
| ---------- | --------------------- | ------------------------------------------------ | --------------------- | ---------------------------------------- |
| F-01       | data-schema-and-rls   | Define MVP database schema + RLS policies        | yes                   | Run `/10x-plan data-schema-and-rls`      |
| S-01       | onboarding-wizard     | Build onboarding wizard and confirmation screen  | no                    | Awaits F-01                              |
| S-02       | first-plan-generation | Wire AI plan generation + 4-week plan view       | no                    | Awaits S-01; north star                  |
| S-03       | session-tracking      | Add done/skipped marking + session log           | no                    | Awaits S-02                              |
| S-04       | profile-editing       | Build profile edit screen (goal, availability, age, weight — no FTP) | no | Awaits S-01; parallel with S-02 |
| S-05       | plan-renewal          | Build renewal check-in + new plan generation     | no                    | Awaits S-02 + S-03                       |
| S-06       | session-history       | Build session history list                       | no                    | Awaits S-03; nice-to-have — park if time is tight |
| S-07       | intensity-reference   | Add intensity zone / RPE reference in session view | no                  | Awaits S-02; nice-to-have — park if time is tight |

## Open Roadmap Questions

1. **Deferred ≠ skipped (v1 data quality)** — v1 has only done/skipped session states. Users who want to reschedule a session will mark it skipped, producing inaccurate history. The resolution (move-session) is scoped to v2. Owner: product. Block: S-03 UX copy only — doesn't gate planning, but the copy decision must be made before S-03 ships.

## Parked

- **Strava / Garmin Connect integration** — Why parked: PRD §Non-Goals; manual entry only in v1.
- **Bike garage / service tracking** — Why parked: PRD §Non-Goals; confirmed future feature.
- **Social / sharing features** — Why parked: PRD §Non-Goals; no public profiles in v1.
- **Push / email notifications** — Why parked: PRD §Non-Goals; in-app only.
- **.fit / .gpx file import** — Why parked: PRD §Non-Goals; no ride-file parsing in v1.
- **Seasonal periodisation beyond 4-week blocks** — Why parked: PRD §Non-Goals; renewal generates a fresh 4-week plan, not a cumulative programme.
- **Native mobile app** — Why parked: PRD §Non-Goals; responsive web only in v1.
- **Mid-plan FTP recalculation** — Why parked: PRD §Non-Goals; FTP updatable only at renewal.
- **Session rescheduling (move)** — Why parked: PRD §Non-Goals; done/skipped only in v1.
- **Observability baseline (logging / error tracking)** — Why parked: absent from baseline; no PRD NFR gates on it; with `main_goal: speed` and a 6-week solo after-hours budget, defer until a bug surfaces that requires it.

## Done

- **F-01: (foundation) All MVP database tables exist in Supabase with correct Row-Level Security policies: user profile, training plans, plan sessions, and session logs. The auth layer can safely write and read user-scoped data before any vertical slice begins.** — Archived 2026-06-07 → `context/archive/2026-05-31-data-schema-and-rls/`. Lesson: —.
- **S-01: User can complete the onboarding wizard — declaring training goal, equipment type, FTP (or a fitness-level estimate via the "I don't know my FTP" path), age, weight, and weekly availability — and see a confirmation/review screen before triggering plan generation. All data persists across browser close.** — Archived 2026-06-10 → `context/archive/2026-06-07-onboarding-wizard/`. Lesson: —.
- **S-02: User can confirm their onboarding inputs and immediately receive an AI-generated 4-week training plan. Every session shows type, duration, and intensity targets adapted to declared equipment: watts for power-meter users, heart-rate zones for HRM users, RPE descriptions for users with no equipment. The plan is presented as a week-overview with session detail accessible per session.** — Archived 2026-06-13 → `context/archive/2026-06-10-first-plan-generation/`. Lesson: —.
- **S-03: User can mark any session as done — logging actual duration, subjective rating, and km ridden — or as skipped. Status is persisted and reflected in the plan view.** — Archived 2026-06-15 → `context/archive/2026-06-15-session-tracking/`. Lesson: —.
