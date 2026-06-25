import { useRef, useState } from "react";
import { z } from "zod";
import { Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

import { DAY_CODES, TRAINING_GOALS } from "@/lib/onboarding-schema";
import { renewalInputSchema } from "@/lib/renewal-schema";
import type { Profile, TrainingGoal } from "@/types";
import type { DayCode } from "@/components/hooks/useOnboardingDraft";

// Display labels — UI concern, kept alongside the form (mirrors ProfileForm).
const GOAL_LABELS: Record<TrainingGoal, string> = {
  fitness_health: "General fitness & health",
  endurance: "Build endurance",
  speed_racing: "Speed & racing",
};

const DAY_LABELS: Record<DayCode, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

/** Parse a number input's string value, returning undefined for blank/NaN. */
function toNum(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isNaN(n) ? undefined : n;
}

// The renewal-editable fields. Numeric fields allow `undefined` so a cleared
// input fails client validation (and disables Confirm) rather than coercing to 0.
// `ftp_watts` is only meaningful for power-meter users (gated in the UI + route).
interface RenewalFields {
  goal: TrainingGoal;
  available_days: DayCode[];
  max_workday_minutes: number | undefined;
  max_weekend_minutes: number | undefined;
  ftp_watts: number | undefined;
}

/** Seed editable state from the loaded profile row. Days are filtered through
 *  DAY_CODES so the array is always in canonical order. */
function fieldsFromProfile(profile: Profile): RenewalFields {
  return {
    goal: profile.goal,
    available_days: DAY_CODES.filter((d) => profile.available_days.includes(d)),
    max_workday_minutes: profile.max_workday_minutes,
    max_weekend_minutes: profile.max_weekend_minutes,
    ftp_watts: profile.equipment_type === "power_meter" ? (profile.ftp_watts ?? undefined) : undefined,
  };
}

/** Build the candidate payload from the current fields, fed to `safeParse` for
 *  validation. Kept loosely typed (numeric fields may be `undefined` when
 *  cleared — the schema rejects those, gating Confirm). FTP is included only for
 *  power-meter users — the route never trusts a client-supplied equipment type,
 *  and we also avoid sending an FTP value for hrm/none profiles. */
function toPayload(fields: RenewalFields, isPowerMeter: boolean): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    goal: fields.goal,
    available_days: fields.available_days,
    max_workday_minutes: fields.max_workday_minutes,
    max_weekend_minutes: fields.max_weekend_minutes,
  };
  if (isPowerMeter && fields.ftp_watts != null) {
    payload.ftp_watts = fields.ftp_watts;
  }
  return payload;
}

export default function RenewalForm({ profile }: { profile: Profile }) {
  const isPowerMeter = profile.equipment_type === "power_meter";

  const [fields, setFields] = useState<RenewalFields>(() => fieldsFromProfile(profile));
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [serverFieldErrors, setServerFieldErrors] = useState<Record<string, string[] | undefined>>({});
  // In-flight guard: a rapid double-click or stray retry can't issue two
  // concurrent POSTs (same intent as usePlanGeneration's ref, reimplemented
  // locally — this form owns its own endpoint and success navigation).
  const inFlight = useRef(false);

  function patch(next: Partial<RenewalFields>) {
    setFields((f) => ({ ...f, ...next }));
    setSubmitError(null);
  }

  function markTouched(field: string) {
    setTouched((prev) => (prev.has(field) ? prev : new Set(prev).add(field)));
  }

  function toggleDay(day: DayCode) {
    markTouched("available_days");
    const has = fields.available_days.includes(day);
    const next = has
      ? fields.available_days.filter((d) => d !== day)
      : DAY_CODES.filter((d) => d === day || fields.available_days.includes(d));
    patch({ available_days: next });
  }

  // --- Client-side validation (gates Confirm, surfaces inline errors) ---
  const payload = toPayload(fields, isPowerMeter);
  const parsed = renewalInputSchema.safeParse(payload);
  const clientErrors = parsed.success ? {} : z.flattenError(parsed.error).fieldErrors;
  // Power-meter users must supply an FTP — a route-level rule the schema keeps
  // optional, mirrored here so Confirm is gated client-side too.
  const ftpMissing = isPowerMeter && fields.ftp_watts == null;

  function fieldError(field: string): string | undefined {
    const serverErr = serverFieldErrors[field]?.[0];
    if (serverErr) return serverErr;
    if (!touched.has(field)) return undefined;
    return (clientErrors as Record<string, string[] | undefined>)[field]?.[0];
  }

  const canSubmit = parsed.success && !ftpMissing && !generating;

  async function handleSubmit() {
    if (!parsed.success || ftpMissing || inFlight.current) return;
    inFlight.current = true;
    setGenerating(true);
    setSubmitError(null);
    setServerFieldErrors({});
    try {
      const res = await fetch("/api/plans/renew", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (res.ok) {
        // Server has superseded the old plan and activated the new one. Navigate
        // to the dashboard, which server-renders the fresh active plan + sessions.
        window.location.assign("/dashboard");
        return;
      }
      const body = (await res.json().catch(() => null)) as {
        error?: string;
        fieldErrors?: Record<string, string[] | undefined>;
      } | null;
      if (body?.fieldErrors) setServerFieldErrors(body.fieldErrors);
      setSubmitError(body?.error ?? "We couldn't renew your plan. Please try again.");
      setGenerating(false);
      inFlight.current = false;
    } catch {
      setSubmitError("Network error. Please check your connection and try again.");
      setGenerating(false);
      inFlight.current = false;
    }
  }

  // While the synchronous regeneration runs (~22s), take over with a progress
  // panel — adapted from PlanView.tsx's PlanGenerating (copied, not imported, so
  // the first-plan flow stays untouched).
  if (generating) {
    return (
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/10 p-8 text-center text-white backdrop-blur-xl">
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <Loader2 className="size-8 animate-spin text-blue-200" aria-hidden />
          <h2 className="text-lg font-semibold text-white">Building your next 4-week plan…</h2>
          <p className="max-w-sm text-sm text-blue-100/70">
            Our coach is mapping your updated goal, availability, and fitness into a fresh training plan. This usually
            takes a few seconds.
          </p>
          <div
            className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-white/10"
            role="status"
            aria-label="Generating your plan"
          >
            <div className="h-full w-1/3 animate-pulse rounded-full bg-gradient-to-r from-blue-300 to-purple-300" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-lg space-y-6 rounded-2xl border border-white/10 bg-white/10 p-6 text-white backdrop-blur-xl sm:p-8">
      <div>
        <h1 className="text-xl font-semibold">Your plan has ended — let&apos;s renew it</h1>
        <p className="mt-1 text-sm text-blue-100/70">
          Confirm or update your check-in below. We&apos;ll generate a fresh 4-week plan from your latest answers.
        </p>
      </div>

      {/* Goal */}
      <Section title="Training goal">
        <RadioGroup
          value={fields.goal}
          onValueChange={(v) => {
            markTouched("goal");
            patch({ goal: v as TrainingGoal });
          }}
          className="gap-2"
        >
          {TRAINING_GOALS.map((goal) => (
            <OptionRow key={goal} htmlFor={`goal-${goal}`}>
              <RadioGroupItem id={`goal-${goal}`} value={goal} />
              <span>{GOAL_LABELS[goal]}</span>
            </OptionRow>
          ))}
        </RadioGroup>
        <FieldError message={fieldError("goal")} />
      </Section>

      {/* Availability */}
      <Section title="Weekly availability">
        <div className="space-y-2">
          <Label className="text-blue-100/80">Which days can you train?</Label>
          <div className="flex flex-wrap gap-2">
            {DAY_CODES.map((day) => {
              const checked = fields.available_days.includes(day);
              return (
                <label
                  key={day}
                  className="flex cursor-pointer items-center gap-2 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => {
                      toggleDay(day);
                    }}
                  />
                  <span>{DAY_LABELS[day]}</span>
                </label>
              );
            })}
          </div>
          <FieldError message={fieldError("available_days")} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <NumberField
            id="max_workday_minutes"
            label="Max weekday minutes"
            value={fields.max_workday_minutes}
            onChange={(n) => {
              patch({ max_workday_minutes: n });
            }}
            onBlur={() => {
              markTouched("max_workday_minutes");
            }}
            error={fieldError("max_workday_minutes")}
            placeholder="15–360"
          />
          <NumberField
            id="max_weekend_minutes"
            label="Max weekend minutes"
            value={fields.max_weekend_minutes}
            onChange={(n) => {
              patch({ max_weekend_minutes: n });
            }}
            onBlur={() => {
              markTouched("max_weekend_minutes");
            }}
            error={fieldError("max_weekend_minutes")}
            placeholder="15–600"
          />
        </div>
      </Section>

      {/* FTP — power-meter users only. Confirming promotes the value to a
          measured FTP (the only place FTP is editable; see ProfileForm copy). */}
      {isPowerMeter && (
        <Section title="Current FTP">
          <NumberField
            id="ftp_watts"
            label="FTP (watts)"
            value={fields.ftp_watts}
            onChange={(n) => {
              patch({ ftp_watts: n });
            }}
            onBlur={() => {
              markTouched("ftp_watts");
            }}
            error={fieldError("ftp_watts")}
            placeholder="50–600"
          />
          <p className="text-xs text-blue-100/50">
            Enter your current FTP. Confirming saves it as a measured value for your new plan.
          </p>
        </Section>
      )}

      <div className="flex items-center justify-end gap-3 border-t border-white/10 pt-5">
        <FieldError message={submitError} />
        <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
          <RefreshCw className="size-4" /> Confirm &amp; generate plan
        </Button>
      </div>
    </div>
  );
}

// --- Small presentational helpers (local to the form, mirroring ProfileForm) ---

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold tracking-wide text-blue-100/80 uppercase">{title}</h2>
      {children}
    </section>
  );
}

function OptionRow({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      className="flex cursor-pointer items-center gap-3 rounded-md border border-white/15 bg-white/5 px-4 py-3 text-sm transition-colors hover:bg-white/10"
    >
      {children}
    </label>
  );
}

function NumberField({
  id,
  label,
  value,
  onChange,
  onBlur,
  error,
  placeholder,
}: {
  id: string;
  label: string;
  value: number | undefined;
  onChange: (n: number | undefined) => void;
  onBlur: () => void;
  error?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-blue-100/80">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(toNum(e.target.value));
        }}
        onBlur={onBlur}
        aria-invalid={error ? true : undefined}
        className="border-white/20 bg-white/5 text-white placeholder:text-blue-100/40"
      />
      <FieldError message={error} />
    </div>
  );
}

function FieldError({ message }: { message?: string | null }) {
  if (!message) return null;
  return <p className="text-sm text-red-300">{message}</p>;
}
