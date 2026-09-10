---
change_id: testing-equipment-mapping-parity
title: Equipment target-kind exclusivity and zod↔DB parity units
status: implemented
created: 2026-09-07
updated: 2026-09-09
archived_at: null
---

## Notes

Second change under test-plan §3 rollout **Phase 1**. The first,
`testing-runner-bootstrap`, is `implemented` — it shipped the Vitest 4.1.11
runner, fixture factories, and Risk #1 units. This change closes the rest of
that rollout phase; §3 Phase 1 reaches `complete` only when it does.

**Risks covered** (test-plan §2):

- **#3** — a cyclist sees intensity targets that do not match their declared
  equipment: an HRM user shown watts, a power-meter user shown RPE.
- **#6** — onboarding or renewal input is accepted by the server that the
  database rejects: an opaque error, or a profile stored in a shape the plan
  generator cannot interpret.

Test types planned: **unit**.

**Risk response intent** (test-plan §2 Risk Response Guidance):

- **#3** — prove a power-meter profile yields watt targets and never HR or RPE;
  an HRM profile yields HR zones and never watts; a no-equipment profile yields
  RPE only. Exclusivity asserted in **both** directions: "we render the right
  thing" is not the same claim as "we never render the wrong thing", and
  absence is the assertion that matters. Anti-pattern to avoid: asserting only
  the presence of the correct target, which a bug adding watts alongside HR
  zones would pass.
- **#6** — prove every value the database would reject is rejected by the
  server first with an actionable error, and every value the product considers
  valid is accepted. Anti-pattern to avoid: copying expected boundaries out of
  the validation schema — the oracle must be the DB constraint set in the
  applied migration, read independently.

**Reuse, do not re-bootstrap.** The runner, `src/lib/__fixtures__/profile.ts`,
`src/lib/__fixtures__/plan-payload.ts`, and the conventions written up in
test-plan §6.1 all exist. Note `makeProfile`'s docblock warning: overriding
`equipment_type` alone leaves `ftp_watts` / `ftp_source` set, so a DB-coherent
`hrm` or `none` profile must pass those explicitly — directly relevant to #3,
which needs all three equipment types.

**Research is required first.** Risks #3 and #6 were explicitly outside
`testing-runner-bootstrap`'s research scope, so no oracle has been established
for either. Per the lesson chain, research produces the oracle from sources
before any test asserts on them.

## Outcome (2026-09-09)

Implemented across six phases. **Rollout §3 Phase 1 is now `complete`** — this
was the change it was waiting on.

Risks #3 and #6 are both covered by unit tests, and no production code changed:
every defect research surfaced is recorded in test-plan §7 with the question
that blocks it, and where current behaviour is a known divergence a test pins
it so the eventual fix meets a red test. The suite stands at 120 assertions
across `plan.test.ts`, `intensity-reference.test.ts`,
`onboarding-schema.test.ts`, `onboarding.test.ts`, `renewal.test.ts`, and the
fixture coherence guard. Test-plan §6.2 carries the patterns this change
established (equipment-variant factories, both-directions exclusivity with
exact-equality issue codes, the valid-wrong-kind requirement, legend agreement
via one shared literal, migration-traced parity bounds, and predicate
transcription for cross-field CHECKs).

**Open questions carried forward**, all recorded in test-plan §7:

- **B1/B2** — `available_days`: the dead `array_length` CHECK and the absent
  day-uniqueness constraint. Tests assert zod as sole enforcer.
- **B3** — the unguarded `POST /api/onboarding` re-POST. The only finding with
  a security dimension; routed to §3 Phase 2, which owns the endpoint layer.
- **B4** — `weight_kg` `numeric(5,2)` rounding before the CHECK; pinned, not
  fixed, with the `km_ridden` precedent cited.
- **B5** — renewal's silent discard of `ftp_watts` from non-power-meter users.
- **B6** — `max_hr` has no update path outside re-onboarding.
- **B7** — whether `plan-schema.ts` should enforce one target kind per plan
  independently of the profile.
- **B8** — read-path revalidation of `plan_sessions.structure` (the archive's
  F6, now deferred a second time).

The A-series (A1–A9, from `testing-runner-bootstrap`) remains open and was not
re-litigated.
