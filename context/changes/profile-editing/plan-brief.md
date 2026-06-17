# Profile Editing — Plan Brief

> Full plan: `context/changes/profile-editing/plan.md`

## What & Why

Roadmap slice S-04 (PRD FR-010): let an onboarded cyclist edit their training goal, age, weight, and weekly availability after onboarding. WattWise currently captures these only once, during onboarding, with no way to correct or update them. This closes that gap without touching the riskier FTP/plan-regeneration surface (explicitly v2).

## Starting Point

The `profiles` table and all six editable columns already exist with DB CHECK constraints. The exact field group is already validated by the `commonFields` zod object in `src/lib/onboarding-schema.ts`, the write path exists (`upsertProfile`/`getProfile` in `src/lib/services/profile.ts`), and the onboarding route + wizard establish the API and form conventions to mirror. Nothing here is greenfield — it's a focused reuse of existing shapes.

## Desired End State

A "Profile" link in the dashboard header opens `/profile`, where the four editable areas are pre-filled and saved with one Save click. Equipment + FTP (or fitness level) show read-only with "FTP can only be updated at plan renewal." The active plan is never regenerated; edits apply at next renewal.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Location / entry | Dedicated `/profile` page + dashboard header link | Mirrors `/onboarding` page+island pattern; room for all fields; clean URL | Plan |
| Fixed fields (FTP/equipment) | Show read-only with renewal note | Defuses the named "implies FTP is editable" risk while keeping current values visible | Plan |
| Save UX | Single Save button, dirty-flag gated | Matches onboarding submit model; atomic validation; simple write path | Plan |
| API shape | Full 6-field body, reused `commonFields` schema | One DB-synced zod pass; no merge logic; equipment columns untouched | Plan |
| Plan drift on availability change | Save silently + "applies at next renewal" note | Honors PRD no-mid-plan-regen; sets expectations; zero extra logic | Plan |

## Scope

**In scope:** edit goal, age, weight, available_days, max_workday_minutes, max_weekend_minutes; `PATCH /api/profile`; `/profile` page + form; dashboard entry link; read-only display of fixed fields.

**Out of scope:** editing FTP/equipment/fitness-level/max-HR; plan regeneration; autosave; confirm dialogs; localStorage draft; nav/Topbar refactor; schema migration.

## Architecture / Approach

`profileEditSchema` = exported `commonFields` shape. `PATCH /api/profile` (auth → validate → `updateProfileFields` updating only the six columns scoped to `user_id` under RLS, no derivation). `profile.astro` server-fetches the row and passes it as a prop to a `ProfileForm` React island (plain `useState` + touched tracking, like the wizard), which saves via the endpoint. Because the update set excludes every column in the equipment/FTP CHECK constraints, a partial column update is always constraint-safe.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema + PATCH API | Reusable edit schema, `updateProfileFields`, `PATCH /api/profile` | Accidentally routing through full-row upsert and tripping equipment CHECKs |
| 2. Page + form + entry | `/profile` page, `ProfileForm`, dashboard link, route protection | UI implying FTP/equipment are editable |

**Prerequisites:** S-01 (done) — profile schema + onboarding patterns in place.
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- The current plan can briefly mismatch newly-edited availability/goal — an accepted v1 limitation, surfaced to the user via an inline note.
- Assumes only onboarded users reach `/profile` (enforced via middleware + a null-profile redirect to `/onboarding`).

## Success Criteria (Summary)

- User edits any of goal/age/weight/availability and the change round-trips after reload.
- FTP/equipment are visibly non-editable with a renewal note; correct field shown per equipment type.
- Editing availability/goal leaves the active plan unchanged.
