# Runner Bootstrap + Risk #1 Trust-Boundary Units — Plan Brief

> Full plan: `context/changes/testing-runner-bootstrap/plan.md`
> Research: `context/changes/testing-runner-bootstrap/research.md`

## What & Why

Stand up the repo's first test runner on the Astro 6 / Vite 7 / workerd stack,
and use it to pin the clauses of Risk #1 that have a defensible oracle:
generated training plans must never schedule sessions on days the cyclist did
not declare, never exceed their declared duration caps, and must be **rejected
whole rather than quietly repaired**. Risk #1 is rated High × High and is the
top row of the risk map; today nothing but manual verification protects it.

## Starting Point

Zero tests, zero runner — all eight archived slices record manual verification
only, and the gate is `lint` + `build`. Research established that two of Risk
#1's three clauses are **already enforced** by `validateGeneratedPlan`
(`src/lib/plan.ts:66`), which rejects whole payloads with no clamping and no
writes before validation. The third clause — zone percentages — is not enforced
*and has no oracle in any specification source*: watt targets carry no zone
field, so the named failure cannot occur as specified.

## Desired End State

`npm test` runs locally and in CI, between `lint` and `build`. Deleting the
availability guardrail, swapping the duration caps, or switching `.safeParse`
to `.parse` each turns the suite red. Test-plan §6.1 carries a real cookbook
pattern instead of a TBD, and the three gaps research surfaced are recorded as
deliberate negative space with re-evaluation triggers rather than living only
in a research document.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Test layer for Risk #1 | Unit, over fixture payloads | `structure` is opaque JSONB, so integration would verify strictly *less* | Research |
| Runner | `vitest@^4.1.11`, standalone config | Vitest 5 forecloses `@cloudflare/vitest-plugin` (peers `^4.1.0`) for Phases 2–4 | Plan |
| Astro's `getViteConfig()` | **Not used** | Broken on this exact pin; the fix postdates `astro@6.3.1` — verified in `node_modules` | Research |
| Zone clause (A1–A3) | Defer, record the gap | No oracle exists; asserting an invented rule is the anti-pattern the lesson forbids | Plan |
| Weekend-cap dead zone (A6) | Test the reachable range | Fixtures under 360 min so the branch actually fires; contradiction recorded | Plan |
| One-session-plan defect (A4/A5) | Record, don't fix | A minimum-session rule is stated by no source; needs a product answer first | Plan |
| Production code changes | None | This is a test bootstrap; every defect found is recorded, not fixed | Plan |
| Execution mode | Mixed per phase | Phases 3–5 have a nameable first red test; setup and docs do not | Plan |

## Scope

**In scope:** Vitest install and config; fixture factories for the 15-field
`Profile` row and generated payloads; tests for availability containment,
duration caps, segment sums, and reject-don't-repair; CI gate; test-plan §6.1
cookbook and §7 deferred gaps.

**Out of scope:** any production code change; zone/%FTP validation; a
minimum-session or coverage rule; the 600-vs-360 contradiction; Risk #3
(`equipment_mismatch`) and Risk #6 (zod↔DB parity), which share this rollout
phase but were outside the research scope; the unlogged-`issues` diagnosability
gap; `astro:env` shims, workerd pool, coverage thresholds, Stryker.

## Architecture / Approach

Bootstrap → validate the bootstrap with a real smoke test → factories → three
test groups → record. `src/lib/plan.ts` has zero runtime imports, so tests
import it directly with no `astro:env` shim and no workerd. Every expected value
traces to a specification source (PRD business rules, or the S-02 plan's
contracted guardrails) rather than to the validator, so a bug in the validator
cannot be mirrored into a passing test.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Runner bootstrap | Vitest + config + CI gate + smoke test | The config is reasoned from sources but **never executed** — this is the plan's one real unknown |
| 2. Fixture factories | `makeProfile` / `makePlanPayload` with overrides | Incoherent defaults would make later tests pass for the wrong reason |
| 3. Availability containment | Undeclared-day rejection; Monday anchor across 4 weeks | Computing expected weekdays with the code under test (mirror-testing) |
| 4. Duration caps | Boundary + cap-selection-by-day-type + segment sums | A weekend fixture ≥360 makes the test pass via an unrelated schema error |
| 5. Rejection semantics | Whole-plan rejection, no clamping, issue accumulation | Asserting message text instead of issue codes |
| 6. Cookbook + gaps | §6.1 pattern, §3 status, §7 deferred entries | Recording exclusions without re-evaluation triggers |

**Prerequisites:** none — first item in the rollout.
**Estimated effort:** ~2–3 sessions across six phases.

## Open Risks & Assumptions

- **The Vitest config has not been run.** Research verified versions, peer
  ranges, and the `getViteConfig()` breakage against primary sources and an
  esbuild resolution proof, but executed no test. Phase 1 exists to falsify it.
- **Risk #1 is not closed by this plan.** Its zone clause stays open, blocked on
  a product decision. Rollout §3 Phase 5 therefore cannot be marked "skip" —
  but the residue is a *missing deterministic rule*, not the AI-judgment problem
  Phase 5 was designed for, so Phase 5 should not absorb it.
- **A known defect ships.** A one-session plan remains a valid "4-week plan".
  Deliberate: the fix needs an answer on day coverage (A4/A5) first.
- Vitest 5 released 2026-09-03; pinning 4.1.x is a considered trade for
  workerd-pool compatibility, not an oversight.
- Stryker's Vitest 4 compatibility is unverified — mutation testing is not in
  this plan.

## Success Criteria (Summary)

- A cyclist can never be handed a plan scheduling sessions on days they did not
  declare, or exceeding their declared caps, without CI going red first.
- Removing any of the three guardrails turns the suite red — verified by hand,
  not assumed.
- The next contributor can add a unit test by reading §6.1, and can see which
  gaps were deferred on purpose and what would reopen them.
