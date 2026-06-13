<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: First Plan Generation (S-02)

- **Plan**: context/changes/first-plan-generation/plan.md
- **Scope**: Full plan — Phases 1–5 of 5
- **Date**: 2026-06-13 (re-reviewed & partially triaged 2026-06-13)
- **Verdict**: APPROVED (all findings triaged, 2026-06-13) — F1–F5 FIXED; F6, F7 SKIPPED (accepted as-is). lint + build green.
- **Findings**: 0 critical, 4 warnings, 3 observations — 5 fixed (F1–F5), 2 accepted/skipped (F6, F7)
- **Re-review note**: A second full review pass (2026-06-13) re-derived only F1 (a thinner sweep than this report). F1 is FIXED. Two net-new improvements were also applied (see "Re-review addendum"). The reliability/cost findings F2–F7 were then triaged: F2 (shared latency deadline), F3 (one-shot reload flag), F4 (scrub provider body from Error), and F5 (JSON-schema numeric bounds) were FIXED; F6 (read-path cast) and F7 (502/500) were accepted as-is for MVP. Per-finding Decision fields below carry the detail.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Faithful implementation: zero drift, zero scope creep, strong pattern compliance, all automated (`npm run lint`, `npm run build`, structural checks) and manual criteria pass. Warnings are production-reliability hardening, not happy-path correctness defects. The two automated structural "FOUND" hits (`process.env`, `"use client"`) were false positives — a comment in `openrouter.ts` and pre-existing shadcn `ui/` primitives respectively, neither in S-02 scope.

## Findings

### F1 — Orphan-plan rollback is best-effort; a failed rollback can permanently wedge regeneration

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality (Data safety)
- **Location**: src/lib/services/plan.ts:91-97
- **Detail**: On session-insert failure the code runs `plans.delete().eq("id", plan.id)` but never checks that delete's error. If the rollback delete itself fails, or the Worker is killed between the failed session insert and the delete completing, a sessionless `status='active'` plan survives. The `one_active_plan_per_user` partial unique index then makes it permanent: every `getActivePlan` returns it, `persistPlan` never re-runs, `getPlanWithSessions` yields `{plan, sessions: []}` → dashboard renders an empty plan with no recovery path. plan.md's Critical Implementation Details claim the rollback guarantees no sessionless plan; that guarantee does not hold across a failed rollback.
- **Fix A ⭐ Recommended**: Make the read path tolerant — treat an active plan with zero sessions as "regenerate" (getActivePlan or the route ignores/deletes sessionless active plans).
  - Strength: Closes the wedge with a small, local change; no DB migration; recovers existing stuck users automatically.
  - Tradeoff: Adds a count-check on the read path; a genuinely empty plan (shouldn't occur) would regenerate.
  - Confidence: HIGH — same RLS-scoped client, same service module.
  - Blind spot: Extra sessions count() cost on every dashboard load (negligible with existing index).
- **Fix B**: Make persist atomic via a Postgres SECURITY INVOKER RPC that inserts plan + sessions in one transaction.
  - Strength: Eliminates the partial-write class entirely; strongest correctness.
  - Tradeoff: New migration + RPC + types regen; more surface than an MVP slice needs; S-05 may revisit anyway.
  - Confidence: MED — RLS-under-RPC needs care to keep auth.uid() scoping.
  - Blind spot: workerd + supabase-js RPC error mapping for 23505 not yet verified.
- **Decision**: FIXED (re-review 2026-06-13) — via a third, stronger approach than either option above: added migration `20260613224500_add_pending_plan_status.sql` (`ALTER TYPE public.plan_status ADD VALUE IF NOT EXISTS 'pending'`, pushed to remote, types regenerated) and rewrote `persistPlan` into three crash-safe phases — insert as `status='pending'` → insert sessions → flip to `active` last. Any failure (including a failed cleanup or a crash between phases) now leaves a non-active row that `getActivePlan` and the `one_active_plan_per_user` index both ignore, so a sessionless active plan can never be served. The `23505` lost-the-race handling moved to the activation step. lint + build green.

### F2 — No overall latency budget; retry layers multiply (~270s worst case)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/pages/api/plans/generate.ts:72-105 (+ openrouter.ts retry)
- **Detail**: Route does MAX_GENERATION_ATTEMPTS=2, each calling generateStructured which itself retries MAX_RETRIES=2 (3 transport attempts) at 45s each → 2×3×45 = 270s worst case of upstream waiting, with no shared deadline. The hook's client fetch has no timeout either, so the browser spins on "Building your plan…" far past the "a few seconds" copy on a degraded upstream.
- **Fix**: Add one AbortController/deadline shared across attempts (~60–90s total), and/or reduce one of the two multiplying retry layers so the route returns 502 well before minutes elapse.
- **Decision**: FIXED (shared deadline) — `generate.ts` computes `GENERATION_BUDGET_MS = 90_000` once before the attempt loop, bails before starting an attempt past it, and passes the absolute `deadline` into `generateStructured`. The client now caps each transport attempt to `min(ATTEMPT_TIMEOUT_MS, deadline − Date.now())` and stops retrying once the deadline passes, bounding total upstream wait to ~90s instead of ~270s. lint + build green.

### F3 — Generate-on-load can reload-loop with no client ceiling

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/components/hooks/usePlanGeneration.ts:38-43
- **Detail**: The concurrent double-fire guard (inFlight ref) is correct. But on success the hook does window.location.reload(); if the server re-render still finds no active plan (read-replica lag, or a transient miss after the 23505 idempotent branch), the island remounts and generate-on-load fires again — an unbounded reload loop with no backoff or attempt ceiling on the client.
- **Fix**: Add a client guard — a sessionStorage "just-generated" flag or a max-reload counter — so a persistent server/replica inconsistency can't loop reloads.
- **Decision**: FIXED (one-shot flag) — `usePlanGeneration` sets a one-shot `wattwise:plan-generated` sessionStorage flag before reloading. On the post-reload re-mount, if the flag is present the hook surfaces an error ("We saved your plan but couldn't load it. Please try again in a moment.") instead of generating + reloading again, so a persistent post-generate server/replica miss can't loop reloads. `retry()` clears the flag so user-initiated retries still work. lint + build green.

### F4 — Upstream provider error body is embedded in the thrown Error message

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Security/Reliability)
- **Location**: src/lib/services/openrouter.ts:144,147
- **Detail**: `detail.slice(0,500)` from res.text() is interpolated into OpenRouterError.message. The route maps these to generic user messages today (nothing leaks to users), but the raw provider body now rides in an Error that may be logged — inconsistent with the "no provider detail leakage" stance elsewhere.
- **Fix**: When logging OpenRouterError, log code/status only (not message), or scrub the body before interpolating.
- **Decision**: FIXED (scrub) — `openrouter.ts` still drains the response body (connection reuse) but no longer interpolates it into the Error message; the message is now `OpenRouter returned ${status}` (status alone decides retryability). No provider detail can ride into logs. lint + build green.

### F5 — JSON Schema omits numeric bounds that zod enforces → higher retry rate

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Performance/cost)
- **Location**: src/lib/plan-schema.ts (PLAN_JSON_SCHEMA, ~131-182)
- **Detail**: PLAN_JSON_SCHEMA omits min/max bounds zod enforces (low_watts, day_index 1–28, planned_duration_min 15–360). zod re-validates so correctness is safe, but the model only learns bounds from prose, raising the semantic-retry rate — and each retry is a paid LLM call.
- **Fix**: Add minimum/maximum to the JSON schema so the model is constrained at generation time, reducing retries.
- **Decision**: FIXED — added `minimum`/`maximum` to every bounded integer in `PLAN_JSON_SCHEMA`, mirroring the zod bounds: low/high_watts 0–2000, zone 1–5, low/high_bpm 30–230, rpe 1–10, day_index 1–28, planned_duration_min 15–360, segment duration_min 1–360. lint + build green.

### F6 — Read path casts DB `structure` to the segment union with no runtime check

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/lib/services/plan.ts:55
- **Detail**: `sessions as PlanSessionView[]` casts the Json `structure` to the validated union with no runtime check. True for rows this app wrote, but the DB CHECK only guarantees a `segments` key exists, not its shape; a malformed/migrated row would render nothing in PlanView.formatTarget with no guard. Low likelihood in MVP.
- **Fix**: Optionally safeParse sessions to the view shape in getPlanWithSessions for defense in depth.
- **Decision**: SKIPPED — accepted for MVP. Every persisted row passed `validateGeneratedPlan` before insert, the likelihood of a malformed row is low, and a per-load safeParse adds runtime cost; revisit if a migration ever rewrites `structure` out-of-band.

### F7 — 502 vs 500 status inconsistency on failure paths

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/pages/api/plans/generate.ts:108
- **Detail**: Exhausted semantic retries → 502; missing_api_key and persist failure → 500. The client treats all non-OK identically, so this is cosmetic; 502 for "upstream responded OK but output failed validation" is slightly unusual.
- **Fix**: Leave as-is, or use 500 for the validation-exhaustion path for consistency. Cosmetic.
- **Decision**: SKIPPED (leave as-is) — cosmetic; the client treats all non-OK responses identically, so the 502/500 distinction has no observable effect.

## Re-review addendum (2026-06-13)

Net-new findings from the second pass, both applied:

### RR1 — fallbackModels API surface implemented but never wired

- **Severity**: 🔭 OBSERVATION · **Impact**: 🏃 LOW · **Dimension**: Scope Discipline
- **Location**: src/lib/services/openrouter.ts:51,107-110
- **Detail**: `fallbackModels` + the `body.models`/`route:"fallback"` branch were built but never passed by `generate.ts`, leaving the provider-redundancy path (cited for the latency/quality NFR) unexercised.
- **Decision**: FIXED — added optional `OPENROUTER_FALLBACK_MODEL` env var (`astro.config.mjs` env.schema server/public/optional + `.env.example`); `openrouter.ts` reads it and uses it as the default fallback list (explicit param still overrides). lint + build green.

### RR2 — toSessionInserts dropped the documented `profile` parameter

- **Severity**: 🔭 OBSERVATION · **Impact**: 🏃 LOW · **Dimension**: Plan Adherence
- **Location**: src/lib/plan.ts (toSessionInserts)
- **Detail**: Plan contract was `toSessionInserts(planId, profile, validatedPlan, startDate)`; impl is `(planId, validatedPlan, startDate)`. `profile` was unused; output rows unchanged. Signature-only simplification.
- **Decision**: FIXED (doc) — recorded as an addendum on the Phase 2 `toSessionInserts` contract in plan.md.
