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
 */
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
    try {
      const res = await fetch("/api/plans/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) {
        // Reload so the server render supplies the plan + its sessions. Keep
        // `inFlight` true and status "generating" through the navigation.
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
