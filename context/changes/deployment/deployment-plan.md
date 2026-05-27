# WattWise — Cloudflare Workers + Supabase Deployment Plan

## Progress snapshot — 2026-05-27

| Phase | Status | Notes |
|---|---|---|
| 1 — Fix wrangler.jsonc | ✅ Done | |
| 2a — Create Supabase project | ✅ Done | Project created |
| 2b — Fix supabase/config.toml | ✅ Done | |
| 2c — Supabase CLI login + link | ⬜ Pending | |
| 2d — Auth redirect URLs | ⬜ Pending | |
| 2e — Local Supabase stack | ⬜ Optional | |
| 2f — DB migrations | ⬜ Pending | |
| 3 — Local dev secrets (.dev.vars) | ⬜ Pending | |
| 4 — Cloudflare account + wrangler auth | ✅ Done | |
| 5 — Production build + preview | ⬜ Pending | |
| 6 — Wire production secrets | ⬜ Pending | |
| 7 — First deploy | ⬜ Pending | |
| 8 — CI/CD wiring | ✅ Done | Repo configured |
| 9 — Post-deploy verification | ⬜ Pending | |

**Next action → Phase 2b**: fix `site_url` and `additional_redirect_urls` ports in `supabase/config.toml`.

---

## Context

WattWise is an Astro 6 SSR app (React 19, Tailwind 4, Supabase auth) targeting Cloudflare Workers. The `@astrojs/cloudflare` v13.5.0 adapter and `workerd` runtime are already wired. The Supabase JS client (`@supabase/ssr`, `@supabase/supabase-js`) and CLI (`supabase` devDependency) are already installed but no remote project exists yet, no migrations are tracked, and `supabase/config.toml` has two wrong values. `wrangler.jsonc` is missing a critical compatibility flag and Smart Placement. CI targets the wrong branch and has no deploy step. This plan addresses all of it in execution order.

---

## Phase 1 — Fix wrangler.jsonc ✅ DONE

**File**: `wrangler.jsonc`

- [x] Renamed `"name"` from `"10x-astro-starter"` → `"wattwise"`
- [x] Added `"disable_nodejs_process_v2"` to `"compatibility_flags"` alongside `"nodejs_compat"`
- [x] Added Smart Placement block (`"placement": { "mode": "smart" }`)

**Final wrangler.jsonc shape**:
```json
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "wattwise",
  "main": "@astrojs/cloudflare/entrypoints/server",
  "compatibility_date": "2026-05-08",
  "compatibility_flags": ["nodejs_compat", "disable_nodejs_process_v2"],
  "assets": {
    "binding": "ASSETS",
    "directory": "./dist",
    "not_found_handling": "404-page"
  },
  "observability": {
    "enabled": true
  },
  "placement": {
    "mode": "smart"
  }
}
```

---

## Phase 2 — Supabase project + CLI setup (manual gate)

### 2a — Create a remote Supabase project ✅ DONE

Project has been created. Make sure you have the following from **Settings → API** ready for Phase 2c and Phase 6:
- **Project URL** (`https://<ref>.supabase.co`) → `SUPABASE_URL`
- **anon / public key** → `SUPABASE_KEY`
- **Project ref** (short alphanumeric string) → needed for `npx supabase link`

### 2b — Fix supabase/config.toml (automated)

Two values are wrong in the re-initialised file:

| Field | Current value | Correct value | Why |
|---|---|---|---|
| `site_url` | `"http://127.0.0.1:3000"` | `"http://127.0.0.1:4321"` | Astro dev server runs on 4321, not 3000; controls where auth redirects land after email confirmation |
| `additional_redirect_urls` | `["https://127.0.0.1:3000"]` | `["https://127.0.0.1:4321"]` | Same reason — redirect allow-list must match the dev server port |

Note: `project_id = "WattWise"` (set during init) is fine — it is a local cosmetic label only, no change needed.

### 2c — Supabase CLI login + link to remote project (manual gate)

The `supabase` CLI is already a devDependency — no global install needed.

```sh
npx supabase login
```
Opens a browser OAuth flow and saves a token at `~/.supabase/access-token`.

Link to the remote project (use the project ref from Step 2a):
```sh
npx supabase link --project-ref <project-ref>
```

Verify:
```sh
npx supabase status
```
Should show the remote project URL and confirm connectivity.

### 2d — Configure auth redirect URLs on Supabase Dashboard (manual gate)

In Supabase Dashboard → **Authentication → URL Configuration**:
- **Site URL**: set to your production Workers URL after Phase 7 deploy (e.g. `https://wattwise.<subdomain>.workers.dev`). Leave blank for now; update after first deploy.
- **Redirect URLs**: add `https://wattwise.<subdomain>.workers.dev/**` to allow all auth callback paths from the production domain. Also add `http://127.0.0.1:4321/**` for local dev.

**Edge case — email confirmation mismatch**: `enable_confirmations = false` in `config.toml` means local signups skip email verification. Supabase's production default requires it. Decide once:
- **Option A** (recommended for MVP): disable email confirmation in the Supabase Dashboard → Authentication → Providers → Email → toggle off "Confirm email". Matches local behaviour.
- **Option B**: keep confirmation on and use Inbucket (local test email at `http://127.0.0.1:54324` when running `npx supabase start`) to verify locally.

### 2e — Local Supabase stack (optional — for offline dev)

Requires Docker Desktop running.

```sh
npx supabase start       # boots Postgres, API, Studio, Inbucket
npx supabase status      # prints local API URL + anon key → use these in .dev.vars
```

Local services:
- Studio (DB browser): `http://127.0.0.1:54323`
- Test email (Inbucket): `http://127.0.0.1:54324`

Stop when done:
```sh
npx supabase stop
```

**Edge case**: If Docker is not running, `npx supabase start` fails with a Docker socket error. Start Docker Desktop first.

### 2f — Database migrations (reference — no migrations exist yet)

No migrations exist (`supabase/migrations/` is empty). When the first schema is ready:

```sh
# Create a timestamped migration file:
npx supabase migration new <short_description>

# Apply to local DB (destructive reset + re-seed):
npx supabase db reset

# Push to production:
npx supabase db push
```

Convention from CLAUDE.md: files named `YYYYMMDDHHmmss_short_description.sql`. Always enable RLS on new tables with per-operation, per-role policies.

**Note**: `supabase/config.toml` references `./seed.sql` but the file doesn't exist. If you plan to seed test data, create `supabase/seed.sql` before running `db reset`.

---

## Phase 3 — Local dev secrets (manual gate)

- [ ] Create `.dev.vars` in project root (gitignored — safe to create):
  ```
  SUPABASE_URL=https://<your-project-ref>.supabase.co
  SUPABASE_KEY=<your-anon-key>
  ```
  Use remote credentials from Phase 2a, or local credentials from `npx supabase status` if running the local stack.
- [ ] Run `npm run dev` — verify the dev server boots on `workerd` runtime
- [ ] Smoke-test auth locally:
  - Sign up → confirm-email page (or auto-redirect, depending on Option A/B from 2d)
  - Sign in → redirects to `/`
  - Visit `/dashboard` unauthenticated → redirects to `/auth/signin`
  - Sign out → session cleared

**Edge case**: If `npm run dev` fails with a `process` or `isNode` error, verify `disable_nodejs_process_v2` was added in Phase 1.

**Edge case**: If auth routes return 500 and `src/lib/supabase.ts` returns `null`, `.dev.vars` is not being picked up — confirm the file is in the project root, not inside `src/`.

---

## Phase 4 — Cloudflare account + CLI auth ✅ DONE

- [x] Cloudflare account exists
- [x] Wrangler authenticated via OAuth Token
- [x] Verified with `npx wrangler whoami` — account and token confirmed

---

## Phase 5 — Production build + local preview (automated)

- [ ] Clean production build:
  ```sh
  npm run build
  ```
  The `astro:env/server` schema marks secrets as `optional: true`, so the build succeeds without `.dev.vars`. A clean build confirms the adapter and compatibility flags are correct.
- [ ] Preview the production build locally:
  ```sh
  npm run preview
  ```
  Runs against `dist/` in `workerd` mode. Test the auth flow here before deploying.

**Edge case**: Supabase errors at preview time (not build time) mean `.dev.vars` is not being picked up — file must be in project root.

---

## Phase 6 — Wire production secrets (manual gate)

Secrets are write-only after setting — Cloudflare cannot return them. Set carefully.

- [ ] `npx wrangler secret put SUPABASE_URL` — paste Project URL from Phase 2a
- [ ] `npx wrangler secret put SUPABASE_KEY` — paste anon key from Phase 2a
- [ ] Verify:
  ```sh
  npx wrangler secret list
  ```
  Should show both keys (values hidden).

---

## Phase 7 — First deploy (automated)

- [ ] Deploy:
  ```sh
  npx wrangler deploy
  ```
  Note the deployed URL: `https://wattwise.<your-subdomain>.workers.dev`
- [ ] Stream live logs (separate terminal):
  ```sh
  npx wrangler tail --format pretty
  ```
- [ ] Test critical paths on the production URL:
  - [ ] Homepage loads
  - [ ] `/auth/signin` renders
  - [ ] Sign-in with a real Supabase account succeeds
  - [ ] `/dashboard` redirected for unauthenticated users
  - [ ] `/dashboard` accessible after sign-in
- [ ] Go back to Supabase Dashboard → Authentication → URL Configuration and set **Site URL** to the deployed Workers URL (from the step above)

**Edge case — 500 on auth routes**: Check `wrangler tail` for `vm`/`net`/`child_process` module errors — means a transitive Supabase dependency uses an unsupported Node API. Mitigation: pin `@supabase/ssr` to the current tested version and re-deploy.

**Edge case — Supabase cookies not persisting**: `@supabase/ssr` reads cookies from `request.headers` and sets them via Astro's cookie API. If sessions don't persist across requests, verify `src/middleware.ts` calls `supabase.auth.getUser()` (not `getSession()`) — this is already correct in the current code.

**Edge case — CPU time limit**: Open Cloudflare Dashboard → Workers → `wattwise` → Metrics. If any route approaches 30ms CPU time, upgrade to Workers Paid ($5/month) before public launch.

---

## Phase 8 — CI/CD wiring ✅ DONE (repo configured)

### 8a — Fix branch mismatch (automated)

**File**: `.github/workflows/ci.yml`

The workflow targets `master`; repo uses `main`. Fix both triggers:
```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
```

### 8b — Add deploy job (automated)

Add after the existing `ci` job — runs only on push to `main`, not on PRs:

```yaml
deploy:
  needs: ci
  runs-on: ubuntu-latest
  if: github.ref == 'refs/heads/main' && github.event_name == 'push'
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 22
        cache: npm
    - run: npm ci
    - run: npm run build
      env:
        SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
        SUPABASE_KEY: ${{ secrets.SUPABASE_KEY }}
    - run: npx wrangler deploy
      env:
        CLOUDFLARE_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
```

### 8c — Create a scoped Cloudflare API token (manual gate)

Do NOT use your account's Global API Key:
1. Cloudflare Dashboard → My Profile → API Tokens → Create Token
2. Template: **Edit Cloudflare Workers**
3. Scope: Account = your account; Zone = All zones (or lock to this Worker)
4. Copy the token — shown only once

### 8d — Add GitHub Actions secrets (manual gate)

GitHub repo → Settings → Secrets and variables → Actions → New repository secret:
- [ ] `CF_API_TOKEN` — scoped Cloudflare token from 8c
- [ ] `SUPABASE_URL` — same value used in Phase 6
- [ ] `SUPABASE_KEY` — same value used in Phase 6

---

## Phase 9 — Post-deploy verification

- [ ] Push a commit to `main` — verify GitHub Actions runs lint → build → deploy successfully
- [ ] Check Actions log for `wrangler deploy` output and deployed URL
- [ ] Re-test production URL after the CI deploy
- [ ] Cloudflare Dashboard → Workers → `wattwise` → Logs — confirm observability is active
- [ ] `npx wrangler deployments list` — confirm version history is tracking

**Rollback procedure**:
```sh
npx wrangler rollback                   # revert to previous deployment
npx wrangler deployments list           # list all versions with IDs
npx wrangler rollback [VERSION_ID]      # target a specific version
```
Rollback reverts Worker code only — Supabase DB state is not rolled back.

---

## Files modified by this plan

| File | Change | When |
|---|---|---|
| `wrangler.jsonc` | Rename worker, add `disable_nodejs_process_v2`, add Smart Placement | Phase 1 |
| `supabase/config.toml` | Fix `project_id` → `wattwise`, fix `site_url` port 3000 → 4321 | Phase 2b |
| `.github/workflows/ci.yml` | Fix `master` → `main` branch refs, add deploy job | Phase 8a/b |
| `.dev.vars` | Create with real Supabase credentials (manual, gitignored) | Phase 3 |

**Not modified**: `astro.config.mjs`, `src/middleware.ts`, `src/lib/supabase.ts`, `package.json` — already correct.

---

## Risk register

| Risk | Likelihood | Mitigation in this plan |
|---|---|---|
| `nodejs_compat` + process v2 breaks SSR | Medium | Phase 1: `disable_nodejs_process_v2` flag added |
| Supabase latency from wrong edge PoP | Medium | Phase 1: Smart Placement enabled |
| Supabase auth site_url misconfigured → email redirects fail | Medium | Phase 2d + Phase 7: update Site URL after first deploy |
| Email confirmation behaviour differs locally vs production | Medium | Phase 2d: explicit decision gate (Option A/B) |
| CPU time limit (30ms free tier) | High | Phase 7: check Cloudflare Metrics before public launch |
| Supabase SSR cookie handling breaks | Low | Phase 7: end-to-end auth smoke test in production |
| Missing GitHub Actions secrets fail CI | Medium | Phase 8c/d: explicit manual gates for token + secrets |
| Wrong deploy command (Pages vs Workers) | High | Mitigated: `wrangler.jsonc` uses Workers shape (`main` entrypoint) |
| `seed.sql` referenced in config.toml but missing | Low | Phase 2f: create before running `db reset` if seeding is needed |
