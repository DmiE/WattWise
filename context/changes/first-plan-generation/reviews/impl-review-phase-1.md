<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: First Plan Generation (S-02)

- **Plan**: context/changes/first-plan-generation/plan.md
- **Scope**: Phase 1 of 5 (AI Integration Foundation)
- **Date**: 2026-06-13
- **Verdict**: APPROVED
- **Findings**: 0 critical 0 warnings 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## What Was Verified

Plan files vs. diff (commit `fa8366c`) — all three planned files changed, nothing extra:

- `astro.config.mjs` — `OPENROUTER_API_KEY` (server secret) + `OPENROUTER_MODEL` (server public) declared exactly per contract. **MATCH**
- `.env.example` / `.dev.vars` — both vars documented; `.dev.vars` confirmed gitignored. **MATCH**
- `src/lib/services/openrouter.ts` — `generateStructured()`, plain `fetch`, `response_format: json_schema` `strict: true`, Bearer auth, low temperature, bounded retry on 429/5xx + network/timeout, fail-closed throw (`OpenRouterError`) on missing key, `JSON.parse` of the string `content`. **MATCH**

Automated success criteria:

- 1.1 `npm run lint` → exit 0, no errors/warnings. **PASS**
- 1.2 `npm run build` → exit 0, server built. **PASS**
- 1.3 No `process.env` in `src/` (only a comment references it); secrets via `astro:env/server`. **PASS**

## Findings

### F1 — Worst-case retry budget (135s) far exceeds the UX wait target

- **Severity**: ⚪ OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/openrouter.ts:26-27
- **Detail**: `ATTEMPT_TIMEOUT_MS = 45_000` with `MAX_RETRIES = 2` means up to 3 × 45s = 135s of wall-clock before the friendly error fires. Even a single slow-but-successful attempt at ~40s exceeds the plan's stated "~10–30s" progress-UI budget (Phase 4) and the "normal loading wait" NFR. The retry is correct and planned; only the cumulative ceiling is unbudgeted. This is I/O wait, not CPU, so it won't trip Worker CPU limits — the concern is the user-facing wait and how Phase 4's spinner sizes it.
- **Fix**: Decide the worst-case budget explicitly — e.g. drop `ATTEMPT_TIMEOUT_MS` to ~30s and/or `MAX_RETRIES` to 1, and add a one-line comment stating the intended max wait so Phase 4's progress copy can match it.
- **Decision**: PENDING

### F2 — Hardcoded DEFAULT_MODEL silently bills a paid model when unset

- **Severity**: ⚪ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/lib/services/openrouter.ts:16, 89
- **Detail**: `DEFAULT_MODEL = "anthropic/claude-sonnet-4.5"` is used when `OPENROUTER_MODEL` is unset (line 89). The plan made the model fully config-driven ("no code edit to switch", optional env). The fallback is convenient but means a misconfigured deploy silently routes to a paid model instead of failing closed the way the missing-key path does. Also unplanned but benign: the `HTTP-Referer`/`X-Title` attribution headers — standard OpenRouter practice, no action needed.
- **Fix**: Acceptable as-is for dev convenience — if keeping it, add a comment that an unset model defaults to a paid model so it's deliberate, not a surprise. Optional: log a warning when falling back.
- **Decision**: PENDING
