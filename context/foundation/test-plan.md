# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-09-10

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in <area>"
   carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents *what
   could fail* and *why we believe it's likely* — drawn from documents,
   interview, and codebase *signal* (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/migrations/`.

Churn window caveat: the standard 30-day window was empty (last commit
2026-07-25, plan written 2026-08-28). Churn counts below are **full-project
history** (2026-05-20 → 2026-07-25, 70 commits), not 30-day. They describe
where the MVP was reworked most, not where work is happening now.

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the *evidence that surfaced
this risk* — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|---|---|---|---|
| 1 | A structurally valid but semantically wrong AI plan is persisted and ridden — sessions on days the cyclist is not available, durations over their declared cap, or zone percentages that do not match the named zone. | High | High | interview Q1; PRD §Business Logic (zone→%FTP mapping, availability, duration caps); `context/archive/2026-06-10-first-plan-generation/plan.md` (availability/duration refinement exists, verified manually only); hot-spot dirs `src/lib/services/` (14 commits, full history), `src/pages/api/` (11) |
| 2 | A gate regression lets an unauthenticated or expired-plan cyclist reach protected content, or traps a legitimate one in a redirect loop with no way forward. | High | High | interview Q3 (named explicitly as the low-confidence area); hot-spot dir `src/` — top-churn file at 6 commits, full history; PRD §Access Control; `context/archive/2026-06-18-plan-renewal/plan.md` (fail-open gate with loop-guard); `context/archive/2026-06-25-session-history/plan.md` (gate exemption required for a new route) |
| 3 | A cyclist sees intensity targets that do not match their declared equipment — an HRM user shown watts, a power-meter user shown RPE. | High | Medium | PRD §Success Criteria guardrail ("Incorrect values destroy trust"); PRD FR-005; PRD US-01 acceptance criteria; hot-spot dir `src/lib/` (validation-schema files, 4 commits each, full history) |
| 4 | One cyclist's FTP, plan, or session history becomes readable or mutable by another account. | High | Medium | PRD §Non-Functional Requirements ("never visible to or accessible by any other user account"); `context/archive/2026-05-31-data-schema-and-rls/plan.md` (RLS is the sole enforcement; automated pgTAP deferred; two-account check is manual); `context/archive/2026-06-15-session-tracking/plan.md` (cross-account mutation denial relies on RLS); hot-spot dir `src/pages/api/` (11 commits, full history) |
| 5 | A failed or interrupted plan generation leaves the cyclist with no usable plan — the old plan retired, the new one never activated, or a plan with missing sessions. | High | Medium | `context/archive/2026-06-18-plan-renewal/plan.md` (atomic supersede-and-activate; "generation failure leaves old plan active"); `context/archive/2026-06-10-first-plan-generation/plan.md` (crash-safe phased persist, one-active-plan invariant, idempotent return-existing); hot-spot dir `src/lib/services/` (14 commits, full history) |
| 6 | Onboarding or renewal input is accepted by the server that the database rejects — the cyclist hits an opaque error, or a profile is stored in a shape the plan generator cannot interpret. | Medium | Medium | `context/archive/2026-06-07-onboarding-wizard/plan.md` ("the DB CHECK constraints are the source of truth — the zod schema and the wizard must mirror them"); `context/archive/2026-06-17-profile-editing/plan.md`; hot-spot dir `src/lib/` (validation-schema files, 4 commits each, full history) |
| 7 | The AI provider key or another server-only credential reaches the browser bundle or an error body. | High | Low | `context/foundation/tech-stack.md` (OpenRouter key and model held as server-only config); `CLAUDE.md` (server-only secrets declared in the env schema via `astro:env/server`); PRD §Access Control |

Risks #4 and #7 are the abuse-lens rows: authorization/ownership (#4) and
secret leakage (#7). The product has authentication and accepts user input
on every write path, so at least one abuse row is mandatory; neither
surfaced from the interview, because the happy path excludes the attacker.

Two calibration notes. Interview Q2 returned no past incidents, so **no
risk earns "we have already been burned here"** — the two High-likelihood
ratings rest on churn plus the user's stated low confidence, not on
incident history. And #7 is High × Low: it stays in the map because the
blast radius is financial and the check is nearly free, not because the
surface is believed to be leaking.

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|---|---|---|---|---|---|
| #1 | Given a profile with known availability and duration caps, a plan violating those constraints is rejected, not persisted — and the rejection leaves no partial data behind | "Valid JSON that parses against the schema means the plan is correct" | Where the generated payload crosses from untrusted output into trusted domain data; what the refinement actually rejects versus silently allows; whether rejection happens before or after any write | unit (pure validator over fixture payloads) | Deriving expected zone or duration values by reading the validator — the oracle must come from the PRD's business rules, not from the code under test |
| #2 | An unauthenticated request to a protected route never returns protected content; an expired-plan cyclist reaches renewal and can complete it; no pair of routes can bounce forever | "The redirect fired, therefore the gate is correct" — and the assumption that failing open is safe | Every input to the gate decision (session presence, plan status, route allowlist and exemptions), and the behavior when the state read itself fails | integration (drive the gate with constructed request and session states) | Happy-path-only: exercising logged-in-with-active-plan and never the failure combinations |
| #3 | A power-meter profile yields watt targets and never HR or RPE; an HRM profile yields HR zones and never watts; a no-equipment profile yields RPE only — exclusivity asserted in both directions | "We render the right thing" is not the same claim as "we never render the wrong thing"; absence is the assertion that matters | Where equipment type selects target kind, and whether that selection is exhaustive over the equipment union | unit (mapping exercised over all three equipment types) | Asserting only the presence of the correct target — a bug adding watts alongside HR zones would pass |
| #4 | A second account's request for another user's plan, sessions, or profile returns nothing — for reads and writes, on every data-touching endpoint | "RLS is enabled, therefore we are isolated" — and that a 404 proves denial rather than a coincidentally empty result | Which database client and key each endpoint uses, whether any path bypasses the user-scoped client, and what an authorization denial looks like versus an empty result | integration (two real accounts against the linked project) | Testing isolation on one endpoint and generalizing; asserting a status code without first confirming the target row genuinely exists for the other user |
| #5 | After a generation failure at any stage, the cyclist still has exactly one usable plan and can retry — never zero plans, never a plan with no sessions | "The response was an error, so nothing was written" | The write ordering and which steps are atomic; the one-active-plan invariant; what the retry path does when it meets partial state | integration (drive the persist path with an injected failure at each stage) | Covering only the fully-successful and fully-failed paths, skipping the interrupted-midway case the phased persist exists for |
| #6 | Every value the database would reject is rejected by the server first with an actionable error, and every value the product considers valid is accepted | "The schema and the constraints were written together, so they agree" | The constraint set as it exists in the applied migration, and which layer is the declared source of truth | unit (parity over boundary values drawn from the constraint set) | Copying the expected boundaries out of the validation schema — the oracle must be the database constraints, read independently |
| #7 | No server-only credential appears in any client-served build output | "It is declared server-only, so it cannot leak" — one island importing it the wrong way defeats that | Which values are declared server-only, and how client bundles are emitted by the build | gate (scan of build output) | Scanning source instead of build output; checking a single bundle instead of everything shipped |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|---|---|---|---|---|---|
| 1 | Runner bootstrap + trust-boundary units | Stand up a test runner on the workerd-targeted stack and prove the AI trust boundary and equipment mapping reject what they must | #1, #3, #6 | unit | complete | `context/changes/testing-runner-bootstrap/` (#1, implemented); `context/changes/testing-equipment-mapping-parity/` (#3, #6, implemented) |
| 2 | Gate and plan-lifecycle integration | Prove the access/renewal gate and the generation-persist lifecycle behave under failure, not only on the happy path | #2, #5; plus two endpoint-level residues handed over by Phase 1 — the regression test for the `POST /api/onboarding` re-POST guard, shipped 2026-09-10 (**B3**, a Risk #3 write-path face) and Risk #6's "actionable 400, not an opaque 500" clause. See §7. | integration | change opened | `context/changes/testing-gate-plan-lifecycle/` |
| 3 | Cross-account isolation | Prove one cyclist cannot read or mutate another's data on any data-touching endpoint | #4 | integration | not started | — |
| 4 | E2E critical flows + gate wiring | Cover the crossings cheaper layers cannot reach, and wire every gate in §5 including the build-output secret scan | #7, residual #1–#3 | e2e, gates | not started | — |
| 5 | AI-native plan-quality review (conditional) | Judge whether a generated plan is a coherent block for the stated goal — the part of #1 with no deterministic oracle; skip if Phase 1 closes #1 | residual #1 | AI-native review | not started | — |

**Status vocabulary** (fixed — parser literals):

| Value | Meaning |
|---|---|
| `not started` | No change folder for this rollout phase yet. |
| `change opened` | `context/changes/<id>/` exists with `change.md`; research not done. |
| `researched` | `research.md` exists in the change folder. |
| `planned` | `plan.md` exists with a `## Progress` section. |
| `implementing` | Progress section has at least one `[x]` and at least one `[ ]`. |
| `complete` | Progress section is fully `[x]`. |

Phase order is cheapest-first and dependency-driven. Phase 1 must run first
because no runner exists; Phases 2 and 3 both need it. Phase 3 is separated
from Phase 2 because it needs two real accounts against the linked remote
project — a setup cost that should not stall the gate work. Phase 5 is
conditional: if Phase 1 shows the deterministic refinement already closes
Risk #1, mark Phase 5 `complete` with a one-line skip note rather than
building it. An AI-native layer that duplicates a deterministic check is a
cost with no signal. **Partly superseded — see §7.1:** Phase 1 has landed and
Risk #1 is *not* closed, but the residue is not the AI-judgment problem Phase 5
was designed for, so Phase 5 is neither skipped as `complete` nor started.

**Phase 1 scope note (updated 2026-09-09 — phase complete).** This rollout
phase ran as two changes against one risk set, and what it covers is narrower
than "#1, #3, #6" reads.

`context/changes/testing-runner-bootstrap/` (2026-09-07) landed the Vitest
runner, the fixture factories, and units covering Risk #1's two *testable*
clauses — availability containment and duration caps — plus the
reject-don't-repair contract that makes them meaningful. It did **not** close
Risk #1: the zone/%FTP correspondence the risk names has no oracle to assert
against (the sources disagree on five zones versus seven), and plan completeness
is stated nowhere. Both are recorded in §7 against **A1–A5**, and §7.1 explains
why that residue does not belong to §3 Phase 5 either. Risks #3 and #6 were
outside its research scope, which is why this phase read `implementing` rather
than `complete` at that point — not because the shipped work was partial.

`context/changes/testing-equipment-mapping-parity/` (2026-09-09) closed the rest.
**Risk #3** is now asserted in both directions across all three equipment types
through `validateGeneratedPlan` — the required kind accepts, each of the two
wrong kinds rejects — plus per-segment isolation, the
`schema`-versus-`equipment_mismatch` code boundary, and the render-side gap that
research found real: the intensity legend and the segment targets are read from
two independent sources (`equipment_at_generation` versus the stored
`target.kind`) and nothing asserted they agree. **Risk #6** is now asserted as
numeric bounds parity against the CHECK literals read out of the applied
migration, and as the three cross-field CHECK truth tables that were previously
upheld only by two hand-written derivation functions and verified once by
reading. 120 unit assertions across six files.

**What this phase deliberately left out**, all recorded in §7 with the question
that blocks each: `available_days` DB parity (the DB and zod genuinely disagree
— the emptiness CHECK is dead and duplicates pass, so the tests name zod as sole
enforcer, B1/B2); the `weight_kg` `numeric(5,2)` rounding divergence (pinned as
characterization, not fixed, B4); schema-level all-segments-share-one-kind
enforcement (B7); read-path revalidation of `plan_sessions.structure` (B8, the
archive's F6, now deferred twice); the DOM and `formatTarget` (module-private,
no jsdom); renewal's silent `ftp_watts` discard (B5) and the missing `max_hr`
update path (B6); and two endpoint-level items handed to §3 Phase 2 — Risk #6's
"actionable error" clause and the unguarded `POST /api/onboarding` re-POST
(**B3**), which is Risk #3 reached through the write path.

**No production code changed in either change.** Every defect found was recorded
rather than fixed, by decision; where current behaviour is a known divergence a
test pins it, so the eventual fix meets a red test instead of a silent gap.
Nothing from the A-series was re-litigated.

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.

| Layer | Tool | Version | Notes |
|---|---|---|---|
| unit + integration | Vitest (+ `vite-tsconfig-paths`) | 4.1.11 | Unit only so far; integration is Phase 2. §3 Phase 1 is complete and unit now covers **Risks #1 (partially — see §7 A1–A5), #3, and #6** across `src/lib/plan.test.ts`, `intensity-reference.test.ts`, `onboarding-schema.test.ts`, `onboarding.test.ts`, `renewal.test.ts`, and the fixture coherence guard (120 assertions). Standalone `vitest.config.ts` — **not** Astro's `getViteConfig()`, which is broken on this pin (§6.1). Pinned to 4.1.x deliberately: `@cloudflare/vitest-plugin` peers `vitest ^4.1.0` and does not support 5, so the workerd pool stays available to Phase 2 without a runner migration. Keep `overrides.vite` in `package.json` — it dedupes vite at 7.3.3. Verified green: 2026-09-07 |
| API mocking | none yet — see §3 Phase 2 | — | The only external HTTP edge is the AI provider, called with plain `fetch` and no vendor SDK; mock at that edge, never at internal module boundaries |
| database fixtures | none yet — see §3 Phase 3 | — | Linked remote project only; local Docker stack is disabled, so isolation tests need real accounts rather than a resettable local database |
| e2e | none yet — see §3 Phase 4 | — | Scope is the two critical crossings (onboard→plan, expired→renewal), not page coverage |
| accessibility | none | — | Out of scope for this rollout; see §7 |
| (optional) AI-native | plan-quality review — checked: 2026-08-28 | n/a | When NOT to use: any plan property expressible as a deterministic assertion — availability, duration caps, zone percentages, target-kind exclusivity. Those belong to Phase 1. Reserve this layer for coherence-of-progression judgments that have no closed-form oracle, and never let it gate CI on a non-deterministic verdict |

Current gate is `npm run lint` plus `npm run build` (type-checked through
`@astrojs/check`). Zero test files and no runner configuration exist; all
eight archived slices record manual verification only. This is the baseline
Phase 1 changes.

**Stack grounding tools (current session):**
- Docs: Cloudflare Docs MCP available — usable for workerd runtime and wrangler questions when Phase 1 evaluates runner compatibility; checked: 2026-08-28
- Search: WebSearch and WebFetch available; Context7 and Exa.ai not available in current session; checked: 2026-08-28
- Runtime/browser: no Playwright or browser MCP in current session — Phase 4 must treat e2e tooling as an install, not an available capability; checked: 2026-08-28
- Provider/platform: Cloudflare bindings, builds, and observability MCPs present but unauthenticated; no Supabase or GitHub MCP exposed — Phase 3 cannot lean on a database MCP for fixtures; checked: 2026-08-28

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase N" means the gate is enforced once that rollout
phase lands; before that, the gate is planned.

| Gate | Where | Required? | Catches |
|---|---|---|---|
| lint | local (pre-commit) + CI | required | syntactic and style drift |
| typecheck (`astro build`) | local + CI | required | type drift across the schema, service, and component boundary |
| unit | local + CI | required after §3 Phase 1 | trust-boundary and equipment-mapping regressions |
| integration | local + CI | required after §3 Phase 2 | gate and plan-lifecycle regressions under failure |
| cross-account isolation | CI on PR | required after §3 Phase 3 | one account reaching another's training data |
| e2e on critical flows | CI on PR | required after §3 Phase 4 | broken onboard→plan and expired→renewal crossings |
| build-output secret scan | CI on PR | required after §3 Phase 4 | server-only credentials shipped to the browser |
| post-edit hook | local (agent loop) | recommended, not a CI substitute | regressions at edit time; wired no earlier than §3 Phase 1 |
| visual diff / multimodal review | — | excluded | see §7 — deliberate negative space |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section names the
pattern it will carry.

### 6.1 Adding a unit test

Established by §3 Phase 1 (`context/changes/testing-runner-bootstrap/`);
`src/lib/plan.test.ts` is the worked example.

**Where they live.** Next to the module under test, named `<module>.test.ts`.
The runner collects only `src/**/*.test.ts` (`vitest.config.ts`), so anything
outside that glob is silently ignored. Shared fixtures go in
`src/lib/__fixtures__/` — inside the `@/*` alias, outside the collect glob, and
linted and type-checked like any other source file.

**Running.** `npm test` once, `npm run test:watch` while working, or
`npx vitest run src/lib/plan.test.ts` for a single file. Import `describe` /
`it` / `expect` explicitly from `vitest`; `globals` is deliberately off so
`tsconfig.json`'s `types` array stays untouched and the strict lint rules keep
applying to test files.

**Runner config — do not use `getViteConfig()`.** `vitest.config.ts` is a
standalone `defineConfig` from `vitest/config` with `vite-tsconfig-paths` for
the `@/*` alias, deliberately bypassing Astro's documented testing helper.
`getViteConfig()` runs `astro:config:setup`, which makes the Cloudflare adapter
push `@cloudflare/vite-plugin` into the Vite config; on this version pin that
plugin's workerd SSR environment is incompatible with Vitest's module runner.
**The documented Astro path is the broken one** — following the docs produces
three errors in sequence: a `resolve.external` rejection, then `exports is not
defined`, then `Cannot read properties of undefined (reading
'wrapDynamicImport')`. See https://github.com/withastro/astro/issues/15878.
The fix (astro#17248, merged 2026-07-01) postdates both `astro@6.3.1` and
`@astrojs/cloudflare@13.5.0`. Revisit only after upgrading past it *and* when a
test genuinely needs the Workers runtime or `astro:env` — nothing unit-tested
so far does.

**Fixtures are factories with overrides.** `makeProfile(overrides?)`,
`makePlanPayload(overrides?)`, `makeSession(...)`, `makeSegment(...)` each
return a valid default that the code under test accepts, so a test states
exactly one deviation and a failure names it. `Profile` is the full 15-column
DB row; inlining one per test buries the field actually under test. Three rules
keep the pattern honest:

- Every default sits inside the DB CHECK constraints, so a fixture is a row
  that could really exist.
- Payload factories return `unknown`, mirroring how the validator receives
  `JSON.parse` output. Typing them as the parsed type lets the compiler
  pre-validate the fixture, and the tests stop exercising the untrusted-input
  path they exist to cover.
- One test asserts the un-overridden defaults validate. When it fails, the
  fixtures drifted — not the code.

**The oracle comes from sources, never from the code under test.** Trace every
expected value to a business rule in the PRD, plan brief, or an archived slice
plan, and cite it in a comment. Never compute an expectation with the function
under test: an assertion deriving its weekday by calling `weekdayForDayIndex`
would keep passing if the anchor silently shifted. Where no source states the
rule, do not invent one — record it in §7 and ask.

**Assert absence, not only presence.** A rule that is deliberately *not*
enforced deserves a test pinning that fact — a plan using one of three declared
available days must validate — so nobody adds the rule later without a product
decision.

**Prove the test can fail.** Coverage says a line ran; it does not say a test
would notice if the line broke. Before calling a guardrail test done, break the
guardrail, watch the test go red, and revert. Every assertion in
`plan.test.ts` was landed that way, and the mutations that must turn each one
red are recorded in the plan's Success Criteria so a future reader can re-run
them.

**Weekend-cap fixture constraint.** `max_weekend_minutes` accepts up to 600
while `planned_duration_min` is hard-capped at 360 by both zod and the DB, so
at a weekend cap of 360 or more the `duration_over_cap` branch is unreachable:
zod rejects first and the issue arrives as `schema`. Fixture weekend caps must
stay below 360 (currently 180), or a cap test passes while asserting a
different rule. See §7 and research A6.

### 6.2 Adding an equipment-variant or parity test

Established by §3 Phase 1 (`context/changes/testing-equipment-mapping-parity/`).
Worked examples: `src/lib/plan.test.ts` (exclusivity),
`src/lib/intensity-reference.test.ts` (legend agreement),
`src/lib/onboarding-schema.test.ts` (bounds parity), `src/lib/onboarding.test.ts`
and `src/lib/renewal.test.ts` (cross-field CHECKs). §6.1 still applies in full —
this section adds what equipment variance and layer parity need on top of it.

**Extend the fixture factories; never make them derive.** `makeHrmProfile` and
`makeNoneProfile` (`__fixtures__/profile.ts`) each spell out their companion
fields — `ftp_watts: null`, `ftp_source: null`, `max_hr` set or null,
`fitness_level` non-null — and each docblock names the CHECK constraint that
forces every one of them. They are new factories rather than a smarter
`makeProfile` on purpose: a `makeProfile` that derived companions from
`equipment_type` would be a second implementation of the derivation layer
`onboarding.ts` owns, and the parity tests in §6.2's second half exist precisely
to check *that* layer. Overriding `equipment_type` on `makeProfile` alone leaves
`ftp_watts: 250` / `ftp_source: "measured"` in place, which violates
`fitness_level_matches_ftp_source` — the resulting test would assert against a
row the database could not hold. `makeProfile`'s own defaults and contract stay
byte-identical whenever a variant is added.

**Assert both directions, and use exact equality on issue codes.** "A
power-meter cyclist gets watts" and "a power-meter cyclist never gets HR zones
or RPE" are two different claims; a bug adding watts *alongside* HR zones keeps
every accept-half row green. Cover all three equipment types in each direction,
not one representative — a single wrong `EQUIPMENT_TARGET_KIND` entry produces a
*uniformly* wrong plan that a one-equipment test passes without noticing. The
mechanism that keeps the reject half honest is `toEqual` on the full issue-code
list, never `toContain`: `toContain` still passes when the payload also tripped
the availability, cap, or sum guardrails, and the row then proves only that
*something* was wrong rather than that the equipment rule fired.

**A wrong-kind target must be structurally valid.** To reach
`equipment_mismatch`, pass a well-formed target of a different kind
(`{ kind: "rpe", rpe: 4, description: "…" }` against a power-meter profile). A
garbage kind (`{ kind: "power" }`) is rejected by zod's discriminated union
first and `plan.ts:67-76` short-circuits, so the issue arrives as `schema` — the
test passes while asserting a completely different rule. This is the same shape
as the weekend-cap trap in §6.1, and the code boundary is pinned by its own test
rather than left implicit.

**Assert through the public entry point when the mapping is module-private.**
`EQUIPMENT_TARGET_KIND` (`plan.ts:23-27`) is not exported, so the exclusivity
matrix drives `validateGeneratedPlan` and writes the three kind literals out by
hand from the oracle line. Not exportable is not the same as not testable — and
the hand-written literal is better than an import would be, because a test that
imported the mapping would keep passing if one entry were wrong. The same
constraint was recorded for `WEEKDAY_BY_OFFSET` in the previous change.

**Bind two independent sources to one shared literal.** Where the same rule is
read from two places that never meet in production — the intensity legend comes
from `equipment_at_generation` while targets come from the stored `target.kind`
— the test is a table whose rows carry *one* hand-written mapping and assert
both sources against it. Kind alone is not enough when two variants share it:
`power_meter` and `hrm` both render `kind: "zones"`, so swap their entries and a
kind-only assertion stays green while every HRM cyclist reads heart rates off a
%-of-FTP table. Pick the field that actually separates them (caption substrings
"FTP" versus "max HR"), and add a runtime key-exhaustiveness assertion —
`Record<EquipmentType, …>` is a compile-time guarantee only.

**Parity bounds are literals traced to the migration, never imported from the
schema under test.** Every number in a parity table is read out of
`supabase/migrations/20260602182721_init_mvp_schema.sql:50-69` by hand and
carries the line it came from in a comment. Importing the bound under test is
the mirror-implementation anti-pattern in its purest form: the row passes by
construction and would keep passing after the bound was relaxed. Probe each
bound from both sides using the smallest deviation the *column* can represent —
a `smallint` steps by 1, `weight_kg` is `numeric(5,2)` so it steps by 0.01 — and
remember that Postgres rounds to scale *before* the CHECK runs, so the value
that exposes a divergence is one that rounds **into** range (`200.004`), not one
the scale can hold (`200.01`, rejected by both layers, proving nothing).

**Transcribe cross-field constraints as predicates, not as field
expectations.** The three CHECKs with no zod counterpart —
`power_meter_requires_ftp`, `hrm_requires_max_hr`,
`fitness_level_matches_ftp_source` — live as SQL-quoting predicates in
`__fixtures__/profile-check-constraints.ts`, and every derivation branch of
`toProfileInsert` / `applyRenewal` is fed through all three. Restating a branch's
expected fields (`ftp_source === "estimated"`) would just re-implement the
`switch` in a second place and pass against a bug as happily as against correct
code; a predicate read off the DDL says what the *database* will accept, which
is the thing the derivation layer exists to guarantee. Watch the null semantics:
`is not distinct from` treats `NULL` as comparable, and a `ProfileInsert` may
omit a nullable column rather than set it to `null`, so predicates compare with
`== null` / `!= null` to catch both states. Nothing in the predicate file may be
imported from `onboarding.ts` or `renewal.ts`.

**Where the layers genuinely disagree, assert sole enforcement and say so.** The
`available_days` emptiness and uniqueness rules are enforced by zod only — the
DB CHECK is dead (`array_length('{}'::text[], 1)` is `NULL`, and a CHECK
evaluating to `NULL` is satisfied) and `<@` is subset containment, so seven
`'mon'` entries pass too. Those tests name zod as the sole enforcer in a comment
and cite the blocking question (§7, B1/B2) instead of claiming a parity that
does not exist. Likewise, where current behaviour is a known divergence, pin it
as a characterization with the open question named, so the eventual fix meets a
red test rather than a silent gap.

### 6.3 Adding an integration test

- TBD — see §3 Phase 2. Will carry the mocking policy (external HTTP edge
  only, never internal modules) and the pattern for driving the persist
  path with an injected mid-flight failure.

### 6.4 Adding a test for a new API endpoint

- TBD — see §3 Phase 2, extended by Phase 3. Will carry the request→
  response-plus-side-effect pattern and the mandatory cross-account
  isolation case every new data-touching endpoint must add.

### 6.5 Adding an e2e test

- TBD — see §3 Phase 4. Will carry the criterion for when a flow earns e2e
  instead of integration: only when the failure mode requires the full
  deployed shape.

### 6.6 Per-rollout-phase notes

(Filled in as phases land — two or three lines per phase capturing anything
surprising the rollout taught.)

**Phase 1 — Runner bootstrap + trust-boundary units (2026-09-07).** Two
surprises worth carrying forward. First, the documented path was the broken
one: Astro's own testing docs recommend `getViteConfig()`, which cannot work on
this pin (§6.1), so the config had to be reasoned from primary sources and then
proven with a throwaway smoke test *before* any real assertion was written.
Second, the red run is the deliverable, not the green one — mutating
`plan.ts` to salvage sessions instead of rejecting the plan turned 18 of 23
tests red, which revealed that nearly every earlier assertion routes through
the rejection path while nothing had been pinning that path itself.

**Phase 1, second change — equipment exclusivity + zod↔DB parity (2026-09-09).**
Three things worth carrying forward. First, **the risk's premise was inverted on
one of its two halves**: Risk #6 is worded as "the server accepts what the
database rejects", but on `profiles` zod is *stricter* than the DB in two places
and in one of them the DB constraint is dead code — `array_length('{}'::text[], 1)`
is `NULL`, so a CHECK that appears to forbid the empty array satisfies it.
Research is what caught that; a plan written from the risk wording alone would
have produced parity tests asserting an agreement that does not exist. Second,
**a wrong-kind fixture must be structurally valid or the test silently changes
subject** — a garbage `target.kind` is rejected by zod's discriminated union
first and returns `schema`, not `equipment_mismatch`, so the assertion would
pass while proving nothing. Same shape as the weekend-cap trap from the first
change, which suggests it is the recurring failure mode on this codebase:
guardrails sit behind an earlier gate, and the earlier gate answers first.
Third, **the two most valuable tests came from noticing that two sources are
never compared** — the legend versus the stored target kind, and the CHECK set
versus the derivation layer. Neither gap is visible in either file alone; both
were pure-unit cost once seen.

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **UI look and feel** — no snapshot, visual-diff, or styling assertions.
  Re-evaluate if a rendering regression ever reaches a user unnoticed.
  (Source: Phase 2 interview Q5.)
- **`src/components/ui/` primitives** — vendored shadcn components; the
  upstream project is the test. Re-evaluate if a primitive is forked and
  given project-specific behavior. (Source: Phase 2 interview Q5.)
- **Configuration files** — no assertions on the Astro, wrangler,
  TypeScript, or ESLint configuration; the build is the test. Re-evaluate
  if a config change ever ships a defect the build accepted. (Source:
  Phase 2 interview Q5.)
- **Generated database types** — emitted by the type generator; the
  generator is the test. Re-evaluate if types are ever hand-edited.
  (Source: Phase 1 discovery, stack profile.)
- **Live AI provider calls in CI** — slow, paid, and non-deterministic.
  Generated payloads enter tests as fixtures. Re-evaluate only under §3
  Phase 5, and never as a required gate. (Source: §1 principle 1.)

Added by §3 Phase 1 (2026-09-07). These three are *blocked*, not forgotten —
each names the open question that gates it. Question ids refer to
`context/changes/testing-runner-bootstrap/research.md` §Open Questions.

- **Zone / %FTP correspondence** — nothing asserts that an intensity target
  falls inside a named zone's percentage band, even though Risk #1 names it.
  There is no oracle to assert against: as specified a `watts` target carries
  no zone number, so the failure as worded cannot occur for power-meter users,
  and the sources contradict each other on whether there are five zones or
  seven. Writing the rule here would fabricate exactly the oracle §6.1
  forbids. Blocked on **A1–A3**. Re-evaluate when the zone table and the
  5-vs-7 question are settled by a product decision.
- **Plan completeness** — nothing asserts a minimum number of days, weeks, or
  sessions; a one-session 28-day plan validates today, and a test pins that as
  accepted behaviour rather than a bug. Containment ("sessions only on declared
  days") is stated four times across the sources; coverage ("a session on every
  declared day") is stated nowhere. Blocked on **A4/A5**. Re-evaluate when a
  coverage rule is decided — and note it collides with PRD US-01's "at least
  one session scheduled for the current week" (**A7**), which the next-Monday
  anchor already contradicts.
- **Weekend duration caps between 360 and 600** — unreachable, not merely
  untested. `planned_duration_min` is capped at 360 by both zod and the DB,
  while `max_weekend_minutes` accepts up to 600, so at a weekend cap of 360 or
  above the `duration_over_cap` branch is dead code and an over-cap session
  returns a `schema` issue instead. Fixtures therefore keep the weekend cap
  below 360 (§6.1). Blocked on **A6**. Re-evaluate if either the 600 input
  bound or the 360 session ceiling changes.

Added by §3 Phase 1's second change (2026-09-09), closing Risks #3 and #6.
Question ids refer to
`context/changes/testing-equipment-mapping-parity/research.md` §Open Questions.
Each entry names what is not tested, the question that blocks it, and the
trigger that should bring it back.

- **`available_days` DB parity** — the database accepts what zod rejects here,
  in both directions of the rule. `profiles_available_days_valid`
  (`init_mvp_schema.sql:56-59`) is dead for the empty array:
  `array_length('{}'::text[], 1)` is `NULL`, `NULL between 1 and 7` is `NULL`,
  and a CHECK evaluating to `NULL` is satisfied — so `'{}'` stores. And `<@` is
  subset containment, so `['mon','mon','mon','mon','mon','mon','mon']` stores as
  a legal seven-day week. zod's `.min(1)` and its uniqueness `.refine`
  (`onboarding-schema.ts:28-34`) are therefore the only real guards, and the
  tests assert **zod as sole enforcer** rather than a parity that does not
  exist. Blocked on **B1** (is the dead CHECK a migration defect to fix, or
  accepted?) and **B2** (should day uniqueness be a DB constraint?).
  Re-evaluate if the CHECK is repaired or a uniqueness constraint is added — at
  that point these become real parity rows.
- **`weight_kg` decimal scale** — `numeric(5,2)` (`init_mvp_schema.sql:40`) with
  `check (weight_kg between 30 and 200)` (`:51`): Postgres rounds to scale
  *before* the CHECK runs, so `200.004` is DB-legal (stores as `200.00`) while
  zod's `.max(200)` rejects it, and `70.123456` passes zod and silently
  truncates to `70.12`. Today's behaviour is **pinned as characterization, not
  endorsed** — no fix in this change. The archive found and fixed this exact
  defect on `km_ridden numeric(5,2)`
  (`context/archive/2026-06-15-session-tracking/reviews/plan-review.md:38-46`)
  and no document records the analysis being re-applied to `weight_kg`. Blocked
  on **B4** (accept the rounding, or fix it as `km_ridden` was?). Re-evaluate
  when B4 is decided; the pinned tests then turn red and name the change. The
  `smallint` columns that accept fractional input are the same shape — zod's
  `.int()` is their sole guard — and move with the same decision.
- **Independent all-segments-share-one-kind enforcement** — target-kind
  exclusivity is *transitive only*: `targetSchema` (`plan-schema.ts:44-51`) has
  a single refine (the low ≤ high range check), no `superRefine`, and no
  cross-segment constraint, so a mixed-kind payload parses clean and exclusivity
  emerges only from every segment being compared to one profile-derived value.
  `PLAN_JSON_SCHEMA` does not constrain kind either (`:173-175`, `anyOf` over
  all three). The consequence: a wrong `EQUIPMENT_TARGET_KIND` entry produces a
  *uniformly* wrong plan that validates, which is why the per-equipment matrix
  covers all three types rather than one representative — that matrix is what
  catches it today. Blocked on **B7** (should the schema enforce one kind per
  plan independently of the profile?). Re-evaluate if a `superRefine` is added,
  which would make this assertable at the schema layer for a fraction of the
  cost.
- **Read-path revalidation of `plan_sessions.structure`** — the unchecked
  `as PlanSessionView` casts (`services/plan.ts:77-85,117-119`) stay. Nothing
  re-validates stored structure on read, the renderer silently blanks an unknown
  target kind, a malformed target SSR-500s, and there is no error boundary in
  the repo. Blocked on **B8**. Note this is the archive's **F6**
  (`context/archive/2026-06-10-first-plan-generation/reviews/impl-review.md:85-93`),
  already SKIPPED once — the second deferral is deliberate, not a rediscovery.
  Re-evaluate when B8 is answered, or immediately if a stored plan ever fails to
  render for a user.
- **`formatTarget` and the DOM** — `formatTarget` (`PlanView.tsx:611-621`) is
  module-private, no jsdom or testing-library is installed, and §7 already
  excludes UI look and feel. The formatter is an exhaustive `switch` that never
  reads a unit-specific field outside its matching case, so it is safe by
  construction; the render-side gap that was *real* — the legend and the target
  kind coming from two independent sources — is covered by
  `intensity-reference.test.ts` at pure-unit cost. Re-evaluate only if a
  component-test layer is introduced for another reason, or if `formatTarget`
  gains a branch that reads across kinds.
- **Route-level rejection behaviour for Risk #6** — Risk #6's response guidance
  requires that a value the database would reject is rejected by the server
  first *with an actionable error*. The bounds and cross-field halves are
  covered; the "actionable 400 rather than an opaque 500" clause is
  endpoint-level and needs a request, auth, and a Supabase client. Routed to
  **§3 Phase 2**, which owns the endpoint layer. Re-evaluate there, not here.
- **`estimateFtpWatts`'s lower clamp** — unreachable, not merely untested.
  `Math.max(50, …)` (`onboarding.ts:24`) can never fire: the lowest possible
  product is `2.0 W/kg × 30 kg = 60`, and 30 kg is both zod's and the DB's
  minimum weight. A test for it would be dead code asserting a dead branch. The
  upper clamp *is* reachable (`3.7 × 200 = 740 → 600`) and is tested.
  Re-evaluate if the weight floor or the W/kg table changes.
- **Renewal's silent discard of `ftp_watts` from non-power-meter users** —
  `applyRenewal` (`renewal.ts:25`) drops the field instead of rejecting the
  request. Pinned as characterization, **not endorsed**: the test states that
  today's behaviour is a silent discard. Blocked on **B5** (should renewal
  return a 400 instead?). Re-evaluate when B5 is answered.
- **`max_hr` has no update path outside re-onboarding** — an HRM cyclist whose
  maximum heart rate changes cannot update it except by re-running onboarding,
  which since 2026-09-10 refuses a second POST (B3, below). Recorded against **B6**
  (intended?). No test, because there is no behaviour to pin — the gap is a
  missing path, not a wrong one. Re-evaluate if a profile-edit field is added.
- **Regression test for the onboarding re-POST guard (B3)** — the guard itself
  landed 2026-09-10 (`src/pages/api/onboarding.ts`): an already-onboarded POST
  now returns **409** before the body is parsed, and a profile that cannot be
  read returns 500 rather than allowing the overwrite. The defect it closed was
  Risk #3 reached through the write path — an already-onboarded cyclist could
  rewrite `equipment_type` and desync the live plan from the frozen
  `equipment_at_generation` snapshot the legend renders from. What remains
  negative space is the **test**: it needs a request, a session, and a Supabase
  client, and §4 records API mocking as "none yet — see §3 Phase 2", so writing
  it before that phase would pre-empt its mocking-policy decision. Owned by
  **§3 Phase 2** (see its Risks-covered cell). Assertions it must carry: an
  onboarded user's POST returns 409 and the stored `equipment_type` is
  unchanged; a first-time POST still returns 200; and a failed profile read
  returns 500 rather than writing — that last one is the hermetic-stub case,
  since real infra will not trigger it. Full finding and decision trail:
  `context/changes/onboarding-repost-guard/change.md`. Re-evaluate if any
  profile field becomes writable through a new endpoint, which widens the same
  hole.

### 7.1 Note on §3 Phase 5 (AI-native plan-quality review)

§3 offers Phase 5 an exit: skip it "if Phase 1 shows the deterministic
refinement already closes Risk #1". Phase 1 shows it does **not** close it —
but the exit still should not be taken, and neither should Phase 5 be started,
because the residue is not the kind of problem Phase 5 exists for.

What is left of Risk #1 after Phase 1 is a **missing deterministic rule**
(zones — blocked on a product decision) plus a **missing completeness check**.
An AI-native reviewer would fix neither. It cannot supply a zone table nobody
has decided on, and asked whether a one-session plan is acceptable it would
answer case by case, where the product needs one rule applied the same way
every time. Promoting Phase 5 to absorb this gap would buy a non-deterministic
verdict as a substitute for a product decision — and §4 already warns against
putting this layer on anything expressible as a deterministic assertion.

Phase 5 therefore stays `not started`, to be re-decided once **A1–A4** are
answered. If they are answered, most of the residue becomes deterministic and
belongs in §6.1's unit layer, not here.

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-08-28
- Stack versions last verified: 2026-08-28
- AI-native tool references last verified: 2026-08-28
- Test runner (§4 `unit + integration` row) verified green: 2026-09-09
- Cookbook (§6.1, §6.2) last written against shipped tests: 2026-09-09
- Negative space (§7) last reconciled with research: 2026-09-09 (A-series from
  `testing-runner-bootstrap`, B-series from `testing-equipment-mapping-parity`)

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.

Project-specific trigger: the churn evidence behind Risks #1 and #2 is
full-project history, not a live 30-day window. Once development resumes
and a real 30-day window exists, re-run the scan — likelihood ratings may
move.
