---
change_id: plan-renewal
title: Plan renewal — expiry check-in and new AI plan generation
status: implementing
created: 2026-06-18
updated: 2026-06-18
archived_at: null
---

## Notes

Roadmap slice S-05 (Stream B — closes the core training loop). When the 4-week
plan expires, the user sees a renewal check-in as the first screen on next
visit. They can confirm or update their training goal, weekly availability, and
— for power-meter users only — current FTP. Confirming immediately generates a
new AI-generated 4-week plan reflecting any updated inputs.

- PRD refs: FR-012, FR-013, US-02
- Prerequisites: S-02 (first-plan-generation), S-03 (session-tracking) — both done
- Reuses the AI generation service from S-02.
- Correctness risk: the FTP update field must be shown exclusively to power-meter users (US-02 AC).
- Open unknown (non-blocking): how is plan expiry detected — calendar date (plan start + 28 days) or session-completion count? Date-based is the safe default implied by the PRD.
