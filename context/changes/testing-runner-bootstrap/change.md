---
change_id: testing-runner-bootstrap
title: Runner bootstrap + trust-boundary units
status: implemented
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

**Outcome (2026-09-07).** All six plan phases landed: a Vitest 4.1.11 runner on
a standalone config (Astro's `getViteConfig()` is broken on this pin —
withastro/astro#15878), fixture factories, and 23 unit tests pinning Risk #1's
two testable clauses plus the reject-don't-repair contract. No production code
changed. Cookbook §6.1, rollout §3/§4, and the deferred gaps in §7/§7.1 of
`context/foundation/test-plan.md` are updated.

**Still open within this rollout phase:** Risks **#3** (intensity target kind
vs declared equipment) and **#6** (zod↔DB parity) are untested — they share
rollout Phase 1 but fell outside this change's research scope and each needs
its own research pass first. Risk #1 is narrowed, not closed: the zone/%FTP
clause is blocked on research A1–A3 and plan completeness on A4/A5, both
recorded in test-plan §7 with re-evaluation triggers. Test-plan §3 Phase 1
therefore reads `implementing`, not `complete`.
