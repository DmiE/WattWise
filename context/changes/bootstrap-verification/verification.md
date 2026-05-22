---
bootstrapped_at: 2026-05-22T18:25:12Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: wattwise
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: wattwise
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
```

**Why this stack**: WattWise is a solo-built web app targeting small-scale hobbyist cyclists, with a 6-week after-hours MVP timeline. Auth (email+password, FR-001/FR-003) and AI-generated training plans (FR-004/FR-013) map cleanly to the `10x-astro-starter` strengths: Supabase ships auth and PostgreSQL out of the box, while the Anthropic SDK drops into Astro API routes without friction. The starter clears all four agent-friendly gates — typed (TypeScript project-wide), convention-based (Astro file routing + Supabase SDK), popular in training data, and well-documented — making it a low-friction choice for solo AI-assisted development. Cloudflare Pages is the cost-optimal edge deploy for a low-QPS hobby app with no sustained background compute. Standard path was taken; the recommended default for `(web-app, js)` was accepted without modification. CI runs on GitHub Actions with auto-deploy-on-merge. AI plan generation is not bundled in the starter and must be wired in as a first step after scaffolding.

## Pre-scaffold verification

| Signal      | Value    | Severity | Notes                                                           |
| ----------- | -------- | -------- | --------------------------------------------------------------- |
| npm package | not run  | —        | cmd_template uses `git clone`; npm package check skipped        |
| GitHub repo | not run  | —        | gh CLI not found on this machine; recency check unavailable     |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: clone the starter repo into a temp directory, delete its git history, then merge files up into the current directory (git-clone)
**Exit code**: 0
**Files moved**: 18 moved silently + 1 sidelined as `.scaffold` sibling + 1 append-merged = 20 scaffold items processed
**Conflicts (.scaffold siblings)**: `CLAUDE.md` → `CLAUDE.md.scaffold` (root-level `*.md`, existing wins)
**.gitignore handling**: append-merged — cwd line (`.claude`) preserved; scaffold lines de-duped and appended under `# from 10x-astro-starter` separator
**.bootstrap-scaffold cleanup**: deleted

Files moved silently: `.husky`, `.prettierrc.json`, `.nvmrc`, `.github`, `.env.example`, `.vscode`, `README.md`, `astro.config.mjs`, `components.json`, `eslint.config.js`, `node_modules`, `package-lock.json`, `package.json`, `public`, `src`, `supabase`, `tsconfig.json`, `wrangler.jsonc`

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 1 HIGH, 9 MODERATE, 0 LOW
**Direct vs transitive**: 0/0/2/0 direct of total 0/1/9/0 (CRITICAL/HIGH/MODERATE/LOW). Direct vulnerable packages: `@astrojs/check` (MODERATE), `wrangler` (MODERATE). The 1 HIGH finding is transitive only.

#### CRITICAL findings

None.

#### HIGH findings

- **devalue** v5.6.3–5.8.0 (transitive)
  - Advisory: GHSA-77vg-94rm-hx3p
  - Title: "Svelte devalue: DoS via sparse array deserialization"
  - CWE: CWE-770 (Uncontrolled Resource Consumption)
  - CVSS: 7.5 (AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H)
  - Fix available: yes (`npm audit fix` — non-breaking)

#### MODERATE findings

- **ws** v8.0.0–8.20.0 (transitive)
  - Advisory: GHSA-58qx-3vcg-4xpx — "Uninitialized memory disclosure"
  - CVSS: 4.4 (CWE-908)
  - Affected paths: `node_modules/ws`, `node_modules/@supabase/realtime-js/node_modules/ws`
  - Fix available: yes

- **yaml** v2.0.0–2.8.2 (transitive)
  - Advisory: GHSA-48c2-rrv3-qjmp — "Stack Overflow via deeply nested YAML collections"
  - CVSS: 4.3 (CWE-674)
  - Fix available: yes (via `@astrojs/check` downgrade to v0.9.2 — semver major)

- **miniflare** (transitive) — via `ws`; affects `@cloudflare/vite-plugin` and `wrangler`; fix available
- **@cloudflare/vite-plugin** (transitive) — via `miniflare`, `wrangler`, `ws`; fix available
- **wrangler** (direct) — via `miniflare`; fix available
- **yaml-language-server** (transitive) — via `yaml`; fix available via `@astrojs/check` downgrade
- **volar-service-yaml** (transitive) — via `yaml-language-server`; fix available via `@astrojs/check` downgrade
- **@astrojs/language-server** (transitive) — via `volar-service-yaml`; fix available via `@astrojs/check` downgrade
- **@astrojs/check** (direct) — via `@astrojs/language-server`; fix: downgrade to v0.9.2 (semver major)

## Hints recorded but not acted on

| Hint                    | Value                  |
| ----------------------- | ---------------------- |
| bootstrapper_confidence | first-class            |
| quality_override        | false                  |
| path_taken              | standard               |
| self_check_answers      | null                   |
| team_size               | solo                   |
| deployment_target       | cloudflare-pages       |
| ci_provider             | github-actions         |
| ci_default_flow         | auto-deploy-on-merge   |
| has_auth                | true                   |
| has_payments            | false                  |
| has_realtime            | false                  |
| has_ai                  | true                   |
| has_background_jobs     | false                  |

These hints are preserved here for the future M1L4 skill ("Memory Architecture") to act on. In v1, bootstrapper surfaces them but takes no compensating action (no CI workflow files, no auth wiring, no AI integration scaffolding).

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- Review `CLAUDE.md.scaffold` — this is the starter's CLAUDE.md. Your existing CLAUDE.md was preserved; diff the two and merge what's useful (`diff CLAUDE.md CLAUDE.md.scaffold`).
- `npm audit fix` to patch the HIGH `devalue` finding and most MODERATE findings (non-breaking). Run `npm audit fix --force` only after reviewing the breaking changes (`@astrojs/check` downgrade).
- Copy `.env.example` to `.env` for local Node dev, or to `.dev.vars` for Cloudflare local dev.
- `npx supabase start` (requires Docker) to bring up the local Supabase stack.
- Address audit findings per your project's risk tolerance — the full breakdown is in this log.
