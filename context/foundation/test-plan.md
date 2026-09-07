# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-09-07

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
| 1 | Runner bootstrap + trust-boundary units | Stand up a test runner on the workerd-targeted stack and prove the AI trust boundary and equipment mapping reject what they must | #1, #3, #6 | unit | implementing | `context/changes/testing-runner-bootstrap/` |
| 2 | Gate and plan-lifecycle integration | Prove the access/renewal gate and the generation-persist lifecycle behave under failure, not only on the happy path | #2, #5 | integration | not started | — |
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

**Phase 1 scope note (2026-09-07).** `context/changes/testing-runner-bootstrap/`
has landed a Vitest runner, fixture factories, and units covering Risk #1's two
testable clauses — availability containment and duration caps — plus the
reject-don't-repair contract that makes them meaningful. **Risks #3 and #6 are
not covered yet.** Both share this rollout phase but fell outside the research
scope, and each needs its own research pass before any test asserts on it.
Status is `implementing` for that reason, not because the shipped work is
partial.

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.

| Layer | Tool | Version | Notes |
|---|---|---|---|
| unit + integration | Vitest (+ `vite-tsconfig-paths`) | 4.1.11 | Unit only so far (§3 Phase 1); integration is Phase 2. Standalone `vitest.config.ts` — **not** Astro's `getViteConfig()`, which is broken on this pin (§6.1). Pinned to 4.1.x deliberately: `@cloudflare/vitest-plugin` peers `vitest ^4.1.0` and does not support 5, so the workerd pool stays available to Phase 2 without a runner migration. Keep `overrides.vite` in `package.json` — it dedupes vite at 7.3.3. Verified green: 2026-09-07 |
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

### 6.2 Adding an equipment-variant test

- TBD — see §3 Phase 1. Will carry the pattern for asserting target-kind
  exclusivity across all three equipment types — including the negative
  half (an HRM profile must never produce watts).

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
- Test runner (§4 `unit + integration` row) verified green: 2026-09-07

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.

Project-specific trigger: the churn evidence behind Risks #1 and #2 is
full-project history, not a live 30-day window. Once development resumes
and a real 30-day window exists, re-run the scan — likelihood ratings may
move.
