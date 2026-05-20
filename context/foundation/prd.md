---
project: WattWise
version: 1
status: draft
created: 2026-05-20
context_type: greenfield
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 6
  hard_deadline: null
  after_hours_only: true
---

## Vision & Problem Statement

An amateur road cyclist who already knows their FTP sits down to plan their training week and has no way to turn that number — plus their available hours and their goal — into today's specific session: type, duration, and exact watts or heart-rate zone. Apps like Strava and Garmin Connect track what you rode last time but don't prescribe what to ride next or how hard. Generic online plans exist but don't adapt to the cyclist's actual fitness or schedule.

The insight: Strava and TrainingPeaks don't generate a plan — they analyse the past. WattWise closes the gap by being prescriptive: given what the cyclist knows about themselves, it produces the next action with the precision a power meter or heart-rate monitor can verify.

## User & Persona

**Primary persona: the self-coached hobbyist road cyclist**

A recreational or amateur-competitive road cyclist who rides 3–5 times per week, has done at least one FTP test, and owns a power meter or heart-rate monitor. They want structured training — the kind a coach would prescribe — without the cost or commitment of hiring one. They have a goal (build endurance, get faster for a Gran Fondo, maintain fitness), a rough weekly availability, and a number: their FTP. What they lack is the step that converts those three inputs into a plan they can follow on the bike today.

## Success Criteria

### Primary
A cyclist completes onboarding and receives a 4-week training plan whose sessions contain correct intensity targets for their declared equipment — watts for power-meter users, heart-rate zones for HRM users, RPE descriptions for users with no equipment. Plan generation requires no additional configuration beyond the onboarding flow. When the plan period ends, the cyclist is prompted with a renewal check-in and receives a new 4-week plan.

### Secondary
Completed sessions are viewable in a session history list — the user can scroll back through what they've done, confirming that the data persists and feels like a real training log.

### Guardrails
- Intensity targets must match declared equipment exactly. A power-meter user never sees RPE; a user with no equipment never sees watts. Incorrect values destroy trust.
- Onboarding answers must survive a browser close and return — the user is never asked to re-enter data they already submitted.

## User Stories

### US-01: Cyclist receives their first training plan

- **Given** a new user who has just completed the onboarding flow (declared goal, equipment type, FTP, and weekly availability)
- **When** they reach the end of the onboarding wizard
- **Then** they see a 4-week training plan with at least one session scheduled for the current week, each session showing type, duration, and intensity targets matching their declared equipment (watts / heart-rate zones / RPE)

#### Acceptance Criteria
- A power-meter user sees watt targets on every interval session
- An HRM-only user sees heart-rate zone targets, never watts
- A no-equipment user sees RPE descriptions only
- A confirmation/review screen is shown after onboarding completes, allowing the cyclist to check their inputs before plan generation triggers
- Plan is visible immediately after the cyclist confirms their inputs

### US-02: Cyclist renews their plan after 4 weeks

- **Given** a cyclist whose 4-week plan has ended
- **When** they open the app after the plan period expires
- **Then** they are shown a renewal check-in asking whether their training goal, weekly availability, or (if they use a power meter) FTP has changed

#### Acceptance Criteria
- The check-in screen is the first thing shown when the plan has expired — not a notification, not an email
- Power-meter users see an FTP field; HRM and no-equipment users do not
- Confirming the check-in (with or without changes) immediately triggers generation of a new 4-week plan
- The new plan reflects any values the cyclist updated in the check-in

## Functional Requirements

### Onboarding & Profile
- FR-001: Cyclist can register with email and password. Priority: must-have
  > Socrates: Counter-argument considered: "OAuth/passwordless reduces sign-up friction." Resolution: kept; email+password is the simplest full-ownership auth for a hobby app with no social sign-in requirement.
- FR-002: Cyclist can complete onboarding (age, weight, goal, equipment type, FTP or estimated value via "I don't know my FTP" path that assigns a fitness-level estimate, weekly availability). Priority: must-have
  > Socrates: Counter-argument considered: "FTP is niche knowledge — requiring it blocks casual cyclists." Resolution: updated; onboarding now includes an explicit "I don't know my FTP" path. App assigns a starting estimate from fitness level input.
- FR-003: Cyclist can log in and out. Priority: must-have
  > Socrates: Counter-argument considered: "Logout is implicit from session expiry." Resolution: kept; an explicit logout action is a baseline usability expectation, especially on shared devices.
- FR-010: Cyclist can edit their profile (age, weight, availability, goal) after completing onboarding. Priority: must-have
  > Socrates: Counter-argument considered: "Editing FTP without regenerating the plan is misleading." Resolution: narrowed; FR-010 covers profile-only fields that do not affect the current plan. FTP editing and plan regeneration are scoped to v2.

### Plan
- FR-004: Cyclist can receive an AI-generated 4-week training plan after reviewing and confirming their onboarding inputs. Priority: must-have
  > Socrates: Counter-argument considered: "Immediate generation on onboarding locks in any input mistakes." Resolution: updated; a confirmation/review step is added before generation triggers. Captured as Acceptance Criteria in US-01 rather than a separate FR.
- FR-005: Cyclist can view each session's type, duration, and intensity targets adapted to their declared equipment (watts for power meter, heart-rate zones for HRM, RPE for no equipment). Priority: must-have
  > Socrates: Counter-argument considered: "Without a zone reference, users won't know what Zone 3 means." Resolution: gap acknowledged; added FR-011 (nice-to-have) for an in-session intensity reference.
- FR-006: Cyclist can view a week-overview of their full 4-week plan. Priority: must-have
  > Socrates: Counter-argument considered: "A second UI surface doubles design and maintenance work in v1." Resolution: kept; a plan overview is core to the weekly-structure promise of the product.

### Session Tracking
- FR-007: Cyclist can mark any session as done or skipped. Priority: must-have
  > Socrates: Counter-argument considered: "Two states miss the defer case — users who want to reschedule will mark skipped, polluting history." Resolution: kept as-is; move-session is explicitly v2. Known limitation recorded in Open Questions: "deferred ≠ skipped" data quality.
- FR-008: On marking done, cyclist can log actual duration, subjective rating, and km ridden. Priority: must-have
  > Socrates: Counter-argument considered: "Bike selector implies a 'manage bikes' capability that has no FR." Resolution: bike field removed from done flow entirely. Bike management and km-per-bike tracking land in v2 with the garage feature.

### History
- FR-009: Cyclist can view a list of their completed sessions. Priority: nice-to-have
  > Socrates: Counter-argument considered: "History adds query, view, and pagination logic for no direct training benefit in v1." Resolution: kept as nice-to-have; it was the chosen secondary success criterion. Ships if time allows.

### Plan Renewal
- FR-012: When the 4-week plan period ends, cyclist is shown a renewal check-in prompting them to confirm or update: training goal, weekly availability, and (for power-meter users only) current FTP. Priority: must-have
- FR-013: After completing the renewal check-in, cyclist receives a new AI-generated 4-week plan reflecting any updated inputs. Priority: must-have

### Reference
- FR-011: Cyclist can see a brief reference for intensity targets (zone definitions / RPE scale) within the session view. Priority: nice-to-have
  > Socrates: Added in response to FR-005 challenge. Zone reference is not required to ride the session but reduces confusion for users new to structured training.

## Non-Functional Requirements

- The user receives continuous visible feedback while plan generation is in progress; generation completes within a duration the cyclist perceives as a normal loading wait — not a frozen screen.
- The product is fully usable on a mobile browser (latest two major versions of iOS Safari and Android Chrome) without requiring a native app installation.
- A user's training data — FTP, plan, session history — is never visible to or accessible by any other user account.
- The product functions correctly on the two most recent major versions of Chrome, Firefox, Safari, and Edge.

## Business Logic

A personalised training plan — session type, duration, and intensity targets — is generated from three user-supplied inputs: FTP (or fitness-level estimate), training goal, and weekly availability.

**Inputs the rule consumes**: FTP in watts (or an estimated equivalent derived from the user's self-reported fitness level when FTP is unknown), training goal (one of three: fitness & health / endurance / speed & racing), and weekly availability (number of days, which days, max session duration on workdays and weekends).

**What the rule produces**: a 4-week sequence of sessions, each with a session type (intervals, endurance, recovery), a duration, and intensity targets. Intensity targets are expressed in standard training zones mapped from FTP (e.g. Zone 2 = 56–75% FTP, Zone 4 = 91–105% FTP). The output format adapts to declared equipment: watts for power-meter users, heart-rate zones for HRM users, RPE descriptions for users with no equipment.

**How the cyclist encounters it**: immediately after confirming their onboarding inputs, the plan appears as a week-view with sessions slotted to their available days. The rule runs at onboarding and again at each 4-week renewal check-in. It does not re-run mid-plan on session completion in v1 — plan adaptation within an active plan is v2.

## Access Control

Email + password registration and login. Flat user model — every account is a cyclist; no admin or coach roles in MVP. An unauthenticated visitor sees only the marketing/landing page; all plan and profile data is behind the login wall. No social/OAuth in MVP.

## Non-Goals

- **No Strava / Garmin Connect integration**: no importing ride history or syncing completed sessions to external platforms; manual entry only in v1. Integration planned as a subsequent milestone.
- **No bike garage / service tracking module**: component counters, service logs, and issue notes are out of v1 scope. Garage is a confirmed future feature.
- **No social or sharing features**: no plan sharing, no comparison with other cyclists, no public profiles in v1.
- **No push or email notifications**: no reminders sent outside the app; in-app alerts only. Users must open WattWise to see anything.
- **No .fit / .gpx file import or analysis**: data enters only through manual session completion. No ride file parsing from Garmin, Wahoo, or similar devices.
- **No planning horizon beyond 4 weeks per block**: each plan covers 4 weeks; no 8-week or seasonal periodisation across blocks. Renewal generates a fresh 4-week plan, not a cumulative long-term programme.
- **No native mobile app**: v1 is responsive web only; iOS and Android native apps are a future milestone.
- **No mid-plan FTP recalculation**: FTP can only be updated at plan renewal (FR-012), not during an active plan. Mid-plan plan adaptation is v2.
- **No session rescheduling (move)**: sessions can only be marked done or skipped in v1. Move-session is v2.

## Open Questions

1. **Deferred ≠ skipped (v1 data quality)**: v1 has only done/skipped session states. Users who want to reschedule a session will mark it skipped, producing inaccurate history data. Move-session (the resolution) is scoped to v2. Owner: product. No hard deadline — but should be surfaced in UX copy ("skip = won't do this session").
