# Phase 3 Manual Test Plan — Service & Generate Endpoint

Manual verification for `POST /api/plans/generate` and the `plan` service
(`src/lib/services/plan.ts`, `src/pages/api/plans/generate.ts`).

All four checks exercise the live route, which is auth-gated and hits OpenRouter
plus the DB under the user's RLS session. None can be fully automated here — each
needs DB inspection and/or a live authenticated session.

> **Status: ✅ ALL PASSED — executed 2026-06-13.** Driven by scripting the
> signin → generate flow with a curl cookie jar (model
> `anthropic/claude-4.5-sonnet-20250929`); DB checks confirmed in the Supabase
> dashboard. Per-check results recorded inline below.
>
> Gotcha found: signin returns `403` to scripted POSTs because Astro's CSRF
> origin check requires an `Origin: http://localhost:4321` header. Browsers send
> it automatically — not a bug, but required when scripting the route.

## Shared prerequisites (one-time, human)

1. `OPENROUTER_API_KEY` (and optionally `OPENROUTER_MODEL`) set in `.dev.vars`.
2. `npm run dev` running.
3. A signed-in user with a completed profile (run the onboarding wizard once),
   and that user's session cookie available — either test through the browser,
   or copy the `sb-*` auth cookies from devtools so requests can be scripted
   with `curl`.
4. A way to read the DB — Supabase dashboard SQL editor (or `psql` against the
   linked project). There is no service-role key, so DB reads run as you.

---

## 3.4 — First call generates+persists one plan; second returns same plan, no new LLM call

**Verdict:** 🧑 Human-driven (auth session + live LLM + DB). 🤖 Claude can run the
two `curl` POSTs and compare JSON if given a running server + `sb-*` cookies; the
DB row counts are yours.

**Result (2026-06-13): ✅ PASS.** POST #1 → `200` in 22.6s (real LLM call), plan
persisted. POST #2 → `200` in 0.23s, byte-identical body (same `plan.id`,
unchanged `generation_metadata.usage` = 3717 tokens) → idempotent, no new LLM
call. DB: `count(active plans)` = 1; 12 `plan_sessions` = 3 available days
(Tue/Thu/Sat) × 4 weeks, each `scheduled_date` matching its `day_index`, week 4
reduced volume.

**Steps:**

1. With a logged-in session, `POST /api/plans/generate` (browser fetch, or `curl`
   with the auth cookies). Expect `200 { plan: {...} }` after ~10–30s.
2. In Supabase:
   - `select count(*) from plans where user_id = '<uid>' and status='active';` → 1
   - `select count(*) from plan_sessions where plan_id='<id>';` → matches the
     available-day count.
3. `POST` again. Expect an **immediate** `200` with the same `plan.id`. "No new
   LLM call" is confirmed by the instant response (no ~10–30s wait) and unchanged
   `generation_metadata.usage`.

---

## 3.5 — Forced invalid output → retries → friendly error, nothing persisted

**Verdict:** 🧑 Human-driven (config change + restart + DB check). 🤖 Claude can make
the temporary schema-break edit and revert it, and run the `curl` to confirm the
502; you confirm the DB stayed empty.

**Result (2026-06-13): ✅ PASS.** Forced the semantic-failure path by making
`validateGeneratedPlan` return `{ ok: false }` (cleaner than a weak model — fails
independent of LLM output; dev server hot-reloaded the edit, no restart needed).
Active plan deleted first so the route actually generates. POST → `502` in 50.8s
(two real LLM calls, both rejected at the validation boundary) with the generic
message "We couldn't generate a valid plan right now. Please try again." — no
provider/constraint leakage. DB: `count(plans)` = 0 → orphan rollback works.
Edit reverted; regeneration then succeeded in 22.7s, confirming clean recovery.

**Steps:**

1. Force an invalid plan. Cleanest options:
   - Temporarily point `OPENROUTER_MODEL` at a weak/free model (e.g. a `:free`
     model that won't honor the equipment unit), OR
   - Temporarily break `PLAN_JSON_SCHEMA` so the output fails zod.
   Restart dev.
2. `POST /api/plans/generate`. Expect `502 { error: "We couldn't generate a valid
   plan right now…" }` after both attempts.
3. In Supabase: `select count(*) from plans where user_id='<uid>';` → **0**
   (orphan rollback worked, nothing persisted).
4. Revert the model/schema change.

---

## 3.6 — RLS holds: row's `user_id` is the caller; sessions resolve via parent

**Verdict:** 🧑 Human-driven — requires DB inspection (ideally a second user) under
real auth. Claude cannot drive this (no DB/session access).

**Result (2026-06-13): ✅ PASS (partial — single-user).** `plans.user_id` = the
caller's id; 12 `plan_sessions` resolve via the parent. Cross-user isolation was
**not** exercised end-to-end: the dashboard SQL editor runs as the service role,
which bypasses RLS, so a true second-user check needs that user's own
authenticated session. Isolation therefore rests on the policy definition
(`plan_sessions` EXISTS-walks to `plans.user_id = auth.uid()`), which is correct
by construction but unverified at runtime here.

**Steps:**

1. After 3.4, in Supabase SQL: `select user_id from plans where id='<id>';`
   equals the logged-in user's id.
2. Confirm sessions are reachable only through the parent:
   `select count(*) from plan_sessions where plan_id='<id>';` returns rows under
   that user's session, and a *different* user's session sees none.

---

## 3.7 — Exactly one active plan after repeated calls

**Verdict:** 🧑 Human-driven — DB inspection. 🤖 Claude can fire the repeated/concurrent
POSTs given a running server + cookies; the count check is yours.

**Result (2026-06-13): ✅ PASS.** Part A — 5 sequential POSTs all returned `200`
instantly (0.17–0.45s) with the same `plan.id` (idempotent short-circuit). Part B
(23505 race) — deleted the active plan, then fired two near-simultaneous POSTs:
both `200` in ~23s with the **same** `plan.id` (each generated a candidate; one
won the insert, the loser hit `23505`, re-queried, returned the winner). DB:
`count(active plans)` = 1. Note: the losing request still spent a full ~23s LLM
call before losing the insert — acceptable for a rare race, worth watching if
regeneration ever becomes user-triggerable at volume.

**Steps:**

1. Fire `POST /api/plans/generate` several times (and/or two near-simultaneous
   calls to probe the `23505` race path).
2. Supabase: `select count(*) from plans where user_id='<uid>' and status='active';`
   → always **1**.

---

## Summary

| Check | Who | Result (2026-06-13) | Claude can assist with |
| --- | --- | --- | --- |
| 3.4 | 🧑 Human | ✅ PASS | driving the two `curl` POSTs, comparing JSON |
| 3.5 | 🧑 Human | ✅ PASS | the temporary validator-break edit + revert, `curl` for the 502 |
| 3.6 | 🧑 Human | ✅ PASS (single-user; cross-user unverified) | — (no DB/session access) |
| 3.7 | 🧑 Human | ✅ PASS | firing repeated/concurrent POSTs |

Claude can take over the mechanical parts of 3.4, 3.5, 3.7 **if** the dev server
is running and the `sb-*` session cookies are provided. 3.6 is entirely manual.

## Execution notes (2026-06-13)

- Auth was scripted: `POST /api/auth/signin` with a curl cookie jar +
  `Origin: http://localhost:4321` (CSRF), then the captured `sb-*` cookie reused
  for the generate POSTs. DB row counts confirmed by the human in the Supabase
  dashboard.
- Model: `anthropic/claude-4.5-sonnet-20250929`. Cold generation ~22–23s; a full
  two-attempt failure ~51s.
- 3.5's forced failure was a `validateGeneratedPlan` early `return { ok: false }`
  (semantic path, LLM-independent), reverted after the test — `git diff` clean.
- Follow-up to consider: 3.6 cross-user isolation is unverified at runtime
  (dashboard bypasses RLS); 3.7's race loser burns a full LLM call before losing
  the insert.
