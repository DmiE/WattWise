# Runner Bootstrap + Risk #1 Trust-Boundary Units — Implementation Plan

## Overview

Stand up a unit-test runner on this project's Astro 6 / Vite 7 / workerd-targeted
stack — the first test infrastructure the repo has ever had — and use it to pin
the two clauses of Risk #1 that have a defensible oracle: **availability
containment** and **duration caps**. Add a third group of tests for the
architectural property that makes those two trustworthy: `validateGeneratedPlan`
**rejects whole plans and never repairs them**.

This is rollout Phase 1 of `context/foundation/test-plan.md` §3, scoped to
**Risk #1 only**. Risks #3 and #6 share the phase but were outside the research
scope and get their own research pass.

## Current State Analysis

- **Zero tests, zero runner.** All eight archived slices record manual
  verification only. The current gate is `npm run lint` + `npm run build`
  (`.github/workflows/ci.yml`).
- **The code under test is trivially testable.** `src/lib/plan.ts` has zero
  runtime imports — only `import type` (`:1-2`) plus `planSchema` (`:3`). No
  `astro:env` shim is needed; verified empirically during research by bundling
  all ten candidate `src/lib` modules with only the `@` alias.
- **Two of Risk #1's three clauses are already enforced.** `unavailable_day`
  (`plan.ts:90-96`) and `duration_over_cap` (`plan.ts:98-104`) both reject.
  Research confirmed there is **no repair, clamp, or session-dropping logic
  anywhere in the plan pipeline**, and no DB write happens before validation.
- **The third clause is blocked, not merely unimplemented.** `ftp_watts` is
  never read by the validator; the `watts` target shape carries no zone field
  (`plan-schema.ts:21-25`), so "zone percentages that do not match the named
  zone" cannot occur as specified for power-meter users. No source states the
  rule — see research Open Questions A1–A3.
- **`Profile` is the full 15-field DB `Row`** (`src/types.ts:14`), so every
  test needs a fixture factory rather than inline literals.
- **Test files will be linted and type-checked immediately.** `tsconfig.json`
  includes `**/*`; `eslint.config.js` runs `strictTypeChecked` +
  `stylisticTypeChecked` with `projectService: true`. Test files must also
  compile under `astro build` via `@astrojs/check`.

## Desired End State

`npm test` runs a Vitest suite locally and in CI. The suite fails if anyone
weakens the availability guardrail, the duration-cap guardrail, the segment-sum
check, or the reject-don't-repair contract. Test-plan §6.1 carries a real
cookbook pattern instead of a TBD, §3 Phase 1 reflects reality, and the three
deferred gaps research surfaced are recorded where someone will find them.

**Verify:** `npm test` passes; `npm run lint` and `npm run build` still pass
with test files present; CI shows a `test` step between `lint` and `build`;
deliberately deleting the `if (!availableDays.has(weekday))` branch in
`plan.ts` turns the suite red.

### Key Discoveries

- `getViteConfig()` from `astro/config` is **broken on this exact pin** and must
  not be used. `withastro/astro#15878` documents a three-layer incompatibility
  between `@cloudflare/vite-plugin`'s workerd SSR environment and Vitest's
  module runner; the fix (PR #17248, merged 2026-07-01) postdates both
  `astro@6.3.1` and `@astrojs/cloudflare@13.5.0` (both published 2026-05-07).
  Verified firsthand: `grep -rl "process.env.VITEST"` over
  `node_modules/astro/dist/` and `node_modules/@astrojs/cloudflare/dist/`
  returns nothing, and the adapter unconditionally pushes `cfVitePlugin(...)`
  into `vite.plugins` at `dist/index.js:137` during `astro:config:setup` —
  which `getViteConfig()` runs. **The documented Astro path is the broken one.**
- The weekend duration-cap branch has a **dead zone**: `max_weekend_minutes`
  accepts up to 600 (`onboarding-schema.ts:36`; DB `:55`) but
  `planned_duration_min` is hard-capped at 360 by zod (`plan-schema.ts:68`) and
  the DB (`:160`). For any weekend cap ≥ 360 the check at `plan.ts:99` can
  never fire — zod rejects first with a `schema` issue.
- `plan_sessions.structure` is opaque JSONB — the only DB constraint is
  `jsonb_typeof(structure) = 'object' and structure ? 'segments'`
  (`init_mvp_schema.sql:161-163`). Every intensity rule is a **TypeScript-only
  invariant**, which is why unit is not merely the cheapest layer here but the
  *only* layer that checks these rules at all.
- `EQUIPMENT_TARGET_KIND`, `WEEKEND_DAYS`, `WEEKDAY_BY_OFFSET` (`plan.ts:23,34,33`)
  are **not exported** — tests must assert through `validateGeneratedPlan`
  rather than against them directly.
- The retry loop re-sends an **identical** prompt (`generate.ts:71-77` reuses
  messages built once at `:55`), and validation `issues` are never read or
  logged by either route.

## What We're NOT Doing

- **No production code changes.** No new guardrails, no schema changes, no
  migration. Every defect research found is recorded, not fixed.
- **No zone/%FTP validation.** Blocked on A1–A3; deferred by explicit decision.
- **No minimum-session or week-coverage rule.** Inventing one would violate the
  oracle rule (no source states it). Recorded against A4/A5.
- **No change to the 600-vs-360 weekend contradiction.** Tests work within the
  reachable range; recorded against A6.
- **Risk #3 (`equipment_mismatch`) and Risk #6 (zod↔DB parity).** Same rollout
  phase, but outside this research scope — they get their own research pass
  appended to `research.md`, then their own plan phases.
- **No fix for the unlogged-`issues` diagnosability gap** in `generate.ts` /
  `renew.ts`. Real, but a production change and not a test concern.
- **No `astro:env` shim, no workerd pool, no coverage thresholds, no Stryker.**
  Not needed for pure-TS units; Stryker's Vitest 4 compatibility is unverified.
- **No component, integration, or e2e tests.** Phases 2–4 of the rollout.

## Implementation Approach

Bootstrap first, because nothing else can run without it — and validate the
bootstrap with a throwaway smoke test before writing any real assertion, since
research flagged the config as reasoned-from-sources but **never executed**.
Then build fixture factories, because `Profile` is a 15-field row and every
test would otherwise drown in irrelevant field noise. Then three test phases,
each pinning one property with an oracle traced to a specification source.
Finally, record what shipped and what was deliberately deferred.

Phases 3–5 are marked TDD-able: each has a nameable first red test, and the
red step is meaningful even though the implementation already exists — deleting
the guardrail must turn the test red, which is the actual claim being made.

## Critical Implementation Details

**Do not use `getViteConfig()`.** See Key Discoveries. Use a standalone
`vitest.config.ts` with `vite-tsconfig-paths` for the `@/*` alias. The Astro
testing docs recommend the broken path, so an implementer following docs rather
than this plan will hit three confusing errors in sequence
(`resolve.external` rejection, `exports is not defined`, then
`Cannot read properties of undefined (reading 'wrapDynamicImport')`).

**Weekend-cap fixtures must use a cap below 360.** A fixture with
`max_weekend_minutes: 600` and a 400-minute session produces a `schema` issue,
not `duration_over_cap` — the test would pass while asserting the wrong thing.

**Keep the `vite` override.** `package.json` pins `overrides: { "vite": "^7.3.2" }`,
which keeps a single deduped vite at 7.3.3. Removing it reintroduces the
duplicate-vite failure mode seen in the Astro issue thread.

## Phase 1: Runner bootstrap

### Overview

Install and configure Vitest, prove the configuration actually executes, and
wire the CI gate.

### Changes Required:

#### 1. Dependencies

**File**: `package.json`

**Intent**: Add the test runner and the alias resolver, and expose a `test`
script so CI and humans have one entry point.

**Contract**: devDependencies gain `vitest@^4.1.11` and
`vite-tsconfig-paths@^6.1.1`. Scripts gain `"test": "vitest run"` and
`"test:watch": "vitest"`. The existing `overrides.vite` entry stays untouched.

Vitest **4.1.x, not 5.x**: `@cloudflare/vitest-plugin` (the renamed
`vitest-pool-workers`) peers `vitest ^4.1.0` and does not support 5, so pinning
4 keeps the workerd pool available to Phases 2–4 without a runner migration.
4.1.11 satisfies vite 7.3.3 (`^6 || ^7 || ^8`) and Node 22.14.0.

#### 2. Runner configuration

**File**: `vitest.config.ts` (new)

**Intent**: Configure Vitest standalone, deliberately bypassing Astro's
`getViteConfig()` helper for the reason recorded in Critical Implementation
Details.

**Contract**: Default export from `vitest/config`'s `defineConfig`, with
`vite-tsconfig-paths` in `plugins` to resolve `@/*`, `test.environment: "node"`,
and `test.include: ["src/**/*.test.ts"]`. Do not set `globals: true` — tests
import `describe`/`it`/`expect` explicitly from `vitest` so `tsconfig.json`'s
`types` array stays untouched and the strict lint rules keep working.

#### 3. Bootstrap smoke test

**File**: `src/lib/plan.test.ts` (new, minimal at this phase)

**Intent**: Prove the runner resolves the `@/*` alias, imports a real project
module, and runs — before any effort goes into meaningful assertions. Research
verified the config against primary sources but never executed it, so this is
the phase's actual risk.

**Contract**: One test importing `weekdayForDayIndex` from `@/lib/plan` and
asserting `weekdayForDayIndex(1) === "mon"`. This file is extended by Phase 3
rather than deleted — the assertion is genuine, not throwaway scaffolding.

#### 4. CI gate

**File**: `.github/workflows/ci.yml`

**Intent**: Make the unit suite a required gate, positioned so a failing test
short-circuits the slower build.

**Contract**: A `- run: npm test` step between the existing `npm run lint` and
`npm run build` steps. **No `env:` block** — unlike `build`, the test step never
resolves the `astro:env` schema, so `SUPABASE_URL`/`SUPABASE_KEY` would be
cargo-culted noise. Leave `npx astro sync` ahead of it (it generates
`.astro/types.d.ts`, which `tsconfig.json` includes).

### Success Criteria:

#### Automated Verification:

- `npm test` runs and the smoke test passes
- `npm run lint` passes with the new `.ts` files present
- `npm run build` still passes (test files compile under `@astrojs/check`)
- `npx tsc --noEmit` reports no errors in `vitest.config.ts` or the test file

#### Manual Verification:

- `npm run test:watch` starts and re-runs on edit
- The `@/*` alias resolves (confirmed by the smoke test importing `@/lib/plan`)
- CI run on a pushed branch shows `test` between `lint` and `build`

**Implementation Note**: Pause here for manual confirmation before proceeding.
This phase carries the plan's only genuinely unverified assumption.

---

## Phase 2: Fixture factories

### Overview

Build the two factories every later phase depends on.

### Changes Required:

#### 1. Profile factory

**File**: `src/lib/__fixtures__/profile.ts` (new)

**Intent**: Produce a valid `Profile` from partial overrides so tests state only
the fields they care about. Without this, each test carries 15 lines of
irrelevant profile data and the assertion's intent disappears.

**Contract**: `makeProfile(overrides?: Partial<Profile>): Profile`. Defaults must
be internally coherent and inside every DB CHECK: `equipment_type: "power_meter"`,
`available_days: ["mon","wed","fri"]`, `max_workday_minutes: 90`, and
**`max_weekend_minutes: 180`** — deliberately below 360 so the weekend cap
branch is reachable by default (see Critical Implementation Details).

#### 2. Plan payload factory

**File**: `src/lib/__fixtures__/plan-payload.ts` (new)

**Intent**: Produce a generated-plan payload that passes `validateGeneratedPlan`
against the default profile, plus helpers to make one session deviate. Tests
then express exactly one deviation each, which is what makes a failure
diagnostic.

**Contract**: `makePlanPayload(overrides?)` returning an `unknown`-typed payload
matching `planSchema`'s shape, and `makeSession(overrides?)` for a single
session whose `structure.segments` sum to `planned_duration_min`. Payloads are
typed `unknown` at the boundary, mirroring how `validateGeneratedPlan` receives
them — do **not** type them as the parsed output, or the tests stop exercising
the untrusted-input path.

**Note on placement**: `src/lib/__fixtures__/` keeps fixtures out of
`test.include` (`src/**/*.test.ts`) while staying inside the `@/*` alias. They
will be linted and type-checked like any other source file.

### Success Criteria:

#### Automated Verification:

- `npm test` passes
- A test asserting `validateGeneratedPlan(makePlanPayload(), makeProfile())`
  returns `{ ok: true }` passes — the factories are coherent by default
- `npm run lint` and `npm run build` pass

#### Manual Verification:

- Default fixture values are inside every DB CHECK in `init_mvp_schema.sql`
- `max_weekend_minutes` default is below 360

---

## Phase 3: Availability containment (TDD-able)

**First red test**: *"rejects a plan with a session on a weekday the cyclist did
not declare available."*

### Overview

Pin clause (a) of Risk #1. Oracle: `first-plan-generation/plan.md:27,55,129(b)`
and `plan-brief.md:28,64` — stated four times, unambiguous, and **one-directional**
(containment, never coverage).

### Changes Required:

#### 1. Availability tests

**File**: `src/lib/plan.test.ts` (extend)

**Intent**: Assert that every scheduled session's weekday falls inside
`available_days`, that the Monday anchor holds across all four weeks, and — the
half that catches a well-meaning future regression — that **no coverage rule
exists**.

**Contract**: Tests against `validateGeneratedPlan`. Cover:

- a session on a declared day passes;
- a session on an undeclared day is rejected, with an issue whose `code` is
  `unavailable_day`;
- the anchor holds beyond week 1 — parameterise over `day_index` 1, 8, 15, 22
  all mapping to `mon`, and 7, 14, 21, 28 all mapping to `sun`. Use `it.each`
  rather than four near-identical tests (test-plan §"Redundant copies").
- **absence assertion**: a plan using only 1 of 3 declared days returns
  `{ ok: true }`. This documents that coverage is deliberately unenforced and
  fails loudly if someone later adds a coverage rule without a product
  decision (research A4).

Derive expected weekdays from the **spec-stated** anchor (`day_index 1 = mon`,
repeating every 7 days), not by calling `weekdayForDayIndex` inside the
assertion — computing the expectation with the code under test is the
mirror-implementation anti-pattern.

### Success Criteria:

#### Automated Verification:

- `npm test` passes
- Commenting out the `if (!availableDays.has(weekday))` block in `plan.ts:91-96`
  turns at least two tests red
- `npm run lint` and `npm run build` pass

#### Manual Verification:

- No assertion calls `weekdayForDayIndex` to compute its own expected value
- The 1-of-3-days test carries a comment naming research A4 as the reason it
  asserts `ok: true`

---

## Phase 4: Duration caps (TDD-able)

**First red test**: *"rejects a weekend session longer than the cyclist's
declared weekend cap."*

### Overview

Pin clause (b). Oracle: `first-plan-generation/plan.md:55,129(c)` — weekend cap
for sat/sun, workday cap otherwise, hard ceiling, reject-not-clamp.

### Changes Required:

#### 1. Duration-cap tests

**File**: `src/lib/plan.test.ts` (extend)

**Intent**: Assert the correct cap is selected per day type, that the cap is a
hard ceiling at its exact boundary, and that the segment-sum invariant holds.

**Contract**: Tests against `validateGeneratedPlan`. Cover:

- a session exactly **at** the cap passes; at **cap + 1** it is rejected with
  code `duration_over_cap` — boundary on both sides, since an off-by-one here
  is the realistic regression;
- **cap selection by day type**: a duration that is legal on a weekend day and
  illegal on a workday must pass on `sat` and fail on `mon` with the *same*
  duration. This is the assertion that catches a swapped-cap bug, which
  neither cap tested alone would find;
- segment durations not summing to `planned_duration_min` is rejected with code
  `duration_mismatch`;
- fixtures use `max_weekend_minutes` **below 360** so the branch is reachable.

Draw cap values from the fixture profile, and expected pass/fail from the
spec rule ("≤ the day-type cap"), not from re-reading `plan.ts:99`.

### Success Criteria:

#### Automated Verification:

- `npm test` passes
- Swapping `max_weekend_minutes` and `max_workday_minutes` at `plan.ts:98`
  turns the cap-selection test red
- Changing `>` to `>=` at `plan.ts:99` turns the at-cap boundary test red
- `npm run lint` and `npm run build` pass

#### Manual Verification:

- No fixture in this phase uses a weekend cap of 360 or above
- A comment records why (research A6, the 600-vs-360 contradiction)

---

## Phase 5: Rejection semantics (TDD-able)

**First red test**: *"rejects the entire plan when one session is invalid,
rather than dropping that session and returning the rest."*

### Overview

Pin the architectural property that makes Phases 3 and 4 meaningful. The
archive states it as a decision — "Hard reject + retry on mismatch (no
coercion) … coercion = silently wrong numbers"
(`first-plan-generation/plan-brief.md:30`), "A violation is a hard
zod/refinement failure → retry, not a persist" (`plan.md:55`). Research
confirmed the code honours it. **Nothing currently prevents a future
"be lenient" refactor**, and that refactor is exactly Risk #1 coming true.

### Changes Required:

#### 1. Reject-don't-repair tests

**File**: `src/lib/plan.test.ts` (extend)

**Intent**: Assert that rejection is whole-plan and lossless-of-nothing: no
session is dropped, no value clamped, and the returned result carries no plan.

**Contract**: Tests against `validateGeneratedPlan`. Cover:

- a payload with one valid and one invalid session returns `ok: false` and the
  result exposes **no** `plan` property — proving the valid session was not
  salvaged and returned;
- a session over its cap is **not** clamped: no result shape carries a mutated
  `planned_duration_min`;
- issues **accumulate** — a payload violating both availability and the cap
  yields issues for both, not just the first. Use `unavailable_day` +
  `duration_over_cap` (not `equipment_mismatch`, which is Risk #3's territory);
- a payload failing zod outright (missing `sessions`) returns `ok: false` with
  issue code `schema`;
- **edge cases**: `validateGeneratedPlan(null, profile)` and
  `validateGeneratedPlan({}, profile)` both return `ok: false` without throwing.
  `.safeParse` is what makes this true (`plan.ts:67`); a refactor to `.parse`
  would throw and take down the route.

### Success Criteria:

#### Automated Verification:

- `npm test` passes
- Changing `plan.ts:67` from `.safeParse` to `.parse` turns the `null`-input
  test red (throws rather than returning)
- `npm run lint` and `npm run build` pass

#### Manual Verification:

- The accumulation test asserts on issue *codes*, not on message text or
  ordering — message wording is not a contract
- No test in this phase touches `equipment_mismatch`

---

## Phase 6: Cookbook and deferred-gap recording

### Overview

Make the rollout state on disk match reality, and give the three deferred gaps
an owner so they live somewhere more durable than a research document.

### Changes Required:

#### 1. Cookbook pattern

**File**: `context/foundation/test-plan.md` §6.1

**Intent**: Replace the TBD with the pattern this phase actually established,
so the next contributor does not re-derive it.

**Contract**: §6.1 gains: where unit tests live and how they are named; the
factory-with-overrides convention; the standalone-`vitest.config.ts` decision
**with the `getViteConfig()` warning and its issue link**; the rule that
expected values come from PRD/plan-brief business rules rather than from the
validator; and the weekend-cap fixture constraint. Keep §6.2–§6.5 as TBD.

#### 2. Rollout status

**File**: `context/foundation/test-plan.md` §3 and §4

**Intent**: Reflect that a runner now exists and that Phase 1 is partially
complete — Risk #1's testable clauses are covered, #3 and #6 are not.

**Contract**: §3 Phase 1 Status advances per the fixed vocabulary. §4 rows for
`unit + integration` gain the chosen tool and version, replacing "none yet".
Add a note that Phase 1 covers Risk #1 only so far.

#### 3. Deferred gaps

**File**: `context/foundation/test-plan.md` §7, and `research.md` cross-reference

**Intent**: Record the three gaps as deliberate negative space with the open
question that blocks each — the difference between an accepted exclusion and a
forgotten one.

**Contract**: §7 gains three entries, each naming what is not tested, why, and
its re-evaluation trigger:

- **zone/%FTP correspondence** — no oracle; blocked on A1–A3; re-evaluate when
  the zone table and the 5-vs-7 question are settled;
- **plan completeness** — a one-session plan is currently valid; blocked on
  A4/A5; re-evaluate when a coverage rule is decided;
- **weekend caps in 360–600** — unreachable branch; blocked on A6; re-evaluate
  if the input bound or the session ceiling changes.

Also record the §3 Phase 5 consequence: Risk #1 is **not** closed by Phase 1,
but the residue is a missing deterministic rule plus a missing completeness
check — **not** the AI-judgment problem Phase 5 exists for. Phase 5 should stay
`not started` and be re-decided after A1–A4, rather than absorbing this gap.

#### 4. Change status

**File**: `context/changes/testing-runner-bootstrap/change.md`

**Intent**: Close out the change record.

**Contract**: `status` and `updated` advanced; a note that Risks #3 and #6
remain open within this rollout phase.

### Success Criteria:

#### Automated Verification:

- `npm test`, `npm run lint`, `npm run build` all pass
- §6.1 contains no "TBD"
- `grep -c "not started" context/foundation/test-plan.md` reflects the update

#### Manual Verification:

- §7 entries each name a re-evaluation trigger, not just an exclusion
- §6.1 carries the `getViteConfig()` warning with the issue link
- The Phase 5 note explains *why* the residue is not an AI-native problem

---

## Testing Strategy

### Unit Tests

- **Availability containment** — declared day passes; undeclared rejected;
  Monday anchor across weeks 1–4 via `it.each`; partial-coverage plan passes.
- **Duration caps** — at-cap and cap+1 boundaries; cap selection by day type
  with one duration exercising both directions; segment-sum mismatch.
- **Rejection semantics** — whole-plan rejection with no partial plan returned;
  no clamping; multi-issue accumulation; `null` and `{}` inputs handled without
  throwing.

### Edge cases explicitly covered

Per test-plan §"Happy paths only", each risk phase carries at least one: `null`
input (Phase 5), empty object (Phase 5), boundary-exact values (Phase 4),
absence-of-rule assertion (Phase 3).

### Integration Tests

None. Deliberate: `plan_sessions.structure` is opaque JSONB
(`init_mvp_schema.sql:161-163`), so an integration test would verify strictly
less than a unit test here. Integration begins at rollout Phase 2.

### Manual Testing Steps

1. `npm test` — suite green.
2. Comment out `plan.ts:91-96` (availability) → tests red. Restore.
3. Swap the cap ternary at `plan.ts:98` → cap-selection test red. Restore.
4. Change `.safeParse` to `.parse` at `plan.ts:67` → `null`-input test red. Restore.
5. Push a branch; confirm CI runs `test` between `lint` and `build`.

Steps 2–4 are the real acceptance test for this plan: they prove the suite
detects regressions rather than merely executing lines.

## Performance Considerations

Negligible — pure functions, no I/O, no DOM. The suite should run in under a
second. This is the argument against `@cloudflare/vitest-plugin` here: booting
workerd per test file would add seconds for zero additional signal, since none
of these modules touch Workers APIs or bindings.

## Migration Notes

Not applicable — no schema or data changes. The only durable commitment is the
Vitest 4.x pin, chosen so Phases 2–4 can add `@cloudflare/vitest-plugin`
(peers `vitest ^4.1.0`) without a runner migration.

## References

- Research: `context/changes/testing-runner-bootstrap/research.md`
- Risk map and rollout: `context/foundation/test-plan.md` §2, §3, §6
- Validator oracle: `context/archive/2026-06-10-first-plan-generation/plan.md:55,123-129`
- Reject-don't-coerce decision: `context/archive/2026-06-10-first-plan-generation/plan-brief.md:30`
- Code under test: `src/lib/plan.ts:66-131`
- Astro/Vitest incompatibility: https://github.com/withastro/astro/issues/15878

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Runner bootstrap

#### Automated

- [x] 1.1 `npm test` runs and the smoke test passes
- [x] 1.2 `npm run lint` passes with the new `.ts` files present
- [x] 1.3 `npm run build` still passes
- [x] 1.4 `npx tsc --noEmit` clean for config and test file

#### Manual

- [ ] 1.5 `npm run test:watch` starts and re-runs on edit
  > Skipped by decision 2026-09-07: low signal (`test:watch` is `vitest` minus
  > `run`, and `vitest run` is green), and not agent-verifiable — Vitest
  > auto-disables watch when stdout is not a TTY.
- [x] 1.6 The `@/*` alias resolves
- [ ] 1.7 CI shows `test` between `lint` and `build`
  > Deferred by decision 2026-09-07: unobservable until the commit is pushed.
  > YAML verified by inspection; tick once CI is green on the pushed commit.

### Phase 2: Fixture factories

#### Automated

- [ ] 2.1 `npm test` passes
- [ ] 2.2 Default fixtures validate as `{ ok: true }`
- [ ] 2.3 `npm run lint` and `npm run build` pass

#### Manual

- [ ] 2.4 Default values inside every DB CHECK
- [ ] 2.5 `max_weekend_minutes` default below 360

### Phase 3: Availability containment

#### Automated

- [ ] 3.1 `npm test` passes
- [ ] 3.2 Commenting out `plan.ts:91-96` turns at least two tests red
- [ ] 3.3 `npm run lint` and `npm run build` pass

#### Manual

- [ ] 3.4 No assertion calls `weekdayForDayIndex` to compute its expectation
- [ ] 3.5 Partial-coverage test comments its A4 rationale

### Phase 4: Duration caps

#### Automated

- [ ] 4.1 `npm test` passes
- [ ] 4.2 Swapping caps at `plan.ts:98` turns the cap-selection test red
- [ ] 4.3 Changing `>` to `>=` at `plan.ts:99` turns the boundary test red
- [ ] 4.4 `npm run lint` and `npm run build` pass

#### Manual

- [ ] 4.5 No fixture uses a weekend cap of 360 or above
- [ ] 4.6 A comment records the A6 rationale

### Phase 5: Rejection semantics

#### Automated

- [ ] 5.1 `npm test` passes
- [ ] 5.2 `.safeParse` → `.parse` turns the `null`-input test red
- [ ] 5.3 `npm run lint` and `npm run build` pass

#### Manual

- [ ] 5.4 Accumulation test asserts on codes, not message text or ordering
- [ ] 5.5 No test touches `equipment_mismatch`

### Phase 6: Cookbook and deferred-gap recording

#### Automated

- [ ] 6.1 `npm test`, `npm run lint`, `npm run build` all pass
- [ ] 6.2 §6.1 contains no "TBD"
- [ ] 6.3 §3 status updated

#### Manual

- [ ] 6.4 §7 entries each name a re-evaluation trigger
- [ ] 6.5 §6.1 carries the `getViteConfig()` warning and issue link
- [ ] 6.6 Phase 5 note explains why the residue is not an AI-native problem
