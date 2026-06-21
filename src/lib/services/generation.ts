// Shared generation primitives for the plan routes (generate + renew). Lifted
// out of `generate.ts` so the first-plan and renewal paths share one source of
// truth — the retry cap and upstream budget can't silently diverge between them.

/** JSON Response helper used by both plan routes. */
export const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// Route-level generation attempts. The OpenRouter client already retries
// transport faults (network / 5xx / 429); this loop additionally retries when a
// transport-OK response fails the SEMANTIC trust boundary (zod + equipment /
// availability / duration). Total LLM calls = MAX_GENERATION_ATTEMPTS.
export const MAX_GENERATION_ATTEMPTS = 2;

// Overall upstream-wait budget shared across all generation attempts. Without
// it the two retry layers (route attempts × the client's transport retries)
// multiply into minutes on a degraded upstream. The deadline is passed into
// generateStructured, which caps each transport attempt to the time remaining
// and stops retrying once it passes (see plan.md F2).
export const GENERATION_BUDGET_MS = 90_000;
