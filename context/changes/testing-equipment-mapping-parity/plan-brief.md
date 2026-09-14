# Equipment Target-Kind Exclusivity and zod↔DB Parity Units — Plan Brief

> Full plan: `context/changes/testing-equipment-mapping-parity/plan.md`
> Research: `context/changes/testing-equipment-mapping-parity/research.md`

## What & Why

Close rollout Phase 1 of `context/foundation/test-plan.md` §3 by covering its two
remaining risks with unit tests. **Risk #3** — a cyclist sees intensity targets that
do not match their declared equipment (an HRM user shown watts) — has a
four-times-stated oracle and zero test coverage; the archive ticked "a deliberately
mismatched target kind is rejected" manually with no evidence artifact. **Risk #6** —
input the server accepts that the database rejects — has one genuine divergence
(`weight_kg` decimal rounding) and three CHECK constraints upheld only by
hand-written derivation code that was verified once, by reading.

## Starting Point

`testing-runner-bootstrap` shipped the Vitest 4.1.11 runner, two fixture factories,
and 23 assertions covering Risk #1. Risks #3 and #6 share that rollout phase but
fell outside its research scope, so §3 Phase 1 sits at `implementing`. Research
established both oracles and found that Risk #3's render face is safe by construction
(one exhaustive formatter) while its write face is unguarded three ways, and that
Risk #6's premise is inverted on the `profiles` table — zod is *stricter* than the
DB in two places, one of them because a CHECK is dead code.

## Desired End State

`npm test` fails if anyone weakens the equipment→target-kind binding in either
direction, lets the intensity legend drift from the target kind it explains, relaxes
a zod bound away from its DB constraint, or breaks one of the three cross-field
CHECKs in the derivation layer. Test-plan §6.2 carries a real cookbook pattern, §3
Phase 1 reads `complete`, and every finding this change does not test is recorded in
§7 with the question that blocks it.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Production-code scope | Test-only; record, don't fix | Keeps the change reviewable as one thing and leaves a red test waiting for each eventual fix — the pattern the prior change set. | Plan |
| `weight_kg` rounding (B4) | Pin current behaviour | Documents the divergence in executable form at zero risk; the fix turns the test red, which is the signal. | Plan |
| `available_days` DB looseness (B1/B2) | Assert zod as sole enforcer | The layers genuinely disagree, so a "DB and server agree" test would encode a guess; this protects the guard that works and says so. | Plan |
| Risk #3 render face | Legend map only, no DOM layer | `INTENSITY_REFERENCE` is exported and pure, so the one real render-side gap closes at unit cost without a new test layer. | Plan |
| Unguarded `/api/onboarding` (B3) | Record in §7, route to rollout Phase 2 | Not unit-testable (needs auth + Supabase), and a finding with no phase stays a finding — the archive's F6 shows how. | Plan |
| Risk #6 parity breadth | One parameterised table over every bounded field | Full constraint coverage as one readable table; each row catches a distinct regression without twenty-four near-identical tests. | Plan |
| Fixture strategy | Extend, never modify `makeProfile` | Its non-derivation is deliberately documented and 23 assertions depend on today's defaults. | Research |
| Cross-field oracle | Transcribe CHECKs as predicates | Asserting derived fields one by one would restate `toProfileInsert`'s own `switch` — the mirror-implementation anti-pattern. | Research |

## Scope

**In scope:**
- Equipment-variant profile factories (`hrm`, `none`) and `hr_zone` / `rpe` target factories
- Risk #3 exclusivity in both directions across all three equipment types, per-segment isolation, and the `schema`-vs-`equipment_mismatch` code boundary
- Legend↔target-kind agreement across all three equipment types
- zod↔DB bounds parity over six numeric ranges plus the four `available_days` rules
- The three cross-field CHECK truth tables across four `toProfileInsert` branches and both `applyRenewal` paths
- Test-plan §6.2 cookbook, §7 deferred gaps (B1–B8), §3 Phase 1 → `complete`

**Out of scope:**
- Any production change: no zod tightening, no `superRefine`, no route guard, no migration
- DB-parity assertions on `available_days` emptiness or uniqueness (B1/B2 unanswered)
- Any DOM or component test layer; `formatTarget` stays module-private
- The unguarded `POST /api/onboarding` re-POST test and Risk #6's route-level 400 (both Phase 2)
- Read-path revalidation of `plan_sessions.structure` (B8, the archive's SKIPPED F6)
- Zone / %FTP assertions (still blocked on A1–A3) and anything else in the A-series

## Architecture / Approach

Four test surfaces, three of them new files, all pure-function units over in-memory
fixtures:

```
__fixtures__/profile.ts + plan-payload.ts   (extended: hrm/none profiles, hr_zone/rpe targets)
        │
        ├──► plan.test.ts (extend)          Risk #3 validator face — assert THROUGH
        │                                   validateGeneratedPlan; the mapping is module-private
        ├──► intensity-reference.test.ts    Risk #3 legend face — two independent sources
        │                                   bound to one shared target-kind literal
__fixtures__/onboarding-input.ts (new)
        ├──► onboarding-schema.test.ts      Risk #6 bounds — literals traced to the migration,
        │                                   never imported from the schema under test
        └──► onboarding.test.ts             Risk #6 cross-field — CHECKs transcribed from SQL
             renewal.test.ts                as predicates, applied to every derivation branch
```

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Equipment fixture variants | DB-coherent `hrm`/`none` profiles, `hr_zone`/`rpe` targets, coherence guard | A variant missing its companion fields is a row that could not exist — every later assertion is then meaningless |
| 2. Target-kind exclusivity (TDD) | 6 reject cases, per-segment isolation, code boundary, B7 absence assertion | A garbage `kind` returns `schema`, so a careless test passes while asserting a different rule |
| 3. Legend agreement (TDD) | Legend kind/caption per equipment type, key exhaustiveness, hrm row count | Drifting into zone-percentage claims, which are blocked on A1–A3 and must not be fabricated |
| 4. zod↔DB bounds parity (TDD) | Parameterised table over six ranges + `available_days` + `weight_kg` pins | Importing a bound from the schema under test makes every row pass by construction |
| 5. Cross-field CHECK tables (TDD) | Three SQL-transcribed predicates × four derivation branches, plus renewal | Restating `toProfileInsert`'s `switch` instead of the CHECK text; `IS NOT DISTINCT FROM` null semantics |
| 6. Cookbook and recording | §6.2 written, §7 B-series entries, §3 Phase 1 `complete`, B3 routed | A finding recorded without a re-evaluation trigger becomes a forgotten one |

**Prerequisites:** none beyond what is on disk — the runner, both fixture factories,
and §6.1's conventions all shipped with `testing-runner-bootstrap`.
**Estimated effort:** ~2 sessions across 6 phases; phases 2–5 are the substance,
phase 1 is small but gates everything, phase 6 is documentation.

## Open Risks & Assumptions

- **Pinning tests age deliberately.** The `weight_kg` (B4) and renewal-discard (B5)
  characterizations are designed to turn red when those decisions are made. Someone
  seeing red must read the comment, not "fix" the test.
- **B1/B2 stay unanswered.** Until the dead CHECK is repaired or accepted, no
  `available_days` parity claim is possible — only sole-enforcement claims.
- **The legend agreement is a literal table, not a derived one.** Because
  `EQUIPMENT_TARGET_KIND` is module-private, phases 2 and 3 hold the same three
  literals in two files; both must cite the same oracle line or they can drift apart.
- **B3 is the one finding with a security dimension** and nothing catches it until
  Phase 2 of the rollout lands.
- **Assumes the applied remote migration matches the file on disk.** The bounds
  oracle is read from `init_mvp_schema.sql`; no local stack exists to verify against.

## Success Criteria (Summary)

- An HRM cyclist's plan carrying watt targets is rejected — and so is a power-meter
  cyclist's plan carrying RPE, and a no-equipment cyclist's plan carrying HR zones —
  with `equipment_mismatch` and nothing else.
- The legend a cyclist reads always explains the unit their targets are actually in.
- Every value the database would reject on a bounded field is rejected by the server
  first, and every derivation path produces a row that satisfies all three
  cross-field CHECKs.
- §3 Phase 1 reads `complete`, and every gap left open is findable in §7 with the
  question that blocks it.
