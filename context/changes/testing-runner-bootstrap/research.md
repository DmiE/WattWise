---
date: 2026-09-07T00:00:00Z
researcher: Dawid Mieszczak
git_commit: 2c52d76da0b883268c9162162cae40ccee851a59
branch: main
repository: DmiE/WattWise
topic: "Risk #1 — a structurally valid but semantically wrong AI plan is persisted and ridden"
tags: [research, codebase, risk-1, trust-boundary, plan-generation, test-runner, vitest]
status: complete
last_updated: 2026-09-07
last_updated_by: Dawid Mieszczak
---

# Research: Risk #1 — semantically wrong AI plan persisted

**Date**: 2026-09-07
**Researcher**: Dawid Mieszczak
**Git Commit**: `2c52d76da0b883268c9162162cae40ccee851a59`
**Branch**: `main`
**Repository**: DmiE/WattWise

## Research Question

Take Risk #1 from `context/foundation/test-plan.md` §2:

> A structurally valid but semantically wrong AI plan is persisted and ridden —
> sessions on days the cyclist is not available, durations over their declared
> cap, or zone percentages that do not match the named zone.

Scope agreed with the user before research began: **Risk #1 only** (Risks #3 and
#6, also in rollout Phase 1, get their own passes appended to this document),
**plus test-runner viability** on the Astro 6 / Vite 7 / workerd stack, since
§3 Phase 1 is "Runner bootstrap + trust-boundary units" and §4 records that no
runner exists and none has been verified against this stack.

## Summary

**Risk #1 has two faces, and only one of them is real.**

The risk names three failure modes. Two are already enforced by a genuine
trust boundary; the third is not enforced, not expressible in the current data
shape, and — critically — **has no oracle in the specification sources**.

| Clause of Risk #1 | Enforced today? | Oracle in sources? | Verdict |
|---|---|---|---|
| Sessions on unavailable days | **Yes** — `plan.ts:90-96` | **Yes** — unambiguous | Regression-guard only |
| Durations over the declared cap | **Yes** — `plan.ts:98-104` | **Yes**, but two spec rules contradict | Regression-guard, with a dead zone |
| Zone percentages not matching the named zone | **No — no check exists** | **No — UNSPECIFIED** | **Blocked: stop and ask** |

The good news is structural and worth stating plainly: `validateGeneratedPlan`
is a real trust boundary. It **rejects whole plans and never repairs them** —
no clamping, no silent session-dropping, no coercion anywhere in the plan
pipeline — and **no database write happens before validation completes** on
either the generate or the renew path. The archived intent ("hard reject,
never coerce", `first-plan-generation/plan-brief.md:30`) matches the shipped
code. That is the opposite of what the risk feared, and it means clauses 1 and
2 need cheap regression tests, not a redesign.

The bad news is the third clause. `profile.ftp_watts` is **never read by the
validator** — it appears in `src/lib/plan.ts` only at `:149-150` (prompt text)
and `:243` (a provenance snapshot). A power-meter athlete with FTP 200 W can be
prescribed a 400–450 W "endurance" segment and the plan validates and persists;
the only bound is a flat, athlete-independent `0..2000` W. The same holds for
HR: `{ zone: 2, low_bpm: 190, high_bpm: 200 }` passes. The prompt tells the
model to derive watts "from the athlete's FTP" (`plan.ts:135-144`) but the code
verifies nothing — this is the sharpest instance in the codebase of *"the
prompt asks for it" ≠ "the code enforces it"*, and the unverified number is the
one that carries the actual training prescription.

And the oracle for fixing it does not exist yet. The PRD offers two example
bands (`prd.md:120`, "e.g. Zone 2 = 56–75% FTP"); the only full zone table in
the repo (`intensity-reference/plan.md:92-96`) is **display copy** whose own
brief says it has "no zone-math" and is "informational context rather than a
direct legend". Worse, the generated `watts` target shape has **no zone field
at all** (`plan-schema.ts:21-25`), so for power-meter users there is no "named
zone" for a percentage to disagree with. **The third clause of Risk #1 cannot
be tested without a product decision** — see Open Questions A1/A2/A3.

Research also surfaced a failure mode adjacent to Risk #1 that the risk map
does not name and that is arguably worse than either enforced clause: **a
one-session plan is a valid "4-week plan"**. `planSchema.sessions` is
`.min(1).max(28)` (`plan-schema.ts:78`), nothing checks per-week distribution,
and `toPlanInsert` writes `end_date = start_date + 27` unconditionally
(`plan.ts:240`), so the plan *row* always claims 28 days regardless of what the
sessions cover. `PlanView.tsx:79` then renders four week-grids under the
heading "Your 4-week plan". That is squarely "structurally valid but
semantically wrong, persisted and ridden."

On tooling: **Vitest 4.1.x with a standalone `vitest.config.ts`** is the
recommendation, and `getViteConfig()` from `astro/config` is **actively
contraindicated on this exact version pin** — verified firsthand, not inferred.

## Detailed Findings

### 1. The pipeline and where the trust boundary sits

`POST /api/plans/generate` (`src/pages/api/plans/generate.ts:21`) → auth gate
(`:21-25`) → read active plan for idempotency (`:33-41`) → read profile
(`:45-53`) → build prompt (`:55` → `plan.ts:168-198`) → anchor `start_date` to
next Monday (`:59` → `plan.ts:221-228`) → 90 s budget (`generation.ts:23`) →
retry loop, max 2 attempts (`generation.ts:16`) → `fetch` OpenRouter with a
strict `response_format.json_schema` (`openrouter.ts:141-152`) → `JSON.parse`
returning `content: unknown` (`openrouter.ts:175-196`) → **trust boundary**
(`:87` → `plan.ts:66`) → map to rows (`plan.ts:236-272`) → persist
(`services/plan.ts:142-211`).

The first point where model output is treated as valid is `src/lib/plan.ts:67`:

```ts
const parsed = planSchema.safeParse(raw);
```

`.safeParse`, not `.parse` — no throw. On failure the issues are mapped to
`{ code: "schema", message }` and returned. **The routes never read `issues`**
(`generate.ts:88-92`, `renew.ts:125-129`): they `continue` the retry loop and,
after both attempts, return a generic 502. Validation failures are never logged
and never surfaced. That is a diagnosability gap, not a correctness one, but it
means a systematic model regression would be invisible in production.

Worth noting for fixture design: `PLAN_JSON_SCHEMA` — the schema sent to the
model (`plan-schema.ts:139-193`) — deliberately carries **no** `minimum` /
`maximum` on integers (rationale at `:97-103`: the Anthropic provider 400s on
strict schemas with min/max on `integer`). Ranges are prose in `description`
only. So the provider-side schema constrains *shape*; **only zod constrains
bounds**. Tests must not assume the provider filters anything numeric.

### 2. Rejection vs. repair — the risk's core fear is unfounded

There is **no repair, clamp, or adjustment logic anywhere in the plan
pipeline**. Every guardrail pushes an issue, and `plan.ts:127-129` discards the
entire payload if any issue exists. Rejection is whole-plan and all-or-nothing:
no session is individually dropped, no value coerced. The only `clamp` in the
codebase is `onboarding.ts:24`, an FTP *estimate* from user input — not model
output.

Two genuinely silent behaviours exist, neither a semantic clamp:

1. **Unknown-key stripping.** `z.object` strips unrecognised keys by default,
   and `validation.plan` (the parsed data) is what reaches `toSessionInserts`
   (`generate.ts:96`) — not `result.content`. Extra model fields are silently
   discarded. In practice `PLAN_JSON_SCHEMA` sets `additionalProperties: false`
   at every level, so this should not fire.
2. **`description` coerced to null.** `plan.ts:269`: `session.description ?? null`.
   `PLAN_JSON_SCHEMA` lists `description` as required (`plan-schema.ts:186`)
   but zod makes it `.optional()` (`:70`) — a missing description passes as
   `null` rather than being rejected.

The retry is "reject then re-ask", not repair: attempt 2 re-sends the
**identical** prompt (`generate.ts:71-77` reuses the messages built once at
`:55`). Nothing about the failure is fed back to the model, so a
deterministically-wrong model output burns both attempts identically.

### 3. Clause-by-clause status

#### (a) Sessions only on declared-available days — ENFORCED

`src/lib/plan.ts:90-96` maps `day_index` → weekday via `weekdayForDayIndex`
(`:37-39`, `["mon"…"sun"][(i-1)%7]`) and rejects with code `unavailable_day` if
the weekday is not in `new Set(profile.available_days)` (`:81`).

The Monday anchor is real, not assumed: `start_date` is always
`nextMonday(...)` (`plan.ts:221-228`, called at `generate.ts:59` and
`renew.ts:96`), so the weekday mapping cannot drift from the prompt's stated
anchoring. The spec is explicit that this non-drift is the point
(`first-plan-generation/plan.md:55`: "the validator maps the same way — the two
cannot drift").

**Oracle: solid and one-directional.** The rule is *containment*, and the
sources state it four separate times (`first-plan-generation/plan.md:27,55,129(b)`,
`plan-brief.md:28,64`). There is **no coverage rule** — nothing requires that
available days actually get sessions.

#### (b) Duration caps — ENFORCED, with an unreachable branch

`src/lib/plan.ts:98-104` selects `max_weekend_minutes` for sat/sun (via
`WEEKEND_DAYS`, `:34`) else `max_workday_minutes`, and rejects with
`duration_over_cap`. Both caps are wired.

**But the weekend branch has a dead zone, confirmed independently by all three
codebase-facing angles and by the spec-only pass:**

| Source | Evidence |
|---|---|
| Spec (no `src/` access) | `max_weekend_minutes` 15–600 vs `planned_duration_min` 15–360 — "two stated rules that cannot both bind" |
| Migration | `profiles_weekend_minutes_range … between 15 and 600` (`init_mvp_schema.sql:55`) vs `plan_sessions_planned_duration_range … between 15 and 360` (`:160`) |
| Implementation | zod caps `planned_duration_min` at 360 (`plan-schema.ts:68`), so `plan.ts:99` can never fire for a weekend cap ≥ 360 |

For any profile declaring a weekend cap of 360–600 minutes, the
`duration_over_cap` check is unreachable — zod rejects first with a `schema`
issue. **A test fixture must use a weekend cap below 360 to exercise that
branch at all.** The workday cap (max 360, `onboarding-schema.ts:35`) is fully
exercisable.

Also enforced alongside: segment sum equals `planned_duration_min`
(`plan.ts:109-115`, `duration_mismatch`) and `day_index` uniqueness
(`plan.ts:85-88`, `duplicate_day`, with a DB backstop
`plan_sessions_plan_day_unique`, `init_mvp_schema.sql:161`).

#### (c) Zone percentages vs. the named zone — NOT ENFORCED, AND NO ORACLE

What is checked is only the **target kind** — the unit, not the value
(`plan.ts:117-124`, `equipment_mismatch`, against `EQUIPMENT_TARGET_KIND` at
`:23-27`). Concretely absent:

- **Watts ↔ FTP: no relationship whatsoever.** `wattsTarget`
  (`plan-schema.ts:21-25`) has no `zone` field, and I confirmed by grep that
  `ftp_watts` appears in `plan.ts` only at `:149-150` (prompt) and `:243`
  (provenance). Bound is `0..2000` W, athlete-independent.
- **HR zone ↔ bpm: no cross-check.** `hrZoneTarget` (`:27-32`) carries both a
  `zone` (1–5) and `low_bpm`/`high_bpm` (30..230), and nothing asserts they
  agree, nor that bpm relates to `profile.max_hr`.
- **`session_type` ↔ intensity: no check.** A `recovery` session with
  max-watt segments validates.
- The only zone→%FTP mapping in the codebase, `intensity-reference.ts:53-87`
  (`Z2 = "56–75%"`, `Z4 = "91–105%"`), is **display-only static copy** never
  imported by `plan.ts`, `plan-schema.ts`, or either route. Its own header
  (`:5-12`) says "NOT per-athlete bounds".

This contradicts the PRD business rule at `prd.md:120`. The mapping is not
encoded anywhere executable — **and it is not in the prompt either**: the
prompt says only "derived from the athlete's FTP" (`plan.ts:135-144`) with no
bands.

**Why this is blocked rather than merely unimplemented.** The spec-only pass
established that the generation contract defines a watts target as a bare
low/high range with no zone number (`first-plan-generation/plan.md:121`), and
the validator contract enumerates exactly four guardrails, none about zones
(`plan.md:129 a–d`). So the failure the risk names — "zone percentages that do
not match **the named zone**" — **cannot occur for power-meter users as
specified**, because no zone is ever named. Writing a test here would require
inventing the rule, which is precisely the oracle violation the lesson forbids.

#### (d) Plan completeness — NOT ENFORCED (and not named by the risk)

The only constraint is `planSchema.sessions: z.array(sessionSchema).min(1).max(28)`
(`plan-schema.ts:78`). **A plan with a single session on `day_index` 1 is fully
valid and will be persisted as an active 4-week plan.** No minimum count, no
per-week distribution check, no assertion that any session falls in weeks 2–4.
Meanwhile `plan.ts:240` writes `end_date = addDays(startDate, 27)`
unconditionally, satisfying the DB's `plans_28_day_window` CHECK
(`init_mvp_schema.sql:113`), and `PlanView.tsx:79` (`const WEEKS = [0,1,2,3]`)
renders all four weeks with the header "Your 4-week plan" (`:156-161`).

The spec-only pass confirms this is a genuine gap and not a rule I am inventing
from the code: the four contracted guardrails contain **no count check and no
coverage check**. The only count evidence anywhere is a single *observed* manual
run (`phase-3-manual-test.md:41-43`, 12 sessions = 3 days × 4 weeks) — treating
that as the oracle would be textbook mirror-testing.

Whether a minimum is *required* is itself an open question (A4/A5), but the
asymmetry is worth naming: unlike the zone clause, this one has a defensible
partial oracle in **PRD US-01** (`prd.md:48`, "at least one session scheduled
for the current week") — which collides with A7 below.

### 4. Write ordering and blast radius

**No write happens before validation completes, on either route.** Steps 3–4 of
the pipeline are reads; the LLM call and `validateGeneratedPlan` both complete
before the first mutation (`generate.ts:87-97`, `renew.ts:124-145` both
`continue` on `!validation.ok`).

Persist is a deliberate three-phase, crash-safe dance
(`services/plan.ts:142-211`): insert `plans` as `status:'pending'` (overriding
`toPlanInsert`'s `'active'`, `plan.ts:241`) → bulk-insert `plan_sessions`, with
`DELETE plans` + FK cascade on failure (`:167`) → flip to `'active'`, with the
`23505` unique-violation branch treated as an idempotent win (`:199-208`).

This means **the risk's phrase "and ridden" is bounded**: a sessionless plan can
never become `active`, because activation is phase 3. The genuine residue is
**orphan `pending` rows** — a crash between phases leaves a `pending` plan that
`getActivePlan` never sees (`services/plan.ts:33`), that the partial unique
index does not count, and that **nothing ever reaps**. That is Risk #5
territory, not #1, but it is the same code path.

The renew path adds a non-atomic seam: `UPDATE profiles` (`renew.ts:134`) and
`persistPlan(..., { supersede: true })` (`:140-145`) are two independent
mutations. The archive states the resulting invariant precisely and accepts it
(`plan-renewal/plan.md:49`): a post-generation persist failure "may leave the
profile updated while the old plan stays active — but this is recoverable".

### 5. What the database actually guarantees

This matters for layer choice: it tells us which invariants a unit test is the
*only* line of defence for.

**`plan_sessions.structure` is opaque JSONB.** The sole constraint
(`init_mvp_schema.sql:161-163`) is:

```sql
constraint plan_sessions_structure_shape check (
  jsonb_typeof(structure) = 'object' and structure ? 'segments'
)
```

That checks two things: the value is an object, and a key literally named
`segments` exists. `{"segments": 42}` and `{"segments": null}` are legal rows.
**Every intensity rule — zone 1–5, low ≤ high, per-segment `duration_min`,
non-empty segments, segments summing to `planned_duration_min` — is a
TypeScript-only invariant.**

That is the single strongest argument for the cheap layer here. The test-plan
already guesses "unit (pure validator over fixture payloads)" as the likely
cheapest layer for #1 (§2 Risk Response Guidance); research confirms it, and
adds the reason: **an integration test would not check more, because the
database checks almost nothing about plan semantics.** Postgres genuinely
guarantees only: one active plan per user (partial unique index, `:117`), the
28-day window (`:113`), `day_index` 1–28 and unique per plan (`:159,161`),
`planned_duration_min` 15–360 (`:160`), enum membership, and per-user RLS.

One adjacent finding, recorded for Risk #2 rather than acted on here:
**`'expired'` is never written by any SQL in the repo.** Expiry is a computed
predicate (`isPlanExpired`, `services/plan.ts:42-45`); an expired plan is
`status='active'` in the database.

### 6. Testability of the target code

`src/lib/plan.ts` has **zero runtime imports** — only `import type` (`:1-2`)
plus `planSchema` (`:3`). It is importable in a plain Node process with no
`astro:env` shim. Same for `src/lib/renewal.ts`. This is the single most
important tooling fact in the research: **the Risk #1 target is trivially
unit-testable.**

Directly testable, no stubs:

| Function | Location |
|---|---|
| `validateGeneratedPlan(raw: unknown, profile: Profile)` | `plan.ts:66` |
| `buildPlanMessages(profile)` | `plan.ts:168` |
| `weekdayForDayIndex(dayIndex)` | `plan.ts:37` |
| `nextMonday(from)` / `addDays(isoDate, days)` | `plan.ts:221` / `:209` |
| `toPlanInsert` / `toSessionInserts` | `plan.ts:236` / `:261` |
| `planSchema` and friends | `plan-schema.ts:44,54,65,77` |

**Not exported** (would need re-export or indirect assertion):
`EQUIPMENT_TARGET_KIND` (`plan.ts:23`), `WEEKEND_DAYS` (`:34`),
`WEEKDAY_BY_OFFSET` (`:33`), `targetUnitInstruction` (`:135`), and the
individual target schemas `wattsTarget`/`hrZoneTarget`/`rpeTarget`
(`plan-schema.ts:21,27,34`).

Entangled with I/O (not Phase 1 targets): `generateStructured`
(`openrouter.ts:90`) imports `astro:env/server` at module scope (`:1`), so that
module cannot be imported at all without an alias or mock.

### 7. Test-runner viability (Astro 6.3.1 / Vite 7.3.3 / workerd)

Installed, from `package-lock.json`: `astro` **6.3.1**, `vite` **7.3.3** (single
deduped copy, forced by `overrides: { "vite": "^7.3.2" }`), `typescript`
**5.9.3**, Node **22.14.0**, `@astrojs/cloudflare` **13.5.0**, `zod` **4.4.3**.
Note the repo is a full major behind upstream (`astro` 7.3.1, adapter 14.3.0) —
and that gap is the direct cause of the landmine below.

**`getViteConfig()` from `astro/config` is contraindicated on this exact pin.**
`withastro/astro#15878` documents a three-layer incompatibility between
`@cloudflare/vite-plugin`'s workerd SSR environment and Vitest's module runner
(Vitest injects Node builtins into `resolve.external`, which the CF plugin's
`configResolved` rejects; CJS deps reach workerd as raw CJS; `@vitest/mocker`
rewrites dynamic imports into an uninitialised hook). It was fixed by
[PR #17248](https://github.com/withastro/astro/pull/17248) (merged 2026-07-01),
which skips the CF/dev-server plugins when `process.env.VITEST` is set.

**That fix is not in this repo — I verified this firsthand rather than taking
it on report:** `grep -rl "process.env.VITEST"` across
`node_modules/astro/dist/` and `node_modules/@astrojs/cloudflare/dist/` returns
nothing, and `@astrojs/cloudflare/dist/index.js:137` unconditionally pushes
`cfVitePlugin(...)` into `vite.plugins` during `astro:config:setup` — which
`getViteConfig()` runs. Both packages published 2026-05-07, before the merge.

This matters beyond convenience: the Astro testing docs *recommend*
`getViteConfig()`, so the obvious path is the broken one. This is exactly the
trap §4 of the test plan warns about ("do not assume a config from another
Astro project transfers").

**`@cloudflare/vitest-pool-workers` is not needed** — and has been renamed to
`@cloudflare/vitest-plugin` (v1.x, since 2026-08-14; the old package is frozen
at 0.22.0). It pins `vitest ^4.1.0` and does **not** support Vitest 5. The
Phase 1 targets touch zero Workers APIs and zero bindings, so booting workerd
per test file is cost with no signal.

**`node:test` + `tsx` is viable but worse here.** Node deliberately does not
read tsconfig `paths` ([Node 22 docs](https://nodejs.org/docs/latest-v22.x/api/typescript.html)),
so every `@/types` import would fail without `tsx` — at which point you have a
dependency anyway, minus `it.each` parameterisation (which §6's cookbook will
lean on to avoid the "redundant copies" anti-pattern), watch mode, and coverage
that maps through the TS transform.

**Recommendation:**

```
npm i -D vitest@^4.1.11 vite-tsconfig-paths@^6.1.1
```

with a **standalone `vitest.config.ts`**, not `getViteConfig()`:

```ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
```

Vitest **4.1.11, not 5.0.0**, for two reasons: Vitest 5 shipped 2026-09-03 (days
ago) with breaking changes (`clearMocks` defaults to `true`; unawaited
`resolves`/`rejects` now fail), and `@cloudflare/vitest-plugin` peers `^4.1.0`
— choosing 5 today would foreclose the workerd pool that Phases 2–4 may want,
without a runner migration. 4.1.11 satisfies vite 7.3.3 (`^6 || ^7 || ^8`) and
Node 22.14.0.

`astro:env` needs no handling in Phase 1 — verified empirically by bundling all
ten candidate `src/lib` modules with the repo's own esbuild and the `@` alias:
all resolved, and `astro:env` appeared in zero output bundles. For a later
phase that *does* need `supabase.ts` or `openrouter.ts`, treat the stub/alias
workaround as an open question: it is a community pattern with no Astro
primary-source documentation.

CI: add one step between lint and build (so a failing test short-circuits the
slower step). **No `SUPABASE_URL`/`SUPABASE_KEY` on the test step** — the build
needs them because `astro build` resolves the `astro:env` schema; a Vitest run
over pure `src/lib` modules never touches it.

Two ESLint notes: `tsconfig.json` includes `**/*` with `strictTypeChecked` and
`projectService: true`, so `*.test.ts` files get type-checked linting
immediately and must compile under `astro build`. Import `describe/it/expect`
explicitly from `vitest` rather than setting `globals: true`, to avoid touching
`tsconfig.json`'s `types`.

## Code References

- [`src/lib/plan.ts:66`](https://github.com/DmiE/WattWise/blob/2c52d76da0b883268c9162162cae40ccee851a59/src/lib/plan.ts#L66) — `validateGeneratedPlan`, the trust boundary
- [`src/lib/plan.ts:90-96`](https://github.com/DmiE/WattWise/blob/2c52d76da0b883268c9162162cae40ccee851a59/src/lib/plan.ts#L90-L96) — `unavailable_day` guardrail (clause a: enforced)
- [`src/lib/plan.ts:98-104`](https://github.com/DmiE/WattWise/blob/2c52d76da0b883268c9162162cae40ccee851a59/src/lib/plan.ts#L98-L104) — `duration_over_cap` guardrail (clause b: enforced, weekend branch partly unreachable)
- [`src/lib/plan.ts:117-124`](https://github.com/DmiE/WattWise/blob/2c52d76da0b883268c9162162cae40ccee851a59/src/lib/plan.ts#L117-L124) — `equipment_mismatch`: checks target *kind* only, never the *value*
- [`src/lib/plan.ts:127-129`](https://github.com/DmiE/WattWise/blob/2c52d76da0b883268c9162162cae40ccee851a59/src/lib/plan.ts#L127-L129) — whole-plan rejection; no coercion
- [`src/lib/plan.ts:149-150`](https://github.com/DmiE/WattWise/blob/2c52d76da0b883268c9162162cae40ccee851a59/src/lib/plan.ts#L149-L150) / [`:243`](https://github.com/DmiE/WattWise/blob/2c52d76da0b883268c9162162cae40ccee851a59/src/lib/plan.ts#L243) — the *only* two uses of `ftp_watts`: prompt text and provenance
- [`src/lib/plan.ts:221-228`](https://github.com/DmiE/WattWise/blob/2c52d76da0b883268c9162162cae40ccee851a59/src/lib/plan.ts#L221-L228) — `nextMonday`, the anchor that makes weekday mapping non-drifting
- [`src/lib/plan-schema.ts:21-25`](https://github.com/DmiE/WattWise/blob/2c52d76da0b883268c9162162cae40ccee851a59/src/lib/plan-schema.ts#L21-L25) — `wattsTarget`: no zone field, flat `0..2000` bound
- [`src/lib/plan-schema.ts:78`](https://github.com/DmiE/WattWise/blob/2c52d76da0b883268c9162162cae40ccee851a59/src/lib/plan-schema.ts#L78) — `sessions` is `.min(1).max(28)`: a 1-session plan is valid
- [`src/lib/plan-schema.ts:97-103`](https://github.com/DmiE/WattWise/blob/2c52d76da0b883268c9162162cae40ccee851a59/src/lib/plan-schema.ts#L97-L103) — why the provider-side JSON Schema carries no numeric bounds
- [`src/lib/intensity-reference.ts:53-87`](https://github.com/DmiE/WattWise/blob/2c52d76da0b883268c9162162cae40ccee851a59/src/lib/intensity-reference.ts#L53-L87) — the only zone→%FTP table; display copy, never imported by the plan path
- [`src/lib/services/plan.ts:142-211`](https://github.com/DmiE/WattWise/blob/2c52d76da0b883268c9162162cae40ccee851a59/src/lib/services/plan.ts#L142-L211) — three-phase crash-safe persist
- [`supabase/migrations/20260602182721_init_mvp_schema.sql:161-163`](https://github.com/DmiE/WattWise/blob/2c52d76da0b883268c9162162cae40ccee851a59/supabase/migrations/20260602182721_init_mvp_schema.sql#L161-L163) — `structure` JSONB: object + `segments` key, nothing more
- [`supabase/migrations/20260602182721_init_mvp_schema.sql:55`](https://github.com/DmiE/WattWise/blob/2c52d76da0b883268c9162162cae40ccee851a59/supabase/migrations/20260602182721_init_mvp_schema.sql#L55) vs [`:160`](https://github.com/DmiE/WattWise/blob/2c52d76da0b883268c9162162cae40ccee851a59/supabase/migrations/20260602182721_init_mvp_schema.sql#L160) — weekend cap 600 vs session ceiling 360

## Architecture Insights

- **Layered correctness, stated and honoured.** `first-plan-generation/plan.md:49`
  declares the intended layering: the LLM `json_schema` constrains generation,
  `JSON.parse` + zod is *the* trust boundary, DB CHECKs are the final backstop.
  The code matches. What research adds is that **the third layer is much
  thinner than the design implies** — for anything inside `structure`, the DB
  backstop checks essentially nothing, so the middle layer is load-bearing
  alone.
- **The prompt and the validator are two independent statements of the same
  rules**, deliberately kept in sync via the shared Monday anchor. Three of the
  prompt's six rules are enforced in code; rule 5 (periodization) and the
  "derived from FTP / max HR" clauses are prompt-only.
- **Rejection, not repair, is a deliberate and documented decision**
  (`plan-brief.md:30`: "Hard reject + retry on mismatch (no coercion) …
  coercion = silently wrong numbers"). Any future test that expects clamping
  would be asserting against the architecture.
- **A design promise was dropped without a recorded decision.** F-01 specified
  "zone number only (1–7) per segment" for all three equipment types
  (`data-schema-and-rls/plan-brief.md:21`) plus a `src/lib/zones.ts` lookup
  scoped to S-02 (`:44`). S-02's segment contract has no zone on watts or RPE
  targets, and the lookup table never appears in the S-02 plan. This is the
  root cause of the missing oracle for clause (c).

## Historical Context (from prior changes)

- `context/archive/2026-06-10-first-plan-generation/plan.md:123-129` — the
  validator's contracted guardrails (a)–(d). This is the authoritative oracle
  for clauses (a) and (b), and it demonstrably contains **no zone guardrail**.
- `context/archive/2026-06-10-first-plan-generation/plan.md:159-160,372-373` —
  the manual-verification criteria for the refinement were exactly the tests
  Phase 1 should now automate ("a deliberately mismatched target kind is
  rejected"; "a session placed on an unavailable day, and one exceeding its
  duration cap, are each rejected"), marked done at commit `8b9b866` **with no
  evidence artifact**. The detailed evidence file `phase-3-manual-test.md`
  covers persistence and idempotency, not rejection behaviour.
- `context/archive/2026-05-31-data-schema-and-rls/plan-brief.md:21,27,44` — the
  1–7 zone decision, the "database enforces one active plan" decision, and the
  deferral of `src/lib/zones.ts` to S-02.
- `context/archive/2026-06-25-intensity-reference/plan-brief.md:31,34` — the
  5-zone (not Coggan-7) decision, and the explicit framing of the zone table as
  "generic static content" with "no zone-math".
- `context/archive/2026-06-18-plan-renewal/plan.md:48,49,66` — the atomic
  supersede ordering, why the non-deferrable partial index makes it
  load-bearing, and the precise failure invariant.

## Related Research

- `context/archive/2026-06-18-plan-renewal/research.md:71,98,188` — prior
  exploration of the one-active-plan invariant and the crash-safe persist.
- `context/foundation/test-plan.md` §2 Risk Response Guidance — the pre-research
  hypotheses this document tests. Its guess of "unit (pure validator over
  fixture payloads)" as the cheapest layer is **confirmed**; its named
  anti-pattern ("deriving expected zone or duration values by reading the
  validator") turns out to be unavoidable for zones by any means *other* than a
  product decision, because no source states the rule.

## Open Questions

**Blocking for the zone clause of Risk #1** — these must be answered by the
product owner before any test asserts on zone semantics:

- **A1.** Is there any rule binding a generated intensity target to a zone
  percentage of FTP? As specified, a watts target has no zone number, so the
  named failure cannot occur for power-meter users. Should a watt range be
  required to fall inside a named zone's %FTP band — and if so, which table is
  authoritative?
- **A2.** Five zones or seven? `data-schema-and-rls/plan-brief.md:21` says 1–7
  with a CHECK; `intensity-reference/plan-brief.md:34` explicitly chooses 5 and
  rejects Coggan-7. The shipped bound is 1–5. Unresolved in the sources.
- **A3.** What anchors HR zones, and must `low_bpm`/`high_bpm` agree with the
  `zone` integer? The two are independent model outputs with no stated
  consistency rule. The only % band anywhere is % max HR from display copy —
  which itself diverges from Coggan's %LTHR model without any document
  acknowledging the substitution.

**Non-blocking but decision-shaping:**

- **A4.** Is any *coverage* of `available_days` required? Containment is a hard
  rule; coverage is stated nowhere. May a plan use 2 of 5 declared days? May a
  week be empty? (This gates whether the "1-session plan" finding is a bug or
  accepted behaviour.)
- **A5.** Does "number of days" (`prd.md:118`) mean anything beyond
  `length(available_days)`? The three-column schema has no field for it.
- **A6.** Weekend cap 600 vs `planned_duration_min` ceiling 360 — which wins?
  Until answered, tests must pick weekend-cap fixtures below 360 to reach the
  `duration_over_cap` branch at all.
- **A7.** PRD US-01's "at least one session scheduled for the current week"
  (`prd.md:48`) vs the next-Monday anchor, which
  `first-plan-generation/plan.md:147` calls "an intentional product nuance, not
  a bug". An unreconciled contradiction; neither document cites the other.
- **A8.** Periodisation / recovery weeks / week-over-week progression — the
  test plan itself concedes this has "no closed-form oracle" (§3 Phase 5, §4).
  Do not invent one.
- **A9.** Session-type mix vs. training goal — unspecified in every source.

**Consequence for §3 Phase 5.** The rollout says Phase 5 may be skipped "if
Phase 1 shows the deterministic refinement already closes Risk #1". Research
says it does **not** close it — but the residue is *not* the AI-judgment
problem Phase 5 was designed for. The gap is a **missing deterministic rule**
(zones), blocked on a product decision, plus a **missing completeness check**.
An AI-native reviewer would not fix either. Phase 5 should stay `not started`
and be re-decided after A1–A4 are answered, rather than being promoted to
absorb this gap.

**Tooling caveats** (from the runner pass, flagged rather than assumed):

- The recommended Vitest config was reasoned from primary sources plus an
  esbuild resolution proof, **not from a green test run** — validate with one
  trivial test before writing the suite.
- The `astro:env` stub/alias workaround for later phases is a community
  pattern, undocumented by Astro.
- Upgrading to `astro@7.3.1` + adapter 14.3.0 was **not** confirmed to make
  `getViteConfig()` work; do not plan on it as an escape hatch.
- Stryker's compatibility with Vitest 4 was out of scope and is unverified.
