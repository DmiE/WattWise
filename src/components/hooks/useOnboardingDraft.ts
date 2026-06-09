import { useCallback, useEffect, useRef, useState } from "react";
import type { EquipmentType, FitnessLevel, TrainingGoal } from "@/types";
import { DAY_CODES } from "@/lib/onboarding-schema";

// localStorage-backed draft persistence for the onboarding wizard.
//
// Persists `{ answers, step }` on every change and rehydrates on mount so a
// browser close mid-wizard doesn't lose data (PRD guardrail). Cleared on a
// successful submit. Device-local only — no server-side draft (see plan
// "What We're NOT Doing").

const STORAGE_KEY = "wattwise:onboarding-draft";

export type DayCode = (typeof DAY_CODES)[number];

/**
 * The wizard's in-progress *input* answers. Numeric fields are optional (a
 * blank input is `undefined`) and stay un-derived — server-side derivation of
 * FTP / fitness_level / max_hr happens in the API route, not here.
 */
export interface OnboardingAnswers {
  goal?: TrainingGoal;
  equipment_type?: EquipmentType;
  knows_ftp?: boolean;
  ftp_watts?: number;
  fitness_level?: FitnessLevel;
  max_hr?: number;
  age?: number;
  weight_kg?: number;
  available_days: DayCode[];
  max_workday_minutes?: number;
  max_weekend_minutes?: number;
}

export interface OnboardingDraft {
  answers: OnboardingAnswers;
  step: number;
}

const EMPTY_DRAFT: OnboardingDraft = {
  answers: { available_days: [] },
  step: 1,
};

function readDraft(): OnboardingDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    // Defensive: ensure the shape is sane even if the stored JSON is partial.
    const obj = parsed as Partial<OnboardingDraft>;
    return {
      answers: { available_days: [], ...obj.answers },
      step: typeof obj.step === "number" ? obj.step : 1,
    };
  } catch {
    // Malformed JSON (or a disabled/throwing localStorage) → start fresh.
    return null;
  }
}

type DraftUpdater = OnboardingDraft | ((prev: OnboardingDraft) => OnboardingDraft);

/**
 * Returns `[draft, setDraft, clearDraft]`. SSR-safe: the first render returns
 * the empty draft (matching the server), then a mount effect rehydrates from
 * localStorage. Writes are skipped until after that initial load so the empty
 * default never clobbers a stored draft.
 */
export function useOnboardingDraft(): [OnboardingDraft, (updater: DraftUpdater) => void, () => void] {
  const [draft, setDraftState] = useState<OnboardingDraft>(EMPTY_DRAFT);
  const hydrated = useRef(false);

  useEffect(() => {
    // Rehydrate once, post-mount. This must run in an effect (not a lazy
    // useState initializer): reading localStorage during render would diverge
    // from the server's empty-draft render and trigger a hydration mismatch.
    const stored = readDraft();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot SSR rehydration, see above
    if (stored) setDraftState(stored);
    hydrated.current = true;
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    } catch {
      // Storage full or unavailable — drafting is best-effort, ignore.
    }
  }, [draft]);

  const setDraft = useCallback((updater: DraftUpdater) => {
    setDraftState((prev) => (typeof updater === "function" ? updater(prev) : updater));
  }, []);

  const clearDraft = useCallback(() => {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
    }
    setDraftState(EMPTY_DRAFT);
  }, []);

  return [draft, setDraft, clearDraft];
}
