---
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
---

## Why this stack

WattWise is a solo-built web app targeting small-scale hobbyist cyclists, with a 6-week after-hours MVP timeline. Auth (email+password, FR-001/FR-003) and AI-generated training plans (FR-004/FR-013) map cleanly to the `10x-astro-starter` strengths: Supabase ships auth and PostgreSQL out of the box, while AI plan generation drops into Astro API routes without friction via OpenRouter's OpenAI-compatible REST API (plain `fetch`, no vendor SDK — keeps the workerd bundle lean) routing to a config-driven model (`OPENROUTER_MODEL`, currently `anthropic/claude-sonnet-4.5`); `models[]` + `route: "fallback"` gives provider redundancy and a one-string model swap. (S-02 superseded the earlier "Anthropic SDK" wording — see `context/changes/first-plan-generation/`.) The starter clears all four agent-friendly gates — typed (TypeScript project-wide), convention-based (Astro file routing + Supabase SDK), popular in training data, and well-documented — making it a low-friction choice for solo AI-assisted development. Cloudflare Pages is the cost-optimal edge deploy for a low-QPS hobby app with no sustained background compute. Standard path was taken; the recommended default for `(web-app, js)` was accepted without modification. CI runs on GitHub Actions with auto-deploy-on-merge. AI plan generation is not bundled in the starter and must be wired in as a first step after scaffolding.
