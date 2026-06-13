import { useCallback, useEffect, useRef, useState } from "react";

export type GenerationStatus = "generating" | "error";

/**
 * Drives generate-on-load for the dashboard when no active plan exists yet.
 *
 * The generate endpoint is idempotent and returns only the plan row (not its
 * sessions), so on success we reload the page: the server re-renders the
 * dashboard with the active plan AND its sessions, landing the island in its
 * "ready" branch with the full data from the source of truth.
 *
 * Double-fire guard: an in-flight ref means React 19 StrictMode's
 * double-invoked effect, a rapid remount, or a stray retry click can't issue
 * two concurrent POSTs. The route's 23505-as-idempotent-win handles any race
 * that still slips through (e.g. a second tab).
 *
 * Reload-loop guard: on success we set a one-shot sessionStorage flag before
 * reloading. If the post-reload server render still finds no active plan (e.g.
 * read-replica lag that hasn't resolved) and re-mounts this island, the flag is
 * present, so instead of generating + reloading again we surface an error —
 * a persistent server/replica inconsistency can't loop reloads (see plan.md F3).
 */
const RELOAD_FLAG = "wattwise:plan-generated";
export function usePlanGeneration(enabled: boolean): {
  status: GenerationStatus;
  error: string | null;
  retry: () => void;
} {
  const [status, setStatus] = useState<GenerationStatus>("generating");
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  // No synchronous setState here: status starts "generating", and we only flip
  // to "error" after the awaited fetch resolves. This keeps the effect-driven
  // first call free of cascading renders (retry resets state in a handler).
  const generate = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;

    // One-shot reload guard: if we already generated and reloaded once but the
    // server still rendered this generate-on-load island (no active plan —
    // e.g. unresolved read-replica lag), stop. Surface an error and let the
    // user retry manually rather than looping reloads.
    if (sessionStorage.getItem(RELOAD_FLAG)) {
      sessionStorage.removeItem(RELOAD_FLAG);
      setError("We saved your plan but couldn't load it. Please try again in a moment.");
      setStatus("error");
      inFlight.current = false;
      return;
    }

    try {
      const res = await fetch("/api/plans/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) {
        // Reload so the server render supplies the plan + its sessions. Set the
        // one-shot flag first so a persistent post-reload miss errors instead
        // of looping. Keep `inFlight` true and status "generating" through nav.
        sessionStorage.setItem(RELOAD_FLAG, "1");
        window.location.reload();
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "We couldn't generate your plan. Please try again.");
      setStatus("error");
      inFlight.current = false;
    } catch {
      setError("Network error. Please check your connection and try again.");
      setStatus("error");
      inFlight.current = false;
    }
  }, []);

  const retry = useCallback(() => {
    // Clear the one-shot flag so a user-initiated retry can generate + reload
    // again (the guard only exists to stop *automatic* reload loops).
    sessionStorage.removeItem(RELOAD_FLAG);
    setStatus("generating");
    setError(null);
    void generate();
  }, [generate]);

  useEffect(() => {
    if (enabled) {
      // Generate-on-mount is the intended behavior here. Any setState inside
      // `generate` happens only after the awaited fetch resolves (not a
      // synchronous cascading render), and the in-flight ref prevents the
      // StrictMode double-invoke from firing two requests.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void generate();
    }
  }, [enabled, generate]);

  return { status, error, retry };
}
