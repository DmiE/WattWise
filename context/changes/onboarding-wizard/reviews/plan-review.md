<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Onboarding Wizard Implementation Plan

- **Plan**: context/changes/onboarding-wizard/plan.md
- **Mode**: Deep
- **Date**: 2026-06-08
- **Verdict**: REVISE (near-SOUND — only F1 truly merits action before implement)
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

8/8 paths ✓, symbols ✓ (zod absent from package.json — confirms Phase 1 need), 4/4 derivation paths satisfy DB CHECK constraints ✓, upsert-on-user_id ↔ RLS insert+update policies ✓, Progress↔Phase mechanical contract ✓, brief↔plan ✓.

Verified directly (no sub-agent needed — tiny blast radius): the four equipment derivation paths against `power_meter_requires_ftp`, `hrm_requires_max_hr`, and `fitness_level_matches_ftp_source` (all satisfy); upsert idempotency against both RLS `user_id = auth.uid()` policies; middleware routing for redirect loops.

## Findings

### F1 — Per-step client gating has no validator in the Phase 1 contract

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §3 (schema contract) ↔ Phase 3 §1 (wizard)
- **Detail**: Phase 3 promises "validate each step with the shared schema" and "Next is disabled until the current step's slice of the schema validates." But the Phase 1 contract exports only `onboardingInputSchema` (a discriminated union on `equipment_type`, with a nested `knows_ftp` discriminator) + the inferred type. A zod `discriminatedUnion` can't be `.pick()`'d or `.partial()`'d per step, so Phase 3 has nothing to validate a single step's fields against. The implementer is pushed to either re-hardcode the 14–100 / 30–200 / 50–600 / 15–360 / 15–600 bounds inline in the wizard (drift risk vs. the DB CHECKs — the exact thing this plan's "one schema mirrors the constraints" stance exists to prevent), or hand-roll partial parsing. The plan calls the Phase 1 signature "the contract Phases 2 and 3 depend on" — but it doesn't expose what Phase 3 actually needs.
- **Fix**: Expand the Phase 1 §3 contract to export per-step field schemas (or a base `z.object` of the common fields — goal, age, weight, days, minutes — plus a standalone equipment-step validator) alongside the full union. Phase 3 gates each step against the matching per-step schema; the server keeps using the full union. Bounds stay defined once. State this in the contract so the schema module is built with the per-step API from the start rather than retrofitted in Phase 3.
  - Strength: Keeps bounds single-sourced (no DB drift); makes the cross-phase dependency explicit instead of implicit.
  - Tradeoff: Slightly larger schema module API surface in Phase 1.
  - Confidence: HIGH — verified the union shape can't decompose per-step; the bounds-duplication risk is concrete.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix in plan — per-step validators added to Phase 1 §3; Phase 3 §1 gating wired to them)

### F2 — Equipment switch leaves stale branch fields in the draft

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 §1–2 (wizard state + draft persistence)
- **Detail**: A user who enters an FTP under `power_meter`, then switches `equipment_type` to `hrm`/`none`, leaves a stale `ftp_watts` (and vice versa) in the in-memory answers and the localStorage draft. `toProfileInsert` derives from the current `equipment_type` so the DB row is safe, but the review screen could surface stale values and rehydration carries them forward. The plan's draft guard only covers malformed JSON, not branch-field staleness.
- **Fix**: On `equipment_type` change, clear the fields outside the active branch; the review screen renders only current-branch fields.
- **Decision**: ACCEPTED (handle during implementation; no plan change)

### F3 — `require('zod')` check may fail on an ESM-only resolution

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1, Automated Verification (Progress 1.3)
- **Detail**: `node -e "require('zod')"` is a CJS probe; the real consumers import zod via ESM in an Astro/Cloudflare build. The probe can give a false negative (or false pass) relative to what matters — that the import resolves in the build. `npm run build` (1.1) already proves the import resolves.
- **Fix**: Drop 1.3 as redundant, or replace with the actual import path resolving under `npm run build` (which already covers it).
- **Decision**: FIXED (Fix in plan — dropped 1.3 from Phase 1 criteria + Progress; folded into 1.1; renumbered shadcn item to 1.3)
