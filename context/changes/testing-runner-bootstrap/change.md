---
change_id: testing-runner-bootstrap
title: Runner bootstrap + trust-boundary units
status: implementing
created: 2026-09-06
updated: 2026-09-07
---

## Notes

Test-plan §3 rollout Phase 1 — see `context/foundation/test-plan.md`.

Goal: stand up a unit-test runner on the workerd-targeted stack and prove the AI
trust boundary and equipment mapping reject what they must.

Risks covered by the phase: #1 (semantically wrong AI plan persisted), #3
(intensity target kind vs declared equipment), #6 (server/DB validation parity).

**Research scope (2026-09-06):** Risk **#1 only**, plus test-runner viability on
Astro 6 + Vite 7 + workerd. Risks #3 and #6 get their own research passes
appended to the same `research.md`.
