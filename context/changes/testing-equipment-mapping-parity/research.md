---
date: 2026-09-07T23:15:00+02:00
researcher: Dawid Mieszczak
git_commit: 1e79efafa0eb7965bd9214fcc242c04b89125721
branch: main
repository: WattWise
topic: "Risk #3 (equipment target-kind exclusivity) and Risk #6 (zod↔DB parity) — oracle and test surface"
tags: [research, codebase, risk-3, risk-6, equipment-mapping, zod-db-parity, profiles, plan-validation]
status: complete
last_updated: 2026-09-07
last_updated_by: Dawid Mieszczak
---

# Research: Risks #3 and #6 — equipment target-kind exclusivity and zod↔DB parity

**Date**: 2026-09-07T23:15:00+02:00
**Researcher**: Dawid Mieszczak
**Git Commit**: `1e79efa`
**Branch**: main
**Repository**: WattWise

## Research Question

Ground rollout Phase 1's two remaining risks from `context/foundation/test-plan.md` §2,
both explicitly outside `testing-runner-bootstrap`'s research scope:

- **Risk #3** — a cyclist sees intensity targets that do not match their declared
  equipment (an HRM user shown watts, a power-meter user shown RPE).
- **Risk #6** — onboarding or renewal input is accepted by the server that the
  database rejects: an opaque error, or a profile stored in a shape the plan
  generator cannot interpret.

Establish the oracle for each from sources, locate the real failure path, and
identify the cheapest test layer that yields signal.

## Summary

**Both risks are testable, and — unlike Risk #1's zone clause — both have a
defensible oracle stated in the sources.** That is the headline: this change is
not blocked the way the zone/%FTP clause was.

**Risk #3 has a strong, four-times-stated oracle and zero test coverage.** The
mapping `power_meter→watts`, `hrm→hr_zone`, `none→rpe` is declared the "single
source of truth" and the rejection-not-coercion rule is explicit
(`first-plan-generation/plan-brief.md:30`: "coercion = silently wrong numbers").
The validator honours it. But the risk has **two faces**, and only one is real:

- **The render face is safe by construction.** There is exactly one formatter,
  `formatTarget` (`PlanView.tsx:610-621`), an exhaustive `switch` on
  `target.kind` that never reads a unit-specific field outside its matching
  case. It **cannot** mislabel `hr_zone` data as watts. The literal risk
  wording is not reachable through the renderer.
- **The write/persist face is real and unguarded in three distinct ways** —
  zod permits mixed kinds, the provider schema does not constrain kind at all,
  and the renderer trusts unvalidated DB JSONB. Details in Findings §1.

**Risk #6's premise is inverted by the evidence.** The risk is worded as "input
accepted by the server that the database rejects" — zod looser than the DB. On
the `profiles` path there is **no confirmed instance of that direction reaching
SQL today**. The real findings run the other way: zod is *stricter* than the DB
in two places, and in one of them **the DB constraint is dead code**. Risk #6's
genuine, oracle-backed instance is a `numeric(5,2)` rounding divergence on
`weight_kg` — the exact failure mode the archive already hit once on a different
table, fixed there, and never re-checked here.

**A third finding falls outside both risks but was reached independently by
three lines of investigation and is recorded here rather than dropped:**
`POST /api/onboarding` is an unguarded full-row profile rewrite (Findings §3).

## Detailed Findings

### 1. Risk #3 — where equipment binds to target kind

#### 1.1 The mapping and its enforcement

`EQUIPMENT_TARGET_KIND` (`src/lib/plan.ts:23-27`) is a
`Record<EquipmentType, PlanTargetKind>`, so it is **exhaustive over the union at
compile time**, and all three members are present. Its comment (`:20-22`) calls
it "the single source of truth for that mapping; both the prompt and the
validator derive from it."

It is **not exported**. `grep` finds it only at `plan.ts:23,80,169`. A test must
therefore assert **through `validateGeneratedPlan`**, never against the map
directly — the same constraint `testing-runner-bootstrap/research.md:334-338`
recorded for `WEEKDAY_BY_OFFSET` and `WEEKEND_DAYS`.

Enforcement is at `plan.ts:117-124`: **per-segment**, inside the per-session
loop, emitting `code: "equipment_mismatch"`. `requiredKind` is computed once per
plan at `:80`. Issues **accumulate**; the function returns only after the full
loop (`:127-130`).

**It compares kind only, never value.** A `watts` target of 20 W for a 250 W-FTP
athlete passes. (Consistent with `testing-runner-bootstrap/research.md:200-202`.)

#### 1.2 Three independent gaps in the exclusivity guarantee

**(a) zod permits mixing kinds.** `targetSchema` (`plan-schema.ts:44-51`) is a
discriminated union whose only `.refine` is the low ≤ high range check. There is
**no `superRefine`, no cross-segment or cross-session constraint anywhere in the
file**. A payload with `watts` in segment 1 and `rpe` in segment 2 of the same
session parses clean. Exclusivity is stated only in a comment
(`plan-schema.ts:19-20`) and enforced solely — and only transitively — by
`validateGeneratedPlan` requiring every segment to equal one profile-derived
kind. Nothing enforces "all segments share one kind" independently of the
profile, so a *uniformly wrong* plan would pass if the map were ever wrong.

**(b) The provider schema does not constrain kind.** `PLAN_JSON_SCHEMA`
(`plan-schema.ts:139-193`) exposes `target: { anyOf: [watts, hr_zone, rpe] }`
(`:173-175`). It is a **module-level const with no athlete parameterization**,
passed verbatim by both routes (`generate.ts:74`, `renew.ts:111`). All three
variants stay structurally legal for every athlete, per segment. The model is
**only softly steered**, by prompt prose (`plan.ts:180`: "Every segment of every
session must use this one kind — never mix kinds").

**(c) An unknown kind is a `schema` issue, not `equipment_mismatch`.** zod's
discriminated union rejects it first (`plan.ts:67-76` short-circuits), so the
issue code differs by *how* the kind is wrong. This is a direct test-design
constraint: a wrong-but-valid kind yields `equipment_mismatch`; a garbage kind
yields `schema`.

#### 1.3 Nothing repairs a mismatch — confirmed across the whole pipeline

Traced and clean at every stage: validator (`plan.ts:66-131`, pure read), both
routes (`generate.ts:87-92`, `renew.ts:124-129` — `continue` on failure, no
coercion), the OpenRouter client (`openrouter.ts:182-196`, `JSON.parse` only),
the renewal merge (`renewal.ts:14-41` — `equipment_type` never in `update`), row
mapping (`plan.ts:270`, segments pass byte-for-byte), and persistence
(`services/plan.ts:139-197`, inserts `structure` as-is).

The retry re-sends an **identical** prompt with no issue feedback, capped at
`MAX_GENERATION_ATTEMPTS = 2` (`generation.ts:16`); issues are never logged.

#### 1.4 The render path — safe formatter, unsafe input

`formatTarget` (`PlanView.tsx:610-621`) is the **only** target formatter in the
codebase. Exhaustive `switch`, no `default`, no fallthrough; every unit-specific
field is read inside its matching case. `SessionHistory.astro` renders no
intensity at all (`:40-49`).

But three things weaken what that safety is worth:

1. **The rendered data is unvalidated DB JSONB.** `services/plan.ts:77-85` casts
   with `as PlanSessionView` and no `safeParse`; repeated at `:117-119`. The
   soundness argument lives in a comment ("every persisted session passed
   `validateGeneratedPlan`") — an assumption about *current writers*, not an
   enforced invariant. The DB constraint behind it is shape-only:
   `jsonb_typeof(structure) = 'object' and structure ? 'segments'`
   (`init_mvp_schema.sql:161-163`). This is the same gap
   `first-plan-generation/reviews/impl-review.md:85-93` (F6) recorded and
   **SKIPPED** for MVP.
2. **Targets and legend come from different sources.** Targets render the stored
   `kind`; the legend renders `INTENSITY_REFERENCE[plan.plan.equipment_at_generation]`
   (`PlanView.tsx:195`, `:553-556`). Nothing asserts they agree — watts targets
   can appear under a "Heart-rate zones (% of max HR)" caption.
3. **Off-nominal input degrades badly.** An unknown/absent `kind` falls through
   the switch to an implicit `undefined` (tsconfig extends `astro/tsconfigs/strict`,
   not `strictest`, so `noImplicitReturns` is off) → **silent blank**. A null
   `target` or non-array `segments` throws during SSR with no error boundary in
   the repo → **`/dashboard` 500s entirely**.

### 2. Risk #6 — zod↔DB parity on `profiles`

#### 2.1 The oracle is stated, and it is the database

`2026-06-07-onboarding-wizard/plan.md:29`:

> The DB CHECK constraints (`init_mvp_schema.sql:60-69`) are the **source of
> truth** for the branching logic — **the zod schema and the wizard must mirror
> them**, and a server-side upsert is the final guardrail.

Reinforced at `plan.md:94` ("Bounds must match `init_mvp_schema.sql:50-59`
exactly") and restated by two later passes (`plan-renewal/research.md:120,187`).
For `profiles`, **only one direction is ever stated: DB is source of truth, zod
mirrors it.** No ambiguity, no product decision needed. Contrast Risk #1's zone
clause, which had no oracle at all.

#### 2.2 Parity is three layers, not two

Between zod and the database sits a **derivation layer**: `toProfileInsert`
(`src/lib/onboarding.ts:37-86`), whose docblock (`:4-8`) states its rules
"mirror the `profiles` CHECK constraints … and must run server-side before the
upsert so a tampered request body can never violate them." It sets `ftp_source`,
nulls or fills `fitness_level`, and clamps FTP to 50–600 per equipment branch.
`applyRenewal` (`renewal.ts:14-40`) does the same for the renewal path.

**Three CHECK constraints have no zod counterpart on at least one write path**
and are upheld entirely by these two hand-written functions:
`power_meter_requires_ftp` (`M:60-62`), `hrm_requires_max_hr` (`M:63-65`),
`fitness_level_matches_ftp_source` (`M:66-69`).

A test asserting only "zod bound == DB bound" would therefore **miss where the
enforcement actually lives**. A test that re-derives the expected value using
`toProfileInsert`'s own logic would be the mirror-implementation anti-pattern.
The correct oracle: the CHECK truth tables, read from the migration.

#### 2.3 The DB is looser than zod in two places — one of them by accident

**`available_days` minimum-of-1 is dead code.** `array_length('{}'::text[], 1)`
returns `NULL`; `NULL between 1 and 7` is `NULL`; a CHECK evaluating to `NULL`
is **satisfied**. The empty array also trivially satisfies `<@`. So
`available_days = '{}'` is **accepted by the database** despite
`init_mvp_schema.sql:56-59` appearing to forbid it. zod's `.min(1)`
(`onboarding-schema.ts:28-34`) is the only thing preventing it. Downstream,
`validateGeneratedPlan` would have no legal day to schedule against.

**Day uniqueness is not a DB constraint.** `<@` is subset containment, so
`['mon','mon','mon']` passes `M:57` and `array_length` = 3 passes `M:58`. Only
zod's `.refine((days) => new Set(days).size === days.length)` rejects it. Seven
duplicated `'mon'` entries would store as a "valid 7-day week".

For these two fields the database **cannot** be the oracle, because it is the
looser layer. A parity test written as "the server rejects exactly what the DB
rejects" would assert the wrong thing in both cases. See open questions B1/B2.

#### 2.4 The one genuine Risk-#6-shaped divergence: `weight_kg` rounding

`profiles.weight_kg` is `numeric(5,2)` (`M:40`) with CHECK `between 30 and 200`
(`M:51`). **Postgres rounds before the CHECK runs**, so:

- `200.004` → stores `200.00` → **DB-legal**, but zod's `.max(200)` rejects it.
- `29.996` → stores `30.00` → DB-legal, zod-illegal.
- `70.123456` → passes zod, **silently truncated to `70.12`** — the echoed value
  is not the submitted one.

`onboarding-schema.ts:8-9` claims the bounds "mirror the CHECK constraints
exactly." For this column they do not.

**This has a precedent in the archive, which is what makes it oracle-backed
rather than speculative.** `session-tracking/reviews/plan-review.md:38-46` (F2)
found exactly this on `km_ridden numeric(5,2)`: "a value like 499.999 passes zod
yet rounds to 500.00 at the column → CHECK violation → the route returns a
generic 500 instead of a clean 400 … **it's a zod/DB mismatch**." Decision:
**FIXED**. The historical pass notes that `profiles.weight_kg` is the same type
and **no document records the same analysis being applied to it**.

Two independent methods converged here: the parity agent derived the divergence
from the column type; the historical agent found the precedent and the gap.

#### 2.5 Cross-path inconsistencies

- **`ftp_watts` requiredness differs by path.** Required in onboarding's
  `knows_ftp:true` branch (`onboarding-schema.ts:64,97`); `.optional()` at
  renewal (`renewal-schema.ts:22`). The gap is closed at route level
  (`renew.ts:83-88`), not by schema — a route-level rule the archive names
  explicitly (`plan-renewal/plan.md:108`).
- **Renewal accepts `ftp_watts` from non-power-meter users and silently discards
  it.** The schema allows it unconditionally; `applyRenewal` reads it only
  inside `if (profile.equipment_type === "power_meter")` (`renewal.ts:25`). An
  HRM user submitting an FTP gets `200` with their input ignored, no feedback.
- **`max_hr` has exactly one write path.** Bounded at onboarding
  (`onboarding-schema.ts:77,112`), present in no other schema. Frozen for the
  profile's lifetime — except via §3 below.

### 3. Outside both risks: `POST /api/onboarding` is an unguarded full-row rewrite

Reached independently by the display agent, the parity agent, and direct
verification in the main context.

`src/pages/api/onboarding.ts:16-49` has exactly one guard — authentication
(`:17-20`) — then calls `upsertProfile` with `onConflict: "user_id"`
(`services/profile.ts:30`) using the full row from `toProfileInsert` (`:42-43`).
There is **no already-onboarded check**.

The middleware does not cover it: `PROTECTED_ROUTES` (`middleware.ts:6`) lists
`/onboarding`, and the "already onboarded → keep out" redirect keys on
`pathname.startsWith("/onboarding")` (`:28`) — which **`/api/onboarding` does
not match**, since it starts with `/api`.

Consequences:

1. An authenticated, already-onboarded user can re-POST and rewrite
   `equipment_type`, `ftp_watts`, `max_hr`, `fitness_level`, `age`, `weight_kg` —
   **every field `profileEditSchema` is explicitly designed to withhold**
   (`profile-edit-schema.ts:8-10`: "Excludes equipment / FTP / fitness-level /
   max-HR, which are renewal-only (v2 scope)").
2. Changing `equipment_type` while an active plan exists leaves that plan's
   segments and its frozen `equipment_at_generation` snapshot untouched — so the
   dashboard renders watts targets under a power legend for a now-declared HRM
   athlete. **This is Risk #3 as literally worded** ("targets that do not match
   their *declared* equipment"), reached through the write path rather than the
   renderer.

Not a constraint-parity bug — every CHECK is satisfied by `toProfileInsert`. It
is a **cross-path authorization inconsistency**: a product rule documented in one
schema and enforced nowhere at the storage layer.

## Code References

**Risk #3 — mapping and enforcement**

- `src/lib/plan.ts:23-27` — `EQUIPMENT_TARGET_KIND`, module-private, exhaustive
- `src/lib/plan.ts:80` — `requiredKind` computed once per plan
- `src/lib/plan.ts:117-124` — the per-segment `equipment_mismatch` check
- `src/lib/plan.ts:135-144` — `targetUnitInstruction`, a `switch` with no `default`
- `src/lib/plan.ts:180` — prompt rule 4, "never mix kinds"
- `src/lib/plan-schema.ts:44-51` — `targetSchema`; only refine is low ≤ high
- `src/lib/plan-schema.ts:19-20` — exclusivity stated as a comment only
- `src/lib/plan-schema.ts:173-175` — `anyOf` over all three target kinds
- `src/types.ts:53`, `src/db/database.types.ts:263`, `init_mvp_schema.sql:9` — the 3-member enum, in parity

**Risk #3 — render path**

- `src/components/plan/PlanView.tsx:610-621` — `formatTarget`, the only formatter
- `src/components/plan/PlanView.tsx:195`, `:553-556` — legend from `equipment_at_generation`
- `src/lib/services/plan.ts:77-85`, `:117-119` — unchecked `as PlanSessionView` casts
- `supabase/migrations/20260602182721_init_mvp_schema.sql:161-163` — shape-only `structure` CHECK

**Risk #6 — the oracle (migration)**

- `init_mvp_schema.sql:50-59` — numeric and array bounds
- `init_mvp_schema.sql:56-59` — `profiles_available_days_valid` (min-of-1 is dead code)
- `init_mvp_schema.sql:60-62` — `power_meter_requires_ftp`
- `init_mvp_schema.sql:63-65` — `hrm_requires_max_hr`
- `init_mvp_schema.sql:66-69` — `fitness_level_matches_ftp_source`
- `init_mvp_schema.sql:40` — `weight_kg numeric(5,2)`

**Risk #6 — the server layers**

- `src/lib/onboarding-schema.ts:107-120` — `onboardingInputSchema`
- `src/lib/onboarding-schema.ts:8-9` — the "mirror exactly" claim
- `src/lib/onboarding.ts:37-86` — `toProfileInsert`, the derivation layer
- `src/lib/profile-edit-schema.ts:12` — `profileEditSchema = commonFields`
- `src/lib/renewal-schema.ts:14-23` — `renewalInputSchema`
- `src/lib/renewal.ts:14-40` — `applyRenewal`
- `src/lib/services/profile.ts:13,30,46,63` — the only `profiles` table access
- `src/pages/api/onboarding.ts:16-49` — unguarded upsert route
- `src/middleware.ts:6`, `:28` — `PROTECTED_ROUTES` and the onboarding redirect

## Architecture Insights

**The trust boundary is stated differently for the two tables, and both
statements are correct.** For `plan_sessions.structure`, zod is *the* enforced
trust boundary and the DB CHECKs are a thin backstop
(`first-plan-generation/plan.md:41,49`). For `profiles`, the DB is source of
truth and the schemas mirror it (`onboarding-wizard/plan.md:29`). Different
subjects, not a contradiction — but it means **the two risks need opposite test
postures**: #3 asserts the TypeScript layer *is* the guarantee; #6 asserts the
TypeScript layer *agrees with* an external one.

**Exclusivity is guaranteed transitively, not directly.** Nothing says "all
segments share one kind". The property emerges from every segment being compared
to one profile-derived value. That is sufficient today, but it means a single
wrong entry in `EQUIPMENT_TARGET_KIND` would produce a uniformly wrong plan that
passes every check — which is exactly what a per-equipment-type test catches and
a single-equipment test does not.

**Fail-closed on the validator, fail-silent on the prompt.** If the DB enum ever
gained a value not regenerated into `database.types.ts`,
`EQUIPMENT_TARGET_KIND[value]` → `undefined`, so every segment trips
`equipment_mismatch` and nothing persists — safe. But `targetUnitInstruction`
(`plan.ts:135-144`) is a `switch` with no `default` and no exhaustiveness guard,
so the same condition interpolates `target kind "undefined"` into the system
prompt with no runtime assertion anywhere.

**Three CHECK constraints are enforced by two hand-written functions.** That is a
defensible design, but it relocates the invariant from a declarative layer to
imperative code with no test. The archive verified it by *reading*
(`onboarding-wizard/reviews/plan-review.md:22`: "4/4 derivation paths satisfy DB
CHECK constraints ✓"). Automating that reading is the highest-value part of #6.

## Historical Context (from prior changes)

- `context/archive/2026-06-07-onboarding-wizard/plan.md:29` — **the source-of-truth
  declaration for `profiles`**. The oracle for Risk #6.
- `context/archive/2026-06-10-first-plan-generation/plan-brief.md:27,30` — the
  segment contract and "Hard reject + retry on mismatch (no coercion) … coercion
  = silently wrong numbers". The oracle for Risk #3.
- `context/archive/2026-06-10-first-plan-generation/plan.md:129(a)` — the mapping
  spelled out: `power_meter→watts`, `hrm→hr_zone`, `none→rpe`.
- `context/archive/2026-06-10-first-plan-generation/plan.md:159`, `:372` — the
  manual criterion "**a deliberately mismatched target kind is rejected**",
  ticked at `8b9b866` **with no evidence artifact**. This is precisely the
  assertion this change should automate.
- `context/archive/2026-06-10-first-plan-generation/plan.md:419` — "E2E pass for
  all three equipment types … plans correct and equipment-adapted", `06cbeff`.
- `context/archive/2026-06-10-first-plan-generation/reviews/impl-review.md:85-93`
  — F6, the unchecked `as PlanSessionView` cast, **SKIPPED** for MVP: "revisit if
  a migration ever rewrites `structure` out-of-band."
- `context/archive/2026-06-15-session-tracking/reviews/plan-review.md:38-46` —
  F2, the `numeric(5,2)` rounding defeat on `km_ridden`. **FIXED.** The archive's
  one worked example of the Risk #6 failure mode, found by reading the constraint
  independently — the method this change now applies to `weight_kg`.
- `context/archive/2026-05-31-data-schema-and-rls/plan-brief.md:74` — pgTAP
  deferred (remote-only project), with **pre-designed assertions** including
  "CHECK violations on `power_meter_requires_ftp` and
  `fitness_level_matches_ftp_source`". Those designs are reusable input for #6.
- `context/archive/2026-05-31-data-schema-and-rls/manual-verification.md:115,129,143`
  — the only direct CHECK-constraint evidence in the repo. Covers three
  constraints; **no numeric boundary values, no `hrm_requires_max_hr`, no
  `available_days` check, nothing on the zod side**.
- `context/archive/2026-06-17-profile-editing/plan.md:45` — the editable set
  excludes every column in the cross-field CHECKs, so a partial update "can never
  violate a constraint regardless of the row's equipment branch."
- `context/archive/2026-06-25-intensity-reference/plan.md:19`, `:118` — the
  rendered legend comes from the **plan snapshot**, not the live profile.
- `context/archive/2026-06-18-plan-renewal/research.md:64` —
  "`EQUIPMENT_TARGET_KIND` is the **single source of truth**."

## Related Research

- `context/changes/testing-runner-bootstrap/research.md` — Risk #1. Its
  `:30-34` records the scope agreement that deferred #3 and #6 to this pass. Its
  `:200-202` (kind checked, value not), `:286-299` (the DB checks almost nothing
  inside `structure`), and `:334-338` (constants not exported) are direct inputs
  here. Open questions A1–A9 there remain open and are **not** re-litigated.
- `context/foundation/test-plan.md` §2 (risk map and response guidance), §6.1
  (the unit-test cookbook this change must follow), §7/§7.1 (deferred gaps).

## Open Questions

Numbered **B** to stay distinct from the A-series in
`testing-runner-bootstrap/research.md`.

**Blocking a parity assertion on `available_days`:**

- **B1.** Is the dead `array_length … between 1 and 7` CHECK
  (`init_mvp_schema.sql:56-59`) a migration defect to fix, or accepted with zod
  as the sole enforcement? Until answered, a test cannot assert "DB and server
  agree" on the empty array — they demonstrably do not.
- **B2.** Should day uniqueness be a DB constraint? It is a TypeScript-only
  invariant today, and the DB would store `['mon','mon','mon','mon','mon','mon','mon']`
  as a legal 7-day week.

**Product decisions, non-blocking for the unit tests:**

- **B3.** Is the unguarded `/api/onboarding` re-POST (Findings §3) intended? It
  bypasses the field restriction `profileEditSchema` documents, and can desync a
  live plan from the declared equipment. Security/product call, not a test call —
  but it determines whether Risk #3's write-path face gets a regression test now
  or a fix first.
- **B4.** `weight_kg` `numeric(5,2)` rounding — accept, or fix as `km_ridden` was
  (`session-tracking/reviews/plan-review.md:38-46`)? A test can pin either
  answer; it cannot choose.
- **B5.** Should renewal reject `ftp_watts` from non-power-meter users with a 400
  instead of silently discarding it (`renewal.ts:25`)?
- **B6.** `max_hr` has no update path outside re-onboarding. Intended?

**Design questions surfaced, not blocking:**

- **B7.** Should "all segments share one kind" be enforced in `plan-schema.ts`
  independently of the profile, so a wrong `EQUIPMENT_TARGET_KIND` entry cannot
  produce a uniformly-wrong plan that validates?
- **B8.** Should the read path re-validate `structure` (the SKIPPED F6 from
  `first-plan-generation/reviews/impl-review.md:85-93`), given the renderer
  silently blanks an unknown kind and SSR-500s on a malformed one?

## Recommended Test Surface

Cheapest layer with real signal, per `test-plan.md` §1 principle 1. **All unit** —
consistent with §3 Phase 1's declared test type.

**Risk #3 (high value, low cost — the infrastructure exists):**

1. Per-equipment-type acceptance and rejection, asserted **in both directions**
   over all three types: the required kind passes; each of the other two is
   rejected with `equipment_mismatch`. Six cases from one `it.each`. This is the
   assertion the archive marked done manually with no artifact.
2. Mixed kinds within one session are rejected (gap 1.2a — zod does not catch it).
3. An unknown kind yields `schema`, not `equipment_mismatch` (gap 1.2c) — pins
   the code boundary so a future refactor cannot blur them.
4. **Fixture work is a prerequisite.** `makeProfile` defaults to `power_meter`
   and `makeSegment` only builds `watts` targets
   (`__fixtures__/plan-payload.ts:39-41`, `profile.ts:42`). DB-coherent `hrm` and
   `none` profiles need their companion fields passed explicitly — see
   `makeProfile`'s docblock and CHECKs `M:60-69`.

**Risk #6 (oracle-backed, but scope it deliberately):**

5. Boundary values for every bounded field, with expected bounds **written as
   literals traced to the migration**, never imported from the schema under test.
6. `toProfileInsert` output asserted against the three cross-field CHECK truth
   tables, for all four derivation paths — automating
   `onboarding-wizard/reviews/plan-review.md:22`'s read-through.
7. `weight_kg` rounding divergence (§2.4) — pins B4 whichever way it is decided.
8. **Do not** assert DB-parity on `available_days` emptiness or uniqueness until
   B1/B2 are answered; the layers genuinely disagree and a test would encode a
   guess as a rule.
