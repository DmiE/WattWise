# Equipment Target-Kind Exclusivity and zod↔DB Parity Units — Implementation Plan

## Overview

Close rollout Phase 1 of `context/foundation/test-plan.md` §3 by pinning its two
remaining risks with unit tests on the runner `testing-runner-bootstrap` already
shipped:

- **Risk #3** — a cyclist sees intensity targets that do not match their declared
  equipment. Asserted in **both directions** across all three equipment types
  (the required kind passes, each wrong kind is rejected), plus the one render-side
  gap research found real: the intensity legend and the segment targets are read
  from two independent sources and nothing asserts they agree.
- **Risk #6** — input the server accepts that the database rejects. Asserted as
  bounds parity against the constraint set read out of the applied migration, and
  as the three cross-field CHECK truth tables that today are upheld only by two
  hand-written derivation functions.

**Test-only, like the change before it.** Every defect research surfaced is
recorded in test-plan §7 with its blocking question, not fixed. Where current
behaviour is a known divergence, a test pins it so the fix turns the test red —
that redness is the intended signal.

## Current State Analysis

- **Risk #3 has zero coverage and a four-times-stated oracle.**
  `EQUIPMENT_TARGET_KIND` (`src/lib/plan.ts:23-27`) maps `power_meter→watts`,
  `hrm→hr_zone`, `none→rpe` and is called "the single source of truth" in its own
  comment. It is **not exported** (`grep` finds it only at `plan.ts:23,80,169`), so
  tests must assert through `validateGeneratedPlan` — the same constraint the prior
  change recorded for `WEEKDAY_BY_OFFSET`.
- **Enforcement is per-segment, kind-only, accumulating.** `plan.ts:117-124` emits
  `equipment_mismatch` inside the per-session loop; `requiredKind` is computed once
  at `:80`; the function returns only after the full loop (`:127-130`). Values are
  never compared — a 20 W target for a 250 W-FTP athlete passes.
- **The render face is safe by construction, with one real gap.** `formatTarget`
  (`PlanView.tsx:611-621`) is the only target formatter, an exhaustive `switch`
  that never reads a unit-specific field outside its matching case. It is
  module-private, and no jsdom or testing-library is installed. But
  `INTENSITY_REFERENCE` (`src/lib/intensity-reference.ts:53`) **is** exported and
  pure, and the legend it renders comes from `equipment_at_generation`
  (`PlanView.tsx:195,553-556`) while targets come from the stored `kind` — two
  sources, no assertion that they agree.
- **Risk #6's premise is inverted on this table.** The declared oracle is
  unambiguous — `2026-06-07-onboarding-wizard/plan.md:29`: the DB CHECK constraints
  are "the source of truth … the zod schema and the wizard must mirror them". But
  zod is *stricter* than the DB in two places, and in one of them the DB constraint
  is dead code.
- **Two `available_days` rules are DB-dead.** `array_length('{}'::text[], 1)` is
  `NULL`, `NULL between 1 and 7` is `NULL`, and a CHECK evaluating to `NULL` is
  satisfied — so `profiles_available_days_valid` (`init_mvp_schema.sql:56-59`)
  accepts the empty array despite appearing to forbid it. `<@` is subset
  containment, so seven `'mon'` entries also pass. zod's `.min(1)` and its
  uniqueness `.refine` (`onboarding-schema.ts:28-34`) are the only real guards.
- **The one genuinely Risk-#6-shaped divergence is `weight_kg`.**
  `numeric(5,2)` (`init_mvp_schema.sql:40`) with `check (weight_kg between 30 and 200)`
  (`:51`). Postgres rounds *before* the CHECK runs, so `200.004` stores as `200.00`
  and is DB-legal while zod's `.max(200)` rejects it; `70.123456` passes zod and
  silently truncates to `70.12`. The archive found and **fixed** this exact defect
  on `km_ridden numeric(5,2)`
  (`session-tracking/reviews/plan-review.md:38-46`) and no document records the
  analysis being re-applied here.
- **Parity is three layers, not two.** `toProfileInsert` (`onboarding.ts:37-86`)
  and `applyRenewal` (`renewal.ts:14-40`) sit between zod and the database, and
  **three CHECK constraints have no zod counterpart at all** —
  `power_meter_requires_ftp` (`:60-62`), `hrm_requires_max_hr` (`:63-65`),
  `fitness_level_matches_ftp_source` (`:66-69`). The archive verified them by
  reading (`onboarding-wizard/reviews/plan-review.md:22`).
- **The infrastructure is in place.** Vitest 4.1.11, `src/lib/__fixtures__/`, and
  the conventions in test-plan §6.1 all exist; `plan.test.ts` carries 23 passing
  assertions and a `rejectionCodes` helper (`:60-65`) that throws when the
  validator unexpectedly passed.

## Desired End State

`npm test` fails if anyone weakens the equipment→target-kind binding in either
direction, lets the legend drift from the target kind it explains, relaxes a zod
bound away from its DB constraint, or breaks one of the three cross-field CHECKs
in the derivation layer. Test-plan §6.2 carries a real cookbook pattern instead of
a TBD, §3 Phase 1 reads `complete`, and every finding research surfaced that this
change does not test is recorded in §7 with the question that blocks it.

**Verify:** `npm test` passes; `npm run lint` and `npm run build` still pass;
changing the `hrm` entry of `EQUIPMENT_TARGET_KIND` to `"watts"` turns the hrm rows
of the exclusivity matrix red; relaxing any bound in `onboarding-schema.ts` by one
step turns the corresponding parity row red; flipping `fitness_level: null` to
`input.fitness_level` in `toProfileInsert`'s measured branch turns the CHECK
truth-table test red.

### Key Discoveries

- **A garbage `kind` yields `schema`, not `equipment_mismatch`.** zod's
  discriminated union rejects first and `plan.ts:67-76` short-circuits, so the
  issue code depends on *how* the kind is wrong. A test meaning to assert
  `equipment_mismatch` must use a **structurally valid target of the wrong kind**.
- **Exclusivity is transitive, never stated directly.** `targetSchema`
  (`plan-schema.ts:44-51`) has one refine — the low ≤ high range check. There is no
  `superRefine` and no cross-segment constraint anywhere in the file, so a
  mixed-kind payload parses clean; exclusivity emerges only from every segment
  being compared to one profile-derived value. `PLAN_JSON_SCHEMA` does not constrain
  kind either (`:173-175`, `anyOf` over all three, module-level const passed
  verbatim by both routes) — the model is steered only by prompt prose
  (`plan.ts:180`).
- **`makeProfile` deliberately does not derive companion fields.** Its docblock
  (`__fixtures__/profile.ts:31-39`) warns that overriding `equipment_type` alone
  leaves `ftp_watts: 250` and `ftp_source: "measured"` set — a row that violates
  `fitness_level_matches_ftp_source` and could not exist in the database.
- **`estimateFtpWatts`'s lower clamp is unreachable.** `Math.max(50, …)` at
  `onboarding.ts:24` can never fire: the lowest possible product is
  `2.0 W/kg × 30 kg = 60`, and 30 kg is zod's and the DB's minimum weight. The upper
  clamp *is* reachable (`3.7 × 200 = 740 → 600`).
- **`weight_kg`'s divergent probe is `200.004`, not `200.01`.** `200.01` stores as
  `200.01`, violates the CHECK, and is rejected by both layers — no divergence. Only
  a value that rounds *down* into range exposes it.
- **`INTENSITY_REFERENCE` is exhaustive by `Record` at compile time only.** Its
  three captions are "Power zones (% of FTP)" (`:56`), "Heart-rate zones (% of max HR)"
  (`:67`), and "Rate of Perceived Exertion (1–10)" (`:78`); the hrm table carries
  rows Z1–Z5, matching `hrZoneTarget`'s `zone: .min(1).max(5)` (`plan-schema.ts:29`).

## What We're NOT Doing

- **No production code changes.** No zod tightening, no `superRefine`, no route
  guard, no migration. Confirmed decision: every finding is recorded, not fixed.
- **No `weight_kg` fix.** B4 stays open; the tests pin today's behaviour and carry
  the `km_ridden` precedent in a comment so the fix has a red test waiting.
- **No DB-parity assertion on `available_days` emptiness or uniqueness.** The layers
  genuinely disagree (B1/B2). Tests assert **zod as sole enforcer** and say so.
- **No migration repair of the dead `array_length` CHECK, and no day-uniqueness
  constraint.** Recorded against B1/B2.
- **No DOM or component test layer.** `formatTarget` stays module-private; no jsdom,
  no testing-library. Test-plan §7 already excludes UI look-and-feel.
- **No test of the unguarded `POST /api/onboarding` re-POST.** It needs auth and a
  Supabase client. Recorded in §7 and routed into §3 Phase 2's scope (B3).
- **No route-level assertion that a rejection returns an actionable 400.** Risk #6's
  response guidance names it, but it is endpoint-level — §3 Phase 2.
- **No read-path revalidation of `plan_sessions.structure`.** The unchecked
  `as PlanSessionView` casts (`services/plan.ts:77-85,117-119`) stay; recorded
  against B8, which the archive already SKIPPED once as F6.
- **No zone/%FTP assertions.** Still blocked on A1–A3. Phase 3 asserts only that the
  hrm legend's row count matches zod's `zone` bound — it says nothing about the
  percentages.
- **Nothing re-litigated from the A-series.** A1–A9 stay open and untouched.
- **No Stryker, no coverage thresholds, no integration or e2e tests.**

## Implementation Approach

Fixtures first, because Risk #3 cannot be expressed at all until DB-coherent `hrm`
and `none` profiles and `hr_zone` / `rpe` targets exist — and `makeProfile`'s
documented non-derivation makes the naive override a trap. Then the two Risk #3
phases: the validator matrix, then the legend agreement that closes the render-side
gap at pure-unit cost. Then the two Risk #6 phases, split because they have
*different oracles*: numeric bounds come from the CHECK literals, while the
cross-field rules come from three CHECK truth tables and must be transcribed as
predicates rather than restated as field expectations. Recording last.

Phases 2–5 are marked TDD-able: each has a nameable first red test, and the red
step is the real deliverable even though the implementation exists — the claim
being made is that breaking the guardrail turns the test red.

**Fixtures are extended, never modified.** `makeProfile`'s defaults and contract
stay byte-identical; the 23 existing assertions in `plan.test.ts` must keep passing
untouched throughout.

## Critical Implementation Details

**A wrong-kind target must be structurally valid.** To get `equipment_mismatch`,
pass a well-formed target of a different kind (`{ kind: "rpe", rpe: 4, description: "…" }`
to a power-meter profile). A garbage kind (`{ kind: "power" }`) fails zod's
discriminated union first and comes back as `["schema"]` — the test would pass
while asserting a completely different rule. This is the direct analogue of the
weekend-cap trap recorded in §6.1, and it is why Phase 2 pins the code boundary
explicitly rather than leaving it implicit.

**Equipment-variant profiles must carry their companion fields.** An `hrm` profile
needs `ftp_watts: null`, `ftp_source: null`, `max_hr` set, and `fitness_level`
non-null; a `none` profile needs `ftp_watts: null`, `ftp_source: null`,
`max_hr: null`, `fitness_level` non-null. Overriding `equipment_type` alone
produces a row that violates `fitness_level_matches_ftp_source` — the exclusivity
test would then be asserting against a profile that could not exist, which is the
fixture rule §6.1 exists to prevent.

**The `weight_kg` probe values are `200.004` and `29.996`.** Anything ending in a
digit the second decimal place can represent (`200.01`, `29.99`) is rejected by
both layers and demonstrates nothing. Use values that round *into* the legal range.

**Do not assert `estimateFtpWatts`'s lower clamp.** It is unreachable — the
minimum product is `2.0 × 30 = 60`. A test for it would be dead code asserting a
dead branch. Record it in §7 instead.

## Phase 1: Equipment fixture variants

### Overview

Extend both fixture factories so the other phases can express an equipment
deviation as a single call. Nothing here changes existing behaviour.

### Changes Required:

#### 1. Equipment-variant profile factories

**File**: `src/lib/__fixtures__/profile.ts` (extend)

**Intent**: Give tests DB-coherent `hrm` and `none` profiles without each one
re-deriving the four companion fields the CHECK constraints require. Built as
additions so `makeProfile`'s documented contract and defaults stay untouched and
the 23 existing assertions are unaffected.

**Contract**: New exports `makeHrmProfile(overrides?: Partial<Profile>): Profile`
and `makeNoneProfile(overrides?: Partial<Profile>): Profile`, each delegating to
`makeProfile` with its branch's companion fields, plus a `FIXTURE_MAX_HR` constant.
Both set `ftp_watts: null` and `ftp_source: null` and a non-null `fitness_level`
(`fitness_level_matches_ftp_source`, migration `:66-69`); `hrm` additionally sets
`max_hr` (`hrm_requires_max_hr`, `:63-65`). Every value stays inside its range
CHECK. Each factory's docblock names the constraint that forces each companion
field, and cites `makeProfile`'s non-derivation warning as the reason the factory
exists.

#### 2. Non-watts target factories

**File**: `src/lib/__fixtures__/plan-payload.ts` (extend)

**Intent**: Supply valid `hr_zone` and `rpe` targets, and a kind→factory map so the
exclusivity matrix can be a parameterised table rather than nine near-identical
literals.

**Contract**: Export the existing `makeWattsTarget`, add `makeHrZoneTarget()` and
`makeRpeTarget()` (both returning `unknown`, like every factory in this file), and
add `TARGET_FACTORY_BY_KIND: Record<PlanTargetKind, () => unknown>`. Every target
sits inside `plan-schema.ts`'s bounds with `low ≤ high`, and is plausible against
the corresponding profile fixture (an `hr_zone` range below `FIXTURE_MAX_HR`).
Import `PlanTargetKind` as a **type-only** import so the factories keep returning
`unknown` and tests still exercise the untrusted-input path.

#### 3. Fixture coherence guard

**File**: `src/lib/plan.test.ts` (extend)

**Intent**: Assert the three equipment variants each validate against their matching
target kind. This is the fixture guard §6.1 requires — when it fails, the fixtures
drifted — and it doubles as the *accept* half of Risk #3's both-directions claim,
so Phase 2 owns only the rejection matrix and no assertion is duplicated.

**Contract**: One `it.each` over three rows binding a profile factory to its
required target kind, asserting `validateGeneratedPlan` returns `ok: true`. The
three kind literals are written by hand from the oracle
(`first-plan-generation/plan.md:129(a)`), not read from `EQUIPMENT_TARGET_KIND`,
which is module-private anyway.

### Success Criteria:

#### Automated Verification:

- `npm test` passes, and the 23 pre-existing assertions in `plan.test.ts` are
  unchanged
- The coherence guard passes for all three equipment types
- `npm run lint` and `npm run build` pass
- `npx tsc --noEmit` reports no errors in either fixture file

#### Manual Verification:

- Every field of `makeHrmProfile()` and `makeNoneProfile()` satisfies all nine
  `profiles` CHECK constraints in `init_mvp_schema.sql:50-69`, checked by reading
  the migration
- `makeProfile`'s defaults, signature, and docblock are byte-identical to before
- Each new factory's docblock names the constraint forcing each companion field

**Implementation Note**: Pause here for manual confirmation before proceeding. Every
later Risk #3 assertion is only as trustworthy as these fixtures being rows that
could really exist.

---

## Phase 2: Target-kind exclusivity (TDD-able)

**First red test**: *"rejects an HRM cyclist's plan whose segments carry watt
targets, with an `equipment_mismatch` issue and nothing else."*

### Overview

Pin Risk #3's validator face in both directions. Oracle:
`first-plan-generation/plan.md:129(a)` spells the mapping out; `plan-brief.md:27,30`
states the response — "Hard reject + retry on mismatch (no coercion) … coercion =
silently wrong numbers"; PRD FR-005 and the §Success Criteria guardrail state the
user-facing stake; `plan-renewal/research.md:64` restates the single-source-of-truth
claim. Research found the archive ticked "a deliberately mismatched target kind is
rejected" manually at `8b9b866` **with no evidence artifact**
(`first-plan-generation/plan.md:159,372`) — this phase automates exactly that.

### Changes Required:

#### 1. Exclusivity matrix and its boundaries

**File**: `src/lib/plan.test.ts` (extend)

**Intent**: Assert the negative half — the half §2's anti-pattern column says is the
one that matters — across every equipment type, then pin the two boundaries that
would let a future refactor blur what the matrix is actually testing.

**Contract**: Tests against `validateGeneratedPlan`. Cover:

- **the rejection matrix**: one `it.each` of six rows — each equipment type paired
  with each of the two kinds it must never accept — asserting
  `rejectionCodes(result)` **equals exactly** `["equipment_mismatch"]`. Exact
  equality, not `toContain`: it proves no other guardrail fired, so the row is
  isolating the equipment rule and nothing else. All three types are covered
  because a single wrong entry in `EQUIPMENT_TARGET_KIND` would otherwise produce a
  uniformly wrong plan that a single-equipment test passes;
- **per-segment, not per-session**: a power-meter profile with one `watts` segment
  and one `rpe` segment in the same session yields exactly one
  `equipment_mismatch` — the correct segment is not also flagged. This is the case
  zod cannot catch (`plan-schema.ts` has no cross-segment constraint) and the one
  a session-level check would miss;
- **the code boundary**: a structurally invalid kind (`{ kind: "power" }`) returns
  `["schema"]`, **not** `equipment_mismatch`, because zod short-circuits at
  `plan.ts:67-76`. Pins the distinction so a refactor cannot silently merge the two
  codes, and documents in executable form why the matrix uses valid wrong-kind
  targets;
- **absence assertion (B7)**: `planSchema.safeParse` on a mixed-kind payload
  **succeeds**. Exclusivity is enforced only transitively, via the profile; nothing
  says "all segments share one kind". This pins the current design so nobody adds an
  independent rule without a product decision, and records that a wrong map entry
  would produce a uniformly-wrong plan that validates.

Expected kinds are written as literals traced to `plan.md:129(a)`. No assertion
imports or re-derives `EQUIPMENT_TARGET_KIND`.

### Success Criteria:

#### Automated Verification:

- `npm test` passes
- Changing the `hrm` entry of `EQUIPMENT_TARGET_KIND` (`plan.ts:25`) to `"watts"`
  turns the two hrm rows of the matrix red **and** the hrm coherence-guard row from
  Phase 1 red — the uniformly-wrong-map regression
- Inverting the comparison at `plan.ts:118` (`!==` → `===`) turns all six matrix
  rows red
- Deleting the segment loop at `plan.ts:116-125` turns all six matrix rows red
- `npm run lint` and `npm run build` pass

#### Manual Verification:

- Every rejection assertion uses exact-equality on the code list, never `toContain`
- No wrong-kind target in the matrix is structurally invalid — each would parse
  against `targetSchema` on its own
- The B7 absence test carries a comment stating that a passing `safeParse` is the
  asserted outcome and naming the question it pins

---

## Phase 3: Legend and target-kind agreement (TDD-able)

**First red test**: *"the intensity legend an HRM cyclist sees is the heart-rate
zone table, never the power table."*

### Overview

Close the one render-side gap research found real. Targets render the stored
`kind`; the legend renders `INTENSITY_REFERENCE[plan.equipment_at_generation]`
(`PlanView.tsx:195,553-556`). Two independent sources, no assertion they agree —
so watt targets can appear under a "Heart-rate zones (% of max HR)" caption, which
is Risk #3 as the cyclist experiences it even though the formatter is correct.
Oracle: PRD FR-005 and US-01's acceptance criteria, plus
`2026-06-25-intensity-reference/plan.md:19,118` (the legend is per-equipment and
comes from the plan snapshot).

### Changes Required:

#### 1. Legend agreement table

**File**: `src/lib/intensity-reference.test.ts` (new)

**Intent**: Bind the legend to the same three target-kind literals Phase 2 pins, so
a change to either source without the other turns red.

**Contract**: One `it.each` over three rows — one per equipment type, each carrying
the target kind that equipment requires and the legend shape it must render —
asserting `INTENSITY_REFERENCE[equipment].kind` and a distinguishing substring of
its `caption`. `power_meter` and `hrm` both yield `kind: "zones"`, so the caption is
what separates them and the substrings must be chosen to do that ("FTP" vs "max HR").
The row's target-kind column is the shared literal tying this table to Phase 2's;
both cite `first-plan-generation/plan.md:129(a)` as the source.

Also cover:

- **runtime exhaustiveness**: `INTENSITY_REFERENCE` has exactly the three equipment
  keys and no others. The `Record` type is a compile-time guarantee only, and
  research noted that a DB enum gaining a value without a type regeneration leaves
  the validator fail-closed but the prompt path fail-silent;
- **legend↔schema row correspondence**: the `hrm` legend carries exactly five zone
  rows, matching `hrZoneTarget`'s `zone: .min(1).max(5)` (`plan-schema.ts:29`), so a
  legend showing bands zod can never emit turns red. This asserts the **count**
  only — it deliberately says nothing about the percentage bands, which are blocked
  on A1–A3 and must not be fabricated here;
- **absence assertion**: the `power_meter` legend is informational, not a direct
  legend — power segments render bare watts with no zone number, which
  `intensity-reference.ts:10-12` records as "accepted and PRD-aligned". A comment
  states that the row-correspondence claim above is deliberately **not** generalised
  to power, so nobody extends it and encodes a rule no source states.

### Success Criteria:

#### Automated Verification:

- `npm test` passes
- Swapping the `power_meter` and `hrm` entries of `INTENSITY_REFERENCE`
  (`intensity-reference.ts:53`) turns at least two rows red
- Deleting one zone row from the `hrm` table turns the row-correspondence test red
- Adding a fourth key to `INTENSITY_REFERENCE` turns the exhaustiveness test red
- `npm run lint` and `npm run build` pass

#### Manual Verification:

- The caption substrings genuinely distinguish `power_meter` from `hrm` — swapping
  the two entries cannot leave the test green
- No assertion in this file references a zone *percentage*, only row counts, kinds,
  and captions
- The target-kind literals match Phase 2's exactly, and both cite the same oracle line

---

## Phase 4: zod↔DB bounds parity (TDD-able)

**First red test**: *"rejects an age of 13 and accepts 14, the bound the migration
declares."*

### Overview

Pin Risk #6's bounds face. Oracle: the constraint set in the applied migration,
read independently — `onboarding-wizard/plan.md:29` ("the DB CHECK constraints are
the source of truth — the zod schema and the wizard must mirror them", reinforced at
`:94`, restated by `plan-renewal/research.md:120,187`). `onboarding-schema.ts:8-9`
claims the bounds "mirror the CHECK constraints exactly"; this phase turns that
claim into a test, and pins the one column where it is false.

### Changes Required:

#### 1. Onboarding input fixtures

**File**: `src/lib/__fixtures__/onboarding-input.ts` (new)

**Intent**: One factory per `toProfileInsert` derivation branch, so a parity test
states one field deviation and Phase 5 can reuse the same four inputs.

**Contract**: Four factories — measured power-meter (`knows_ftp: true`), estimated
power-meter (`knows_ftp: false`), `hrm`, and `none` — each returning `unknown` with
partial overrides, mirroring the `unknown`-at-the-boundary rule §6.1 states for
payload factories. `ftp_watts` and `max_hr` live inside union branches, so a parity
row must name which factory reaches its field. Every default sits inside every bound.

#### 2. Bounds parity table

**File**: `src/lib/onboarding-schema.test.ts` (new)

**Intent**: Assert every bounded field against the migration's declared range, as
one readable table rather than two dozen near-identical tests.

**Contract**: One `it.each` whose rows are `{ field, min, max, step, factory }`
**literals**, each carrying the migration line it came from in a comment. Per row:
`min - step` rejected, `min` accepted, `max` accepted, `max + step` rejected — both
boundary sides, since an off-by-one is the realistic regression and either side alone
misses one direction. Rows cover `age` 14–100 (`:50`), `weight_kg` 30–200 (`:51`),
`ftp_watts` 50–600 (`:52`), `max_hr` 100–230 (`:53`), `max_workday_minutes` 15–360
(`:54`), `max_weekend_minutes` 15–600 (`:55`).

**No literal in this file may be imported from `onboarding-schema.ts`** — importing
the bound under test would make every row pass by construction, which is the
mirror-implementation anti-pattern in its purest form.

Also cover:

- **`available_days`, with zod named as the sole enforcer (B1/B2)**: the empty array
  and duplicate days are rejected; eight entries and an unknown day code are
  rejected; one day and all seven are accepted. A comment states that the database
  would **accept** the empty array and the duplicates — `array_length` of an empty
  array is `NULL` and a `NULL` CHECK is satisfied; `<@` is subset containment — so
  these rows assert zod as the only real guard, not parity, and names B1/B2;
- **`weight_kg` rounding divergence (B4)**: `200.004` and `29.996` are rejected by
  zod today although Postgres would round each into the legal range and store it,
  and `70.123456` is **accepted** by zod and would silently truncate to `70.12`. Both
  are characterization assertions with a comment naming B4 and the `km_ridden`
  precedent (`session-tracking/reviews/plan-review.md:38-46`, FIXED) — so a future
  fix turns them red, which is the signal;
- **the smallint rounding family**: a fractional `age` (`35.5`) is rejected by zod's
  `.int()`, which is the only thing preventing Postgres from rounding it into a
  `smallint` column. Same failure family as `weight_kg`, one case, cross-referenced
  to B4.

### Success Criteria:

#### Automated Verification:

- `npm test` passes
- Relaxing any single bound in `onboarding-schema.ts` by one step turns exactly that
  row red — spot-checked on `age` `.min(14)` → `.min(13)` and
  `max_weekend_minutes` `.max(600)` → `.max(601)`
- Deleting the uniqueness `.refine` (`onboarding-schema.ts:31-33`) turns the
  duplicate-days test red
- Deleting `.min(1)` on `available_days` turns the empty-array test red
- Deleting `.int()` from `age` turns the fractional-age test red
- `npm run lint` and `npm run build` pass

#### Manual Verification:

- Every bound in the table is verified by reading `init_mvp_schema.sql:50-59`, and
  each row's comment names the line it came from
- No value in the file is imported, computed, or otherwise derived from
  `onboarding-schema.ts`
- The `weight_kg` probes are `200.004` / `29.996` / `70.123456`, not values the
  second decimal place can represent
- The `available_days` cases carry the comment stating this is sole-enforcement, not
  parity, and naming B1/B2

---

## Phase 5: Cross-field CHECK truth tables (TDD-able)

**First red test**: *"a measured power-meter profile is derived with a null
`fitness_level`, as `fitness_level_matches_ftp_source` requires."*

### Overview

Pin the three CHECK constraints that have **no zod counterpart** and are upheld
entirely by two hand-written functions. Oracle: the CHECK text in the migration
(`:60-69`), plus the derivation contract stated in `toProfileInsert`'s own docblock
(`onboarding.ts:4-8`) and `applyRenewal`'s (`renewal.ts:8-12`). This automates
`onboarding-wizard/reviews/plan-review.md:22`'s "4/4 derivation paths satisfy DB
CHECK constraints ✓" — a verification done by reading, once, and never re-run.
Pre-designed assertions for two of these three constraints already exist unused in
`data-schema-and-rls/plan-brief.md:74`, where pgTAP was deferred.

### Changes Required:

#### 1. CHECK predicates and the derivation table

**File**: `src/lib/onboarding.test.ts` (new)

**Intent**: Transcribe the three cross-field CHECKs as predicate functions and assert
every derivation output satisfies all three. Transcribing the SQL is what keeps this
out of mirror-implementation territory: asserting `ftp_source === "estimated"`
field-by-field would just restate `toProfileInsert`'s own `switch`, whereas a
predicate read off the DDL is an independent oracle.

**Contract**: Three local predicates transcribed from `init_mvp_schema.sql:60-69`,
each with the SQL quoted in a comment above it:

- `power_meter_requires_ftp` — not a power meter, or both `ftp_watts` and
  `ftp_source` are non-null;
- `hrm_requires_max_hr` — not an HRM, or `max_hr` is non-null;
- `fitness_level_matches_ftp_source` — exactly one of (`ftp_source` is `measured`
  and `fitness_level` is null) / (`ftp_source` is not `measured` and `fitness_level`
  is non-null). Note the SQL uses `IS NOT DISTINCT FROM`, so a null `ftp_source`
  takes the second branch and **requires** a non-null `fitness_level`.

Then one `it.each` over the four derivation branches asserting all three predicates
hold on every `toProfileInsert` output — twelve assertions from one table.

Also cover:

- **the reachable FTP clamp**: an advanced 200 kg input derives `3.7 × 200 = 740`,
  clamped to 600, satisfying `profiles_ftp_range` (`:52`). The oracle is the DB
  range, not `onboarding.ts`'s constants;
- **absence assertion**: the lower clamp is **not** tested, with a comment stating
  it is unreachable — the minimum product is `2.0 × 30 = 60` and 30 kg is the
  minimum weight both layers allow — so a test for it would assert a dead branch.
  Recorded in §7 by Phase 6.

#### 2. Renewal derivation

**File**: `src/lib/renewal.test.ts` (new)

**Intent**: Assert the renewal path upholds the same three CHECKs, and pin its two
documented trust-boundary behaviours.

**Contract**: The same three predicates (imported from a shared test helper or
re-transcribed with the same SQL comment — do not import them from production code)
applied to `applyRenewal`'s `mergedProfile` for a power-meter profile and for an
`hrm` profile. Also cover:

- confirming an FTP promotes `ftp_source` to `measured` **and** nulls
  `fitness_level`, keeping `fitness_level_matches_ftp_source` satisfied
  (`renewal.ts:25-36`);
- `applyRenewal` **throws** when `ftp_watts` is absent on a power-meter profile
  (`renewal.ts:31-33`) — the self-correctness guard that stops a `measured`
  `ftp_source` pairing with a null `ftp_watts`;
- **absence assertion**: `equipment_type` never appears in the returned `update`, for
  any input. The docblock states equipment is read from the stored profile and never
  from the request body (`renewal.ts:10-12`); this is the assertion that keeps that
  true;
- **B5 characterization**: an `hrm` profile renewing with `ftp_watts` present gets an
  `update` carrying no FTP fields — the input is silently discarded with a `200` and
  no feedback (`renewal.ts:25`). Comment names B5 as an open product question, so
  a decision to 400 instead turns this red.

### Success Criteria:

#### Automated Verification:

- `npm test` passes
- Changing `fitness_level: null` to `input.fitness_level` in `toProfileInsert`'s
  measured branch (`onboarding.ts:56`) turns the
  `fitness_level_matches_ftp_source` row red
- Changing `max_hr: input.max_hr` to `null` in the `hrm` branch
  (`onboarding.ts:75`) turns the `hrm_requires_max_hr` row red
- Changing `ftp_source: "estimated"` to `null` in the estimated branch
  (`onboarding.ts:69`) turns the `power_meter_requires_ftp` row red
- Removing `update.fitness_level = null` (`renewal.ts:36`) turns the renewal
  CHECK test red
- `npm run lint` and `npm run build` pass

#### Manual Verification:

- Each predicate has the CHECK's SQL quoted above it, and the transcription is
  verified against `init_mvp_schema.sql:60-69` by reading
- No predicate is imported from `onboarding.ts` or `renewal.ts`, and no expectation
  is computed by calling the function under test
- The `IS NOT DISTINCT FROM` null semantics are handled correctly — a null
  `ftp_source` requires a non-null `fitness_level`
- No test asserts the unreachable lower FTP clamp

---

## Phase 6: Cookbook and deferred-gap recording

### Overview

Make the rollout state on disk match reality and give every untested finding an
owner, so it lives somewhere more durable than a research document. This is the
phase that closes §3 Phase 1.

### Changes Required:

#### 1. Cookbook §6.2

**File**: `context/foundation/test-plan.md` §6.2

**Intent**: Replace the TBD with the pattern this change actually established.

**Contract**: §6.2 gains: the equipment-variant factory convention and **why**
`makeProfile` is extended rather than made to derive; the both-directions rule with
exact-equality on issue codes (never `toContain`) as its mechanism; the
valid-wrong-kind requirement and the `schema`-short-circuit trap that forces it; the
assert-through-the-validator constraint for module-private constants; the
legend-agreement pattern of binding two independent sources to one shared literal;
and — for parity tables — the rule that bounds are literals traced to the migration
and never imported from the schema under test, plus the predicate-transcription
technique for cross-field constraints. Leave §6.3–§6.5 as TBD.

#### 2. Deferred gaps

**File**: `context/foundation/test-plan.md` §7

**Intent**: Record every finding this change deliberately does not test, each with
the question that blocks it and a re-evaluation trigger — the difference between an
accepted exclusion and a forgotten one.

**Contract**: §7 gains a B-series block (question ids referring to this change's
`research.md`), each entry naming what is not tested, why, and its trigger:

- **`available_days` DB parity** — the DB accepts the empty array (dead
  `array_length` CHECK) and duplicate days; tests assert zod as sole enforcer
  instead. Blocked on **B1/B2**; re-evaluate if the CHECK is repaired or a
  uniqueness constraint is added.
- **`weight_kg` decimal scale** — `numeric(5,2)` rounds before the CHECK; current
  behaviour is pinned, not fixed. Blocked on **B4**; re-evaluate when the
  `km_ridden`-style fix is decided. Note the smallint fractional-input family as the
  same shape.
- **Independent all-segments-share-one-kind enforcement** — exclusivity is
  transitive only, so a wrong `EQUIPMENT_TARGET_KIND` entry would produce a
  uniformly wrong plan that validates; the per-equipment matrix is what catches
  that today. Blocked on **B7**.
- **Read-path revalidation of `plan_sessions.structure`** — the unchecked
  `as PlanSessionView` casts remain; the renderer silently blanks an unknown kind
  and SSR-500s on a malformed target, with no error boundary in the repo. Blocked on
  **B8**; note this is the archive's F6, SKIPPED once already.
- **`formatTarget` and the DOM** — module-private, no jsdom or testing-library, and
  §7 already excludes UI look-and-feel. The legend agreement in Phase 3 covers the
  render-side gap that was real.
- **Route-level rejection behaviour for Risk #6** — that an invalid input returns an
  actionable 400 rather than an opaque 500 is endpoint-level; routed to §3 Phase 2.
- **`estimateFtpWatts`'s lower clamp** — unreachable, not merely untested: the
  minimum product is `2.0 × 30 = 60` against a 30 kg minimum weight. Re-evaluate if
  the weight floor or the W/kg table changes.
- **Renewal's silent discard of `ftp_watts` from non-power-meter users** — pinned as
  characterization, not endorsed. Blocked on **B5**.
- **`max_hr` has no update path outside re-onboarding** — recorded against **B6**.

#### 3. Route B3 into rollout Phase 2

**File**: `context/foundation/test-plan.md` §3 and §7

**Intent**: Give the unguarded `POST /api/onboarding` re-POST a phase, not just a
mention. It is the only finding with a security dimension, and the archive shows
what happens to findings with no owner (F6, SKIPPED and never revisited).

**Contract**: A §7 entry describing the gap — one auth guard and no
already-onboarded check (`api/onboarding.ts:16-49`), missed by the middleware
because the redirect keys on `pathname.startsWith("/onboarding")`
(`middleware.ts:28`) and `/api/onboarding` starts with `/api` — naming **B3**, and
stating the consequence: an already-onboarded user can rewrite every field
`profileEditSchema` withholds, and changing `equipment_type` while a plan is active
desyncs it from the frozen `equipment_at_generation` snapshot, which is Risk #3 as
literally worded reached through the write path. §3 Phase 2's Goal or Risks-covered
cell gains an explicit reference so the endpoint-level regression test has a home.

#### 4. Rollout status

**File**: `context/foundation/test-plan.md` §3, §4, §6.6, §8

**Intent**: Reflect that Phase 1 is finished.

**Contract**: §3 Phase 1 Status advances to `complete` per the fixed vocabulary, and
its Change-folder cell marks both changes implemented. The 2026-09-07 Phase 1 scope
note is updated — it currently says Risks #3 and #6 "are not covered yet" — to
record that they now are, and what within them was deliberately left out. §4's
`unit + integration` row notes that unit now covers Risks #1, #3, and #6. §6.6 gains
two or three lines on what this rollout taught. §8's freshness dates are bumped.

#### 5. Change status

**File**: `context/changes/testing-equipment-mapping-parity/change.md`

**Intent**: Close out the change record.

**Contract**: `status: implemented` and `updated` advanced, with a note that rollout
Phase 1 is complete and which B-series questions remain open.

### Success Criteria:

#### Automated Verification:

- `npm test`, `npm run lint`, `npm run build` all pass
- §6.2 contains no "TBD"
- `grep -n "implementing" context/foundation/test-plan.md` no longer matches the
  §3 Phase 1 row
- Every B-series id B1–B8 appears at least once in `context/foundation/test-plan.md`

#### Manual Verification:

- Each §7 entry names a blocking question **and** a re-evaluation trigger, not just
  an exclusion
- §6.2 carries the valid-wrong-kind trap and the never-import-the-bound rule, the
  two traps most likely to produce a test that passes while asserting nothing
- The B3 entry states the security consequence, not only the missing guard, and §3
  Phase 2 references it
- The §3 Phase 1 scope note reads as an accurate account to someone who wasn't here

---

## Testing Strategy

### Unit Tests:

- **Risk #3, validator face** — three accept cases (Phase 1's coherence guard), six
  reject cases, per-segment isolation, the `schema`-vs-`equipment_mismatch` code
  boundary, and the B7 absence assertion that zod alone permits mixed kinds.
- **Risk #3, legend face** — legend kind and caption per equipment type bound to the
  same target-kind literals, runtime key exhaustiveness, and hrm row count against
  zod's `zone` bound.
- **Risk #6, bounds** — one parameterised table over six numeric ranges (both
  boundary sides each), the four `available_days` rules with zod named as sole
  enforcer, the `weight_kg` rounding characterizations, and the fractional-age case.
- **Risk #6, cross-field** — three SQL-transcribed predicates across four
  `toProfileInsert` branches and both `applyRenewal` paths, the reachable FTP clamp,
  the throw on a missing power-meter FTP, and two absence assertions
  (`equipment_type` never in `update`; the B5 silent discard).

### Key edge cases:

- A structurally valid target of the wrong kind versus a structurally invalid kind —
  different issue codes, and conflating them is how this suite would silently stop
  testing Risk #3.
- Values that round *into* a legal range (`200.004`, `29.996`) versus values the
  column's scale can represent (`200.01`) — only the former expose the divergence.
- A null `ftp_source` under `IS NOT DISTINCT FROM` semantics: it takes the
  *second* branch and requires a non-null `fitness_level`.
- The empty array against a CHECK that evaluates to `NULL` and is therefore
  satisfied.

### Integration Tests:

None in this change. Risk #6's "actionable error" clause and B3's endpoint guard are
route-level and belong to §3 Phase 2.

### Manual Testing Steps:

1. Read `init_mvp_schema.sql:50-69` and check every bound and predicate literal in
   the new test files against it, line by line.
2. Confirm no new test file imports a bound, a mapping, or a predicate from the
   module it tests.
3. For each mutation listed in a phase's Automated Verification: apply it, run
   `npm test`, confirm the named tests go red, revert. §6.1's "prove the test can
   fail" rule — the red run is the deliverable.
4. Confirm the 23 pre-existing assertions in `plan.test.ts` never change.

## Performance Considerations

None. Every test is a pure function call over in-memory fixtures; the suite stays
well inside a single-digit-second run.

## Migration Notes

No migration. Two migration defects were found (the dead `array_length` CHECK and
the absent day-uniqueness constraint) and both are recorded against B1/B2 rather
than fixed — the project is remote-linked with no local Docker stack to rehearse a
migration on, and zod already enforces both rules on every real write path.

## References

- Research: `context/changes/testing-equipment-mapping-parity/research.md`
- Change identity: `context/changes/testing-equipment-mapping-parity/change.md`
- Prior change in this rollout phase: `context/changes/testing-runner-bootstrap/plan.md`
- Rollout state and conventions: `context/foundation/test-plan.md` §2, §3, §6.1, §7
- Risk #3 oracle: `context/archive/2026-06-10-first-plan-generation/plan.md:129(a),159,372`;
  `plan-brief.md:27,30`
- Risk #6 oracle: `context/archive/2026-06-07-onboarding-wizard/plan.md:29,94`;
  `supabase/migrations/20260602182721_init_mvp_schema.sql:50-69`
- `weight_kg` precedent: `context/archive/2026-06-15-session-tracking/reviews/plan-review.md:38-46`
- Unused pre-designed CHECK assertions: `context/archive/2026-05-31-data-schema-and-rls/plan-brief.md:74`
- Worked example to follow: `src/lib/plan.test.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Equipment fixture variants

#### Automated

- [x] 1.1 `npm test` passes and the 23 pre-existing `plan.test.ts` assertions are unchanged — 90d87f1
- [x] 1.2 The coherence guard passes for all three equipment types — 90d87f1
- [x] 1.3 `npm run lint` and `npm run build` pass — 90d87f1
- [x] 1.4 `npx tsc --noEmit` reports no errors in either fixture file — 90d87f1

#### Manual

- [x] 1.5 Every field of the two new profile factories satisfies all nine `profiles` CHECK constraints — 90d87f1
- [x] 1.6 `makeProfile`'s defaults, signature, and docblock are byte-identical to before — 90d87f1
- [x] 1.7 Each new factory's docblock names the constraint forcing each companion field — 90d87f1

### Phase 2: Target-kind exclusivity

#### Automated

- [x] 2.1 `npm test` passes — 63ea53e
- [x] 2.2 Changing `EQUIPMENT_TARGET_KIND`'s `hrm` entry to `"watts"` turns the two hrm matrix rows and the hrm coherence-guard row red (2 red, not 3: the hrm coherence-guard row and the hrm×watts reject row. The hrm×rpe row cannot go red — `rpe` is still ≠ the mutated required kind, so it still rejects. The regression is caught in both directions.) — 63ea53e
- [x] 2.3 Inverting the comparison at `plan.ts:118` turns all six matrix rows red — 63ea53e
- [x] 2.4 Deleting the segment loop at `plan.ts:116-125` turns all six matrix rows red — 63ea53e
- [x] 2.5 `npm run lint` and `npm run build` pass — 63ea53e

#### Manual

- [x] 2.6 Every rejection assertion uses exact-equality on the code list, never `toContain` — 63ea53e
- [x] 2.7 No wrong-kind target in the matrix is structurally invalid — 63ea53e
- [x] 2.8 The B7 absence test comments that a passing `safeParse` is the asserted outcome — 63ea53e

### Phase 3: Legend and target-kind agreement

#### Automated

- [x] 3.1 `npm test` passes — 7c72932
- [x] 3.2 Swapping the `power_meter` and `hrm` entries of `INTENSITY_REFERENCE` turns at least two rows red — 7c72932
- [x] 3.3 Deleting one zone row from the `hrm` table turns the row-correspondence test red — 7c72932
- [x] 3.4 Adding a fourth key to `INTENSITY_REFERENCE` turns the exhaustiveness test red — 7c72932
- [x] 3.5 `npm run lint` and `npm run build` pass — 7c72932

#### Manual

- [x] 3.6 The caption substrings genuinely distinguish `power_meter` from `hrm` — 7c72932
- [x] 3.7 No assertion references a zone percentage — only row counts, kinds, and captions — 7c72932
- [x] 3.8 The target-kind literals match Phase 2's and cite the same oracle line — 7c72932

### Phase 4: zod↔DB bounds parity

#### Automated

- [x] 4.1 `npm test` passes — 71758ab
- [x] 4.2 Relaxing any single bound in `onboarding-schema.ts` by one step turns exactly that row red — 71758ab
- [x] 4.3 Deleting the uniqueness `.refine` turns the duplicate-days test red — 71758ab
- [x] 4.4 Deleting `.min(1)` on `available_days` turns the empty-array test red — 71758ab
- [x] 4.5 Deleting `.int()` from `age` turns the fractional-age test red — 71758ab
- [x] 4.6 `npm run lint` and `npm run build` pass — 71758ab

#### Manual

- [x] 4.7 Every bound is verified against `init_mvp_schema.sql:50-59` and cites its line — 71758ab
- [x] 4.8 No value is imported, computed, or derived from `onboarding-schema.ts` — 71758ab
- [x] 4.9 The `weight_kg` probes are `200.004` / `29.996` / `70.123456` — 71758ab
- [x] 4.10 The `available_days` cases state this is sole-enforcement, not parity, and name B1/B2 — 71758ab

### Phase 5: Cross-field CHECK truth tables

#### Automated

- [x] 5.1 `npm test` passes — c482732
- [x] 5.2 Nulling `fitness_level` handling in the measured branch turns the `fitness_level_matches_ftp_source` row red — c482732
- [x] 5.3 Changing `max_hr` to `null` in the `hrm` branch turns the `hrm_requires_max_hr` row red — c482732
- [x] 5.4 Changing `ftp_source` to `null` in the estimated branch turns the `power_meter_requires_ftp` row red — c482732
- [x] 5.5 Removing `update.fitness_level = null` turns the renewal CHECK test red — c482732
- [x] 5.6 `npm run lint` and `npm run build` pass — c482732

#### Manual

- [x] 5.7 Each predicate quotes its CHECK's SQL and is verified against the migration — c482732
- [x] 5.8 No predicate is imported from `onboarding.ts` or `renewal.ts` — c482732
- [x] 5.9 The `IS NOT DISTINCT FROM` null semantics are handled correctly — c482732
- [x] 5.10 No test asserts the unreachable lower FTP clamp — c482732

### Phase 6: Cookbook and deferred-gap recording

#### Automated

- [x] 6.1 `npm test`, `npm run lint`, `npm run build` all pass
- [x] 6.2 §6.2 contains no "TBD"
- [x] 6.3 The §3 Phase 1 row no longer reads `implementing`
- [x] 6.4 Every B-series id B1–B8 appears at least once in `context/foundation/test-plan.md`

#### Manual

- [x] 6.5 Each §7 entry names a blocking question and a re-evaluation trigger
- [x] 6.6 §6.2 carries the valid-wrong-kind trap and the never-import-the-bound rule
- [x] 6.7 The B3 entry states the security consequence and §3 Phase 2 references it
- [x] 6.8 The §3 Phase 1 scope note reads as an accurate account to someone who wasn't here
