import { useCallback, useState } from "react";
import type { SessionStatusUpdate } from "@/types";

export type MutateResult = { ok: true } | { ok: false; error: string };

/**
 * Owns the POST + error-mapping for a session-status change, mirroring how
 * `usePlanGeneration` owns its fetch concern. It deliberately does NOT touch
 * the plan island's state: the island applies the optimistic update and
 * rollback itself, calling `mutate` only to learn whether the write succeeded.
 *
 * `pending` reflects an in-flight request so the UI can disable controls.
 */
export function useSessionStatus(): {
  mutate: (sessionId: string, input: SessionStatusUpdate) => Promise<MutateResult>;
  pending: boolean;
} {
  const [pending, setPending] = useState(false);

  const mutate = useCallback(async (sessionId: string, input: SessionStatusUpdate): Promise<MutateResult> => {
    setPending(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (res.ok) {
        return { ok: true };
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, error: body?.error ?? "Couldn't update the session. Please try again." };
    } catch {
      return { ok: false, error: "Network error. Please check your connection and try again." };
    } finally {
      setPending(false);
    }
  }, []);

  return { mutate, pending };
}
