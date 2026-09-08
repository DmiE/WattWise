# WattWise

Prescriptive training plans for self-coached road cyclists.

Strava and TrainingPeaks analyse the ride you already did. WattWise tells you what to
ride next. Give it your FTP (or let it estimate one), your goal, and the days you can
train — it generates a structured 4-week plan where every session carries a type, a
duration, and intensity targets in the unit your equipment can actually verify: **watts**
for a power meter, **heart-rate zones** for an HRM, **RPE** if you ride without either.

When the block ends, a renewal check-in asks what changed and generates the next one.

## Features

|                     | Capability                                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Auth                | Email + password sign-up, sign-in, sign-out (`FR-001`, `FR-003`)                                                                                                         |
| Onboarding          | Age, weight, goal, equipment, availability and duration caps — with an explicit "I don't know my FTP" path that estimates it from self-reported fitness level (`FR-002`) |
| Plan generation     | AI-generated 28-day plan after a review-and-confirm step; the generated payload is validated against the athlete's profile before anything is persisted (`FR-004`)       |
| Session detail      | Type, duration, and segment-by-segment intensity targets matched to declared equipment (`FR-005`)                                                                        |
| Plan overview       | Week view across the full four weeks (`FR-006`)                                                                                                                          |
| Session tracking    | Mark a session done or skipped; on done, log actual duration, subjective rating, and km ridden (`FR-007`, `FR-008`)                                                      |
| History             | Every completed session across current and past plans, newest first (`FR-009`)                                                                                           |
| Profile editing     | Update goal, availability, and duration caps after onboarding (`FR-010`)                                                                                                 |
| Intensity reference | In-session legend for power zones, HR zones, and the RPE scale (`FR-011`)                                                                                                |
| Plan renewal        | Check-in when the block expires, then a fresh 4-week plan reflecting the updates (`FR-012`, `FR-013`)                                                                    |

## Product documentation

This project was built from a written foundation, and that foundation is the best place
to start reading:

| Document                                                                       | What it covers                                                                                                          |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| [`context/foundation/prd.md`](context/foundation/prd.md)                       | Problem, persona, success criteria, user stories, functional and non-functional requirements, access control, non-goals |
| [`context/foundation/roadmap.md`](context/foundation/roadmap.md)               | Delivery slices in dependency order                                                                                     |
| [`context/foundation/tech-stack.md`](context/foundation/tech-stack.md)         | Why this stack                                                                                                          |
| [`context/foundation/test-plan.md`](context/foundation/test-plan.md)           | Risk map, phased test rollout, quality gates, and the unit-test cookbook                                                |
| [`context/foundation/infrastructure.md`](context/foundation/infrastructure.md) | Deployment platform comparison and risk register                                                                        |
| [`context/archive/`](context/archive/)                                         | Eight closed change slices, each with its plan and implementation review                                                |
| [`CLAUDE.md`](CLAUDE.md)                                                       | Repository conventions for AI coding agents                                                                             |

## Tech Stack

- [Astro](https://astro.build/) v6 — full SSR (`output: "server"`), file-based routing
- [React](https://react.dev/) v19 — interactive islands only (onboarding wizard, plan view, forms)
- [TypeScript](https://www.typescriptlang.org/) v5 — type-checked ESLint rules
- [Tailwind CSS](https://tailwindcss.com/) v4 + [shadcn/ui](https://ui.shadcn.com/) ("new-york" variant)
- [Supabase](https://supabase.com/) — auth and PostgreSQL, with row-level security as the sole isolation mechanism
- [OpenRouter](https://openrouter.ai/) — AI gateway for plan generation (plain `fetch`, no vendor SDK)
- [zod](https://zod.dev/) v4 — request validation and the LLM-output trust boundary
- [Vitest](https://vitest.dev/) v4 — unit tests
- [Cloudflare Workers](https://workers.cloudflare.com/) — edge deployment runtime

## Prerequisites

- Node.js v22.14.0 (as specified in `.nvmrc`)
- npm (comes with Node.js)
- A [Supabase](https://supabase.com/) project
- An [OpenRouter](https://openrouter.ai/keys) API key — without it, plan generation returns
  a 500 and the core flow cannot complete

## Getting Started

1. Clone the repository:

```bash
git clone <your-fork-or-remote-url> wattwise
cd wattwise
```

2. Install dependencies:

```bash
npm install
```

3. Configure environment variables — see [Environment Variables](#environment-variables)
   below. For the Cloudflare dev runtime the file must be `.dev.vars`:

```bash
cp .env.example .dev.vars
```

4. Apply the database migrations to your Supabase project — see
   [Database](#database) below.

5. Run the development server:

```bash
npm run dev
```

## Available Scripts

- `npm run dev` — start development server (Cloudflare workerd runtime)
- `npm run build` — production build (SSR via `@astrojs/cloudflare`)
- `npm run preview` — preview production build
- `npm test` — run the unit suite once
- `npm run test:watch` — run the unit suite in watch mode
- `npm run lint` — ESLint with type-checked rules
- `npm run lint:fix` — auto-fix lint issues
- `npm run format` — Prettier (includes `prettier-plugin-astro` and `prettier-plugin-tailwindcss`)
- `npm run db:types` — regenerate `src/db/database.types.ts` from the linked Supabase project

Pre-commit hooks (husky + lint-staged) run `eslint --fix` on `*.{ts,tsx,astro}` and
`prettier --write` on `*.{json,css,md}`.

## Project Structure

```text
.
├── src/
│   ├── pages/                 # Astro pages (file-based routing)
│   │   ├── api/               # API endpoints (prerender = false)
│   │   ├── auth/              # Sign-in, sign-up, confirm-email
│   │   └── dashboard.astro    # …plus onboarding, profile, renewal, history
│   ├── components/            # Astro (static) and React (interactive) components
│   │   ├── hooks/             # Extracted React hooks
│   │   └── ui/                # shadcn/ui primitives
│   ├── lib/                   # Pure logic, zod schemas, and services
│   │   ├── services/          # Data access + external I/O (Supabase, OpenRouter)
│   │   └── __fixtures__/      # Test fixture factories
│   ├── layouts/               # Astro layouts
│   ├── db/                    # Generated Supabase types
│   ├── middleware.ts          # Auth + routing gate, runs on every request
│   └── types.ts               # Shared entities and DTOs
├── supabase/migrations/       # SQL migrations (schema, RLS policies, RPCs)
├── context/                   # Product foundation, change plans, archive
├── public/                    # Static assets
└── wrangler.jsonc             # Cloudflare Workers config
```

Path alias: `@/*` maps to `./src/*`.

## Environment Variables

All variables are declared in the `env.schema` block of `astro.config.mjs` and read
through `astro:env/server` — never `process.env`. Every one is **server-only**, so none
of them reach the client bundle. All are declared optional, which lets `npm run build`
and `npm run dev` succeed before they are configured; the features that need them fail
closed at runtime instead.

| Variable                    | Access | Description                                                                                                                        |
| --------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_URL`              | secret | Project URL — Supabase dashboard → Settings → API                                                                                  |
| `SUPABASE_KEY`              | secret | `anon` public key — Supabase dashboard → Settings → API                                                                            |
| `OPENROUTER_API_KEY`        | secret | API key from [openrouter.ai/keys](https://openrouter.ai/keys). Absent → plan generation fails fast with a generic 500              |
| `OPENROUTER_MODEL`          | public | Model slug for plan generation, e.g. `anthropic/claude-sonnet-4.5`. Free option for local development: `openai/gpt-oss-20b:free`   |
| `OPENROUTER_FALLBACK_MODEL` | public | Optional secondary model → OpenRouter `models[]` + `route: "fallback"` for provider redundancy. Unset means a single-model request |

Put them in `.dev.vars` for `npm run dev` (Cloudflare workerd), or `.env` for plain Node
tooling. Both files are gitignored; `.env.example` is the template.

## Database

The project uses a **remote linked Supabase project**. The local Docker stack is kept only
as a commented-out fallback in `.dev.vars` and is not part of the active workflow.

Link the project once, then push the migrations:

```bash
npx supabase link --project-ref <project-ref>
npx supabase db push --linked
npm run db:types
```

After adding a migration, run the last two commands again so the generated types stay in
sync with the schema.

### Schema

Four tables, all with row-level security enabled and **granular per-operation policies**:

| Table           | Holds                                                                               | Ownership                      |
| --------------- | ----------------------------------------------------------------------------------- | ------------------------------ |
| `profiles`      | One row per cyclist: equipment, goal, age, weight, FTP, availability, duration caps | `user_id = auth.uid()`         |
| `plans`         | One 28-day block; at most one `active` per user (partial unique index)              | `user_id = auth.uid()`         |
| `plan_sessions` | The individual sessions of a plan, with their segment structure                     | `EXISTS` up to `plans.user_id` |
| `session_logs`  | Actual duration, rating, and km for a completed session                             | `EXISTS` up to `plans.user_id` |

Two SQL functions handle multi-write transitions that must be atomic. Both are
`security invoker`, so they run under the caller's RLS session — the codebase never uses a
service-role client:

- `set_session_status` — status change plus the log upsert (or log delete, when a session
  is reset or skipped) in one transaction. A 0-row update raises `P0002`, which the API
  maps to a 404 so a caller cannot distinguish "doesn't exist" from "not yours".
- `supersede_and_activate_plan` — retires the old plan and activates the new one in one
  ordered, atomic step, so the one-active-plan invariant never breaks mid-renewal.

### Email confirmation

Supabase requires email confirmation before a user can sign in. To skip it while
developing, open the Supabase dashboard → **Authentication → Email → Confirm email** and
toggle it off. Users can then sign in immediately after sign-up.

## Routes

### Pages

| Route                 | Description                                                         |
| --------------------- | ------------------------------------------------------------------- |
| `/`                   | Public landing page                                                 |
| `/auth/signin`        | Email/password sign-in                                              |
| `/auth/signup`        | Email/password sign-up                                              |
| `/auth/confirm-email` | Post-signup "check your inbox" page                                 |
| `/onboarding`         | Onboarding wizard (redirects to `/dashboard` once a profile exists) |
| `/dashboard`          | Active plan: week overview and session detail                       |
| `/history`            | Completed sessions across all plans                                 |
| `/profile`            | Edit goal, availability, and duration caps                          |
| `/renewal`            | Renewal check-in (only reachable when the active plan has expired)  |

### API

| Endpoint                   | Description                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| `POST /api/auth/signup`    | Register                                                                                      |
| `POST /api/auth/signin`    | Log in                                                                                        |
| `POST /api/auth/signout`   | Log out                                                                                       |
| `POST /api/onboarding`     | Create the profile; FTP, `ftp_source`, fitness level, and max HR are derived server-side      |
| `PATCH /api/profile`       | Update the editable profile fields                                                            |
| `POST /api/plans/generate` | Generate the first plan — idempotent: an existing active plan is returned without an LLM call |
| `POST /api/plans/renew`    | Renewal check-in and regeneration, with atomic supersede                                      |
| `POST /api/sessions/[id]`  | Mark one session `done` / `skipped` / `pending`                                               |

Access is gated in `src/middleware.ts`, which resolves the user into `context.locals.user`
on every request and then decides placement: unauthenticated requests to a protected route
go to `/auth/signin`; an authenticated user without a profile goes to `/onboarding`; a
user whose active plan has expired goes to `/renewal`, with `/history` deliberately exempt
so past work stays readable without renewing first. Add paths to `PROTECTED_ROUTES` to
require authentication.

## Testing

```bash
npm test              # once
npm run test:watch    # watch mode
npx vitest run src/lib/plan.test.ts
```

Unit tests live next to the module under test as `<module>.test.ts`; the runner collects
only `src/**/*.test.ts`, so anything outside that glob is silently ignored. Shared fixture
factories live in `src/lib/__fixtures__/`.

The current suite covers the AI trust boundary — `validateGeneratedPlan` in
`src/lib/plan.ts`, which rejects a generated plan that schedules sessions on unavailable
days, exceeds a duration cap, or whose segments do not sum to the stated duration. It
rejects rather than repairs, and nothing invalid is ever persisted.

Before adding tests, read [`context/foundation/test-plan.md`](context/foundation/test-plan.md):
§2 is the risk map, §6.1 is the unit-test cookbook, and §7 records what is deliberately
not tested and why. Two rules from it are worth repeating here — the expected value in an
assertion must come from a documented business rule rather than from the code under test,
and a guardrail test is not done until you have broken the guardrail and watched it go
red.

`vitest.config.ts` is a standalone config, deliberately **not** Astro's `getViteConfig()`,
which is incompatible with the current version pins. See §6.1 of the test plan before
changing it.

## Deployment

The app deploys to [Cloudflare Workers](https://workers.cloudflare.com/) (see
`wrangler.jsonc`).

1. Build:

```bash
npm run build
```

2. Deploy:

```bash
npx wrangler deploy
```

Set the secrets on the Worker:

```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_KEY
npx wrangler secret put OPENROUTER_API_KEY
```

`OPENROUTER_MODEL` is a plain var and is already set in `wrangler.jsonc`; change it there
to swap models without touching code.

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs lint → unit tests → build on every push
and pull request to `main`. The build step needs `SUPABASE_URL` and `SUPABASE_KEY` as
repository secrets; the test step needs none, because unit tests never resolve the
`astro:env` schema.

## License

MIT
