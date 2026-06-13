---
project: WattWise
researched_at: 2026-05-25T00:00:00Z
recommended_platform: Cloudflare Workers
runner_up: Netlify
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 6 SSR
  runtime: Cloudflare workerd (via @astrojs/cloudflare adapter)
  database: Supabase (external, PostgreSQL)
  ai: OpenRouter (OpenAI-compatible REST → Anthropic model; plain fetch, no SDK)
---

> **S-02 reconciliation (2026-06-13):** This research predates the AI integration and assumed an `@anthropic-ai/sdk` dependency. The implemented gateway is **OpenRouter** called with plain `fetch` (no vendor SDK) over a **single non-streaming** structured request. This sidesteps the two SDK-specific failure modes flagged below (streaming-under-`workerd`, `@anthropic-ai/sdk` transitive Node-API imports) — see the inline notes and the Risk Register. The CPU-time, `nodejs_compat`/process-v2, Smart-Placement, and Pages-vs-Workers risks are unaffected and still stand.

## Recommendation

**Deploy on Cloudflare Workers.**

The tech stack was already wired for this: `@astrojs/cloudflare` is the project adapter, `deployment_target: cloudflare-pages` is in `tech-stack.md`, and the CLAUDE.md dev server runs on the `workerd` runtime. No adapter switching cost. The free tier (100,000 requests/day, no credit card, commercial use allowed) comfortably covers MVP traffic, and the `wrangler` CLI fully supports agent-driven deploy, rollback, log tailing, and version management. Cloudflare also publishes an official MCP suite and `llms.txt` / `llms-full.txt` endpoints, making it the best-scoring platform on all five agent-friendly criteria.

---

## Platform Comparison

### Scoring Matrix

| Platform | CLI-first | Managed/Serverless | Agent docs | Stable deploy API | MCP | Score |
|---|---|---|---|---|---|---|
| **Cloudflare Workers** | Pass | Pass | Pass | Pass | Pass | **5/5** |
| Vercel | Pass | Pass | Pass | Pass | Pass | 5/5 |
| Netlify | Pass | Pass | Pass | Pass | Pass | 5/5 |
| Railway | Pass | Pass | Partial | Pass | Pass | 4.5/5 |
| Render | Partial | Pass | Pass | Partial | Pass | 3.5/5 |
| Fly.io | Pass | Partial | Fail | Partial | Pass | 3/5 |

**Hard filters applied**: None — no platform was hard-filtered (no persistent connections required, all platforms handle stateless SSR). The key differentiator was adapter-switching cost: Fly.io and Render require `@astrojs/node`; Vercel and Netlify require their own adapters; Cloudflare requires no change.

**Soft weights applied**: Cost vs. DX neutral (no preference stated). No existing familiarity (no tie-break). Single region fine (no edge-native bonus applied). External Supabase + OpenRouter (co-location irrelevant).

---

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

The project adapter (`@astrojs/cloudflare` v13+) and dev runtime (`workerd` via Cloudflare Vite plugin) already target Workers. Zero migration cost. The free tier gives 100,000 requests/day with commercial use allowed — by far the most generous serverless free tier. `wrangler` covers the full operational loop: `wrangler deploy`, `wrangler rollback [VERSION_ID]`, `wrangler tail` (live log streaming), `wrangler deployments list`. Cloudflare publishes `llms.txt` and `llms-full.txt` at `developers.cloudflare.com`, and provides an official MCP suite (Docs server, Workers Bindings server, Container server — all GA as of March 2025). The primary risks (CPU time limit, `nodejs_compat` + process v2 bug) are documented and mitigated in the risk register below.

#### 2. Netlify

Scored 5/5 on criteria. The official `@astrojs/netlify` adapter is GA and simple to configure. Netlify's credit-based free tier (300 credits/month) covers low-traffic MVP use comfortably. The official Netlify MCP server has been GA since February 2025. The one CLI gap is rollback — reverting a deploy requires using the dashboard ("Publish Deploy" on a prior snapshot) rather than a CLI command. The adapter switch from `@astrojs/cloudflare` to `@astrojs/netlify` is the only switching cost, but it is meaningful: the default Netlify Functions runtime (Node.js 22) is more permissive than Workers for npm packages using Node APIs, which removes the `nodejs_compat` risk class entirely.

#### 3. Vercel

Also scored 5/5 on criteria, but carries two soft penalties. First, an active Astro 6 SSR esbuild parse error (GitHub issue #16258) can cause build failures with a workaround required — a risk for a solo developer with no test runner. Second, the Vercel Hobby plan prohibits commercial use in its Terms of Service; a hobby cycling app may not matter now, but it becomes relevant if the project ever monetizes. The Vercel MCP is currently read-only (GA with approved-client allowlist). Adapter switch to `@astrojs/vercel` required.

---

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **30ms CPU time limit on free tier**: Workers bills and limits on CPU time (actual computation), not wall-clock time. I/O wait (Supabase queries, OpenRouter API calls) doesn't count. But post-processing — parsing a 4-week plan JSON response, Zod validation, intensity mapping, DB batch write preparation — does. This is non-trivial for the plan-generation route and could silently hit the 30ms ceiling in production. The paid plan ($5/month) removes the CPU-time cap and is likely required at any real usage level.

2. **`nodejs_compat` + process v2 active bug**: With `compatibility_date >= 2025-09-15` combined with the `nodejs_compat` flag, a race condition causes `isNode` to return `true` in Astro's detection logic, making the adapter return an async-iterable response body that `workerd` rejects. The workaround is adding `disable_nodejs_process_v2` to `compatibility_flags` in `wrangler.toml`. This is fragile: any future `wrangler.toml` cleanup that drops the flag without checking will silently break production.

3. **Transitive dependency edge runtime risk**: `@supabase/ssr` relies on Node.js internals. `nodejs_compat` covers most — but not all — Node.js APIs. A minor version bump can introduce a transitive import of an unsupported module (`vm`, `net`, `child_process`) that compiles successfully but crashes at runtime in `workerd`. Without a test runner configured, this would only be caught by a production outage. _(S-02 note: this risk originally also named `@anthropic-ai/sdk`; the AI integration ships as plain `fetch` with no SDK, so the AI side no longer carries this risk class — only `@supabase/ssr` remains.)_

4. **Edge PoP ↔ Supabase latency for single-region users**: Workers routes requests to the nearest edge PoP, not the nearest PoP to the Supabase instance. For a user near Supabase's region, this is fine. For a user far from Supabase, the request goes: user → nearby PoP → Supabase region → back. Smart Placement (`smart_placement = { mode = "on" }`) routes the Worker to the PoP closest to Supabase, reducing this round-trip — but it must be opted in explicitly.

5. **Pages vs. Workers product split**: The tech-stack specifies `cloudflare-pages` but Cloudflare now recommends Workers for new full-stack SSR projects. The two products use different `wrangler` commands (`wrangler pages deploy` vs. `wrangler deploy`), different secrets management, and different `wrangler.toml` shapes. The CLAUDE.md already says "Cloudflare Workers" in the Architecture section, creating ambiguity that must be resolved before the first deploy.

### Pre-Mortem — How This Could Fail

The team deployed WattWise (Astro 6 + Supabase SSR + an AI gateway) on Cloudflare Workers for the MVP. Six months in, three things broke down in sequence. _(Two of the three below were SDK-specific; S-02 chose OpenRouter via plain `fetch` over a single non-streaming call, which averts both — they are retained as a record of the risks the design deliberately designed out.)_

First, AI plan generation started silently returning truncated plans. A vendor SDK's streaming path uses Node.js `stream` primitives that `nodejs_compat` partially emulates. The bug only surfaced under real load — local `workerd` dev didn't replicate it because test payloads were smaller. Three days were spent isolating the issue before switching to non-streaming calls with a polling timeout, which degraded the "continuous visible feedback" the PRD required and required re-architecture of the plan generation UX. _(Averted in S-02: the integration is non-streaming from day one — a single structured `fetch` call surfaced behind the dashboard progress UI — so there is no SDK streaming path to fail.)_

Second, an AI-SDK minor version bump pulled a new transitive dependency using `vm` module internals beyond `nodejs_compat`'s scope. The build succeeded; production crashed. There is no test runner configured in the project, so the regression was discovered from user reports, not CI. Pinning the SDK version resolved it, but trust was damaged. _(Averted in S-02: no AI SDK is installed — the OpenRouter client is plain `fetch` — so there is no AI-SDK dependency to bump. The `@supabase/ssr` instance of this risk still stands.)_

Third, the CPU time limit tripped on the plan-generation route. Post-processing a full 4-week plan (28 sessions, Zod validation, intensity mapping, Supabase batch write preparation) consumed 38ms CPU time. The free tier hard-cuts at 30ms with no warning — users on the free plan received silent 429s. Upgrading to Workers Paid ($5/month) fixed it, but was unbudgeted for a side project expected to run for free.

### Unknown Unknowns

- **CPU time ≠ wall-clock time**: Standard response latency testing won't reveal CPU time consumption. The 30ms limit is invisible in local dev and only visible in production Cloudflare metrics. Instrument the plan-generation route with CPU-time snapshots before launch.
- **Pages vs. Workers is a real fork, not branding**: `wrangler pages deploy` and `wrangler deploy` are different commands. The starter's build output and `wrangler.toml` shape differ between the two products. Decide which product you're targeting on day one, not at first deploy.
- **Smart Placement must be opted in**: Default Workers routing sends requests to the nearest PoP to the user — not the nearest PoP to Supabase. For a single-region app, add `smart_placement = { mode = "on" }` to `wrangler.toml` to route Workers execution closer to the Supabase instance.
- **`@astrojs/cloudflare` v13 entrypoint change**: The adapter changed its `main` entrypoint in v13. Any future major version bump must be verified against `wrangler.toml`'s `main` field — a mismatch compiles successfully but silently serves wrong responses.
- **`astro:env/server` secrets surface build-time errors in CI**: The Astro env schema validates at build time using the adapter's env handling. A missing `SUPABASE_URL` or `SUPABASE_KEY` in GitHub Actions secrets will fail the CI build, not the runtime. This is the correct behaviour, but it must be wired up in the GitHub Actions repository secrets before the first CI run.

---

## Operational Story

- **Preview deploys**: `wrangler versions upload` creates an unrouted version for inspection; `wrangler versions deploy --percentage 0` stages it without sending traffic. Full production deploy: `wrangler deploy`. There is no automatic branch-preview URL equivalent to Vercel/Netlify — preview deploys are manual via version management. Cloudflare Access can protect any Workers route with OAuth/email if a staging URL is needed.
- **Secrets**: Production secrets live in Cloudflare's encrypted secrets store, set via `wrangler secret put SUPABASE_URL` and `wrangler secret put SUPABASE_KEY`. For local dev, secrets go in `.dev.vars` (gitignored). CI secrets are set in GitHub Actions repository secrets and injected into the build step as env vars. Secrets are write-only in the Cloudflare dashboard — they cannot be read back after setting.
- **Rollback**: `wrangler rollback` reverts to the previous deployment version. `wrangler rollback [VERSION_ID]` targets a specific prior version from `wrangler deployments list`. Typical time-to-revert: under 60 seconds. Data caveat: Supabase DB migrations do not roll back automatically — rollback only reverts the Worker code, not the database schema.
- **Approval**: Deploy to production (`wrangler deploy`) and secret rotation (`wrangler secret put`) are operations an agent may perform if `wrangler` is authenticated. Dropping or modifying a Supabase database or rotating the Supabase project keys requires human action in the Supabase dashboard. No automatic Cloudflare resource (Worker, KV namespace, binding) requires a human approval step in the free or paid tier.
- **Logs**: `wrangler tail` streams live runtime logs to the terminal. Supports `--env <name>`, `--status error` (filter to errors only), `--search <term>`, `--format json` (structured output for piping), and `--sampling-rate` (reduce volume on high-traffic routes). Historical logs are viewable in the Cloudflare dashboard under Workers > Logs. No log retention beyond the dashboard for the free plan.

---

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Plan-generation route exceeds 30ms CPU time on free tier | Devil's advocate | High | High | Upgrade to Workers Paid ($5/month) before launch; instrument plan route with CPU-time checkpoints during dev |
| `nodejs_compat` + process v2 bug breaks SSR responses | Devil's advocate | Medium | High | Add `disable_nodejs_process_v2` to `compatibility_flags` in `wrangler.toml`; pin `compatibility_date` and test before bumping |
| ~~`@anthropic-ai/sdk` transitive dependency uses unsupported Node API~~ — **resolved (S-02)**: no AI SDK installed; OpenRouter client is plain `fetch` | Pre-mortem | n/a | n/a | Risk designed out — no AI-SDK dependency exists to bump (the `@supabase/ssr` row above still applies) |
| ~~Anthropic SDK streaming fails under workerd runtime~~ — **resolved (S-02)**: integration is a single non-streaming `fetch` call | Pre-mortem | n/a | n/a | Risk designed out — non-streaming is the only path; no SDK streaming to fail |
| Edge PoP ↔ Supabase latency adds unexpected round-trip time | Unknown unknowns | Medium | Low | Enable `smart_placement = { mode = "on" }` in `wrangler.toml` from day one |
| Pages vs. Workers product ambiguity causes wrong deploy command | Unknown unknowns | High | Medium | Resolve before first deploy: confirm `wrangler.toml` shape matches Workers (not Pages) and update `npm run build` / `npm run preview` scripts accordingly |
| Supabase SSR cookie handling breaks under Workers | Research finding | Low | High | Test auth flow end-to-end in `workerd` local dev before first deploy; verify `@supabase/ssr` cookie adapter works in workerd via `npm run dev` |
| CI deploy fails due to missing GitHub Actions secrets | Unknown unknowns | Medium | Medium | Add `SUPABASE_URL` and `SUPABASE_KEY` to GitHub Actions repository secrets before first CI run; add `CF_API_TOKEN` for `wrangler` auth |

---

## Getting Started

1. **Resolve Pages vs. Workers**: The `tech-stack.md` says `cloudflare-pages`; the CLAUDE.md says "Cloudflare Workers." Run `cat wrangler.toml` (or `wrangler.json`) and confirm `main` points to `@astrojs/cloudflare/entrypoints/server` (Workers shape) rather than a `_worker.js` Pages output. If missing, initialize with `npx wrangler init --from-dash` or create a `wrangler.toml` matching the Workers pattern in the `@astrojs/cloudflare` v13+ docs.

2. **Add the required compatibility flags**: In `wrangler.toml`, set:
   ```toml
   compatibility_flags = ["nodejs_compat", "disable_nodejs_process_v2"]
   compatibility_date = "2025-09-15"
   ```
   These flags are required for Astro 6 + `@astrojs/cloudflare` v13+ to work correctly.

3. **Wire production secrets via Wrangler**:
   ```sh
   npx wrangler secret put SUPABASE_URL
   npx wrangler secret put SUPABASE_KEY
   ```
   Use `.dev.vars` for local dev (already gitignored per CLAUDE.md).

4. **Enable Smart Placement** (optional but recommended for Supabase latency): Add to `wrangler.toml`:
   ```toml
   [placement]
   mode = "on"
   ```

5. **Deploy**:
   ```sh
   npx wrangler deploy
   ```
   Verify with `npx wrangler tail` to stream live logs. Check the plan-generation route specifically for CPU time warnings in the Cloudflare dashboard under Workers > Metrics.

---

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup (`.github/workflows/ci.yml` already exists — wiring `CF_API_TOKEN` is a secret-management step, not covered here)
- Production-scale architecture (multi-region, HA, DR)
