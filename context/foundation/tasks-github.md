---
project: WattWise
version: 1
status: active
created: 2026-05-31
updated: 2026-05-31
source: context/foundation/roadmap.md
---

# GitHub Issues & Project Board — WattWise

> Created in a single session on 2026-05-31.
> All 8 roadmap items from `context/foundation/roadmap.md` are now tracked as GitHub issues in `DmiE/WattWise`.
> Source of truth for task status: **GitHub Issues** (this file is a reference/audit trail, not the live tracker).

---

## Repository

`DmiE/WattWise` — https://github.com/DmiE/WattWise

---

## GitHub Project Board

**Name:** WattWise MVP  
**URL:** https://github.com/users/DmiE/projects/1  
**Type:** GitHub Projects v2 (user-level project)  
**Columns (default Status field):** Todo / In Progress / Done  
**Items:** All 8 issues added on creation; all start in **Todo**.

---

## Labels Created

Ten custom labels were added to the repo. Default GitHub labels (bug, enhancement, etc.) were left in place.

| Label | Hex colour | Purpose |
|---|---|---|
| `foundation` | `#0052cc` | F-XX enabler items — horizontal work that unlocks vertical slices |
| `slice` | `#bfd4f2` | S-XX user-visible vertical slices |
| `north-star` | `#e99695` | The core hypothesis slice (S-02) — highest priority |
| `nice-to-have` | `#c5def5` | Park first if the 6-week budget is tight (S-06, S-07) |
| `stream:A` | `#d4edda` | Stream A: Schema & north star critical path |
| `stream:B` | `#fff3cd` | Stream B: Session loop (downstream of north star) |
| `stream:C` | `#fde8e8` | Stream C: Profile (parallel track from S-01 onward) |
| `stream:D` | `#e2d9f3` | Stream D: Nice-to-have polish |
| `status:ready` | `#0e8a16` | Unblocked; prerequisites met; ready to start |
| `status:proposed` | `#d0d0d0` | Blocked on one or more prerequisites |

---

## Issues

Created in dependency order so that cross-reference `#N` links could be embedded on creation. Issue numbers are stable — GitHub assigned them sequentially starting at #1.

| GitHub # | Roadmap ID | Change ID | Title | Labels | URL |
|---|---|---|---|---|---|
| #1 | F-01 | `data-schema-and-rls` | Define MVP database schema + RLS policies | `foundation` `stream:A` `status:ready` | https://github.com/DmiE/WattWise/issues/1 |
| #2 | S-01 | `onboarding-wizard` | Build onboarding wizard and confirmation screen | `slice` `stream:A` `status:proposed` | https://github.com/DmiE/WattWise/issues/2 |
| #3 | S-02 ⭐ | `first-plan-generation` | Wire AI plan generation + 4-week plan view | `slice` `north-star` `stream:A` `stream:B` `status:proposed` | https://github.com/DmiE/WattWise/issues/3 |
| #4 | S-04 | `profile-editing` | Build profile edit screen (goal, availability, age, weight) | `slice` `stream:C` `status:proposed` | https://github.com/DmiE/WattWise/issues/4 |
| #5 | S-03 | `session-tracking` | Add done/skipped marking + session log | `slice` `stream:B` `status:proposed` | https://github.com/DmiE/WattWise/issues/5 |
| #6 | S-07 | `intensity-reference` | Add intensity zone / RPE reference in session view | `slice` `nice-to-have` `stream:D` `status:proposed` | https://github.com/DmiE/WattWise/issues/6 |
| #7 | S-05 | `plan-renewal` | Build renewal check-in + new plan generation | `slice` `stream:B` `status:proposed` | https://github.com/DmiE/WattWise/issues/7 |
| #8 | S-06 | `session-history` | Build session history list | `slice` `nice-to-have` `stream:D` `status:proposed` | https://github.com/DmiE/WattWise/issues/8 |

### Issue body structure

Every issue was written with the following sections, sourced verbatim from `roadmap.md`:

```
> Change ID | Stream | Roadmap ID

## Outcome         — verbatim from roadmap
## PRD Refs        — verbatim from roadmap
## Prerequisites   — live #N cross-references to blocking issues
## Parallel With   — live #N cross-references (where applicable)
## Risk            — verbatim from roadmap
## Unknowns        — verbatim from roadmap (or "None")
## Acceptance Criteria — 4–5 testable bullets derived from the Outcome
```

Nice-to-have issues (#6, #8) include a prominent ⚠️ warning at the top of their body.

---

## Dependency Graph (issue numbers)

```
#1 (F-01) ──► #2 (S-01) ──► #3 (S-02) ──► #5 (S-03) ──► #7 (S-05)
                    │               │               │
                    ▼               ▼               ▼
                  #4 (S-04)       #6 (S-07)       #8 (S-06)
```

Stream A critical path to north star: **#1 → #2 → #3**

---

## Workflow Conventions

### Starting a slice

1. Move the issue card to **In Progress** on the project board.
2. Flip the label from `status:proposed` → `status:ready` (signals the item is actively being worked).
3. Create a `context/changes/<change-id>/` folder with `/10x-plan <change-id>`.
4. Reference the issue in every commit message and PR: `Closes #N`.

### Finishing a slice

1. Merge the PR — GitHub auto-closes the issue if `Closes #N` is in the PR body.
2. The project board moves the card to **Done** automatically on close.
3. For each issue that had this slice as a prerequisite, flip its label from `status:proposed` → `status:ready`.
4. Run `/10x-archive <change-id>` to update `roadmap.md` (sets `Status: done`).

### Filtering tips

```bash
# What can I start right now?
gh issue list --label "status:ready"

# What's on the critical path?
gh issue list --label "stream:A"

# What should I park if time is tight?
gh issue list --label "nice-to-have"

# Where is the north star?
gh issue list --label "north-star"
```

---

## Implementation Notes

### `gh` CLI auth scope

Creating the GitHub Projects v2 board requires the `project` and `read:project` OAuth scopes, which are not included in the default `gh auth login` token. The scope was added via:

```bash
gh auth refresh -s project,read:project
```

This is a one-time operation per machine. Required any time you need to create or manage Projects v2 programmatically.

### Issue creation order

Issues were created in strict dependency order (#1 first) so that all `#N` prerequisite cross-links could be embedded at creation time, without a subsequent edit pass.

### What was NOT created

- **Milestones** — skipped in favour of `stream:X` labels, which carry the same grouping information with less overhead for a solo project.
- **Issue templates** — skipped; the consistent body structure is documented above and enforced by convention rather than a template file.
- **PR-to-issue automation** — standard GitHub behaviour (`Closes #N` in PR body) is sufficient; no extra Actions were added.
