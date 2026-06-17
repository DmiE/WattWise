import { useState } from "react";
import { z } from "zod";
import { Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

import { DAY_CODES, TRAINING_GOALS } from "@/lib/onboarding-schema";
import { profileEditSchema } from "@/lib/profile-edit-schema";
import type { Profile, TrainingGoal } from "@/types";
import type { DayCode } from "@/components/hooks/useOnboardingDraft";

// Display labels — UI concern, kept alongside the form rather than in the shared
// schema (mirrors OnboardingWizard.tsx).
const GOAL_LABELS: Record<TrainingGoal, string> = {
  fitness_health: "General fitness & health",
  endurance: "Build endurance",
  speed_racing: "Speed & racing",
};

const FITNESS_LABELS: Record<NonNullable<Profile["fitness_level"]>, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

const FTP_SOURCE_LABELS: Record<NonNullable<Profile["ftp_source"]>, string> = {
  measured: "measured",
  estimated: "estimated",
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

// The six FR-010-editable fields. Numeric fields allow `undefined` so a cleared
// input fails client validation (and disables Save) rather than coercing to 0.
interface EditFields {
  goal: TrainingGoal;
  age: number | undefined;
  weight_kg: number | undefined;
  available_days: DayCode[];
  max_workday_minutes: number | undefined;
  max_weekend_minutes: number | undefined;
}

/** Seed editable state from the loaded profile row. Days are filtered through
 *  DAY_CODES so the array is always in canonical order — keeps the dirty compare
 *  order-stable (a toggle-off/on can't falsely mark the form dirty). */
function fieldsFromProfile(profile: Profile): EditFields {
  return {
    goal: profile.goal,
    age: profile.age,
    weight_kg: profile.weight_kg,
    available_days: DAY_CODES.filter((d) => profile.available_days.includes(d)),
    max_workday_minutes: profile.max_workday_minutes,
    max_weekend_minutes: profile.max_weekend_minutes,
  };
}

/** Structural equality of two field sets. available_days is canonical-ordered
 *  (see fieldsFromProfile), so a positional compare is sufficient. */
function fieldsEqual(a: EditFields, b: EditFields): boolean {
  return (
    a.goal === b.goal &&
    a.age === b.age &&
    a.weight_kg === b.weight_kg &&
    a.max_workday_minutes === b.max_workday_minutes &&
    a.max_weekend_minutes === b.max_weekend_minutes &&
    a.available_days.length === b.available_days.length &&
    a.available_days.every((d, i) => d === b.available_days[i])
  );
}

export default function ProfileForm({ profile }: { profile: Profile }) {
  const [fields, setFields] = useState<EditFields>(() => fieldsFromProfile(profile));
  // Baseline the dirty flag compares against; reset to the submitted values on a
  // successful save so Save re-disables without a page reload.
  const [savedSnapshot, setSavedSnapshot] = useState<EditFields>(() => fieldsFromProfile(profile));

  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [serverFieldErrors, setServerFieldErrors] = useState<Record<string, string[] | undefined>>({});
  const [saved, setSaved] = useState(false);

  function patch(next: Partial<EditFields>) {
    setFields((f) => ({ ...f, ...next }));
    // Any edit invalidates the prior success state.
    setSaved(false);
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

  // --- Client-side validation (gates Save, surfaces inline errors) ---
  const parsed = profileEditSchema.safeParse(fields);
  const clientErrors = parsed.success ? {} : z.flattenError(parsed.error).fieldErrors;

  function fieldError(field: string): string | undefined {
    // Server errors (from a failed PATCH) always show; client errors only after
    // the field is touched, matching the wizard's behaviour.
    const serverErr = serverFieldErrors[field]?.[0];
    if (serverErr) return serverErr;
    if (!touched.has(field)) return undefined;
    return (clientErrors as Record<string, string[] | undefined>)[field]?.[0];
  }

  const dirty = !fieldsEqual(fields, savedSnapshot);
  const canSave = parsed.success && dirty && !submitting;

  async function handleSave() {
    if (!parsed.success) return;
    setSubmitting(true);
    setSubmitError(null);
    setServerFieldErrors({});
    setSaved(false);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (res.ok) {
        // Re-baseline to the just-saved values so Save re-disables, no reload.
        setSavedSnapshot(parsed.data);
        setSaved(true);
        return;
      }
      const body = (await res.json().catch(() => null)) as {
        error?: string;
        fieldErrors?: Record<string, string[] | undefined>;
      } | null;
      if (body?.fieldErrors) setServerFieldErrors(body.fieldErrors);
      setSubmitError(body?.error ?? "Could not save your profile. Please try again.");
    } catch {
      setSubmitError("Network error. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="w-full max-w-lg space-y-6 rounded-2xl border border-white/10 bg-white/10 p-6 text-white backdrop-blur-xl sm:p-8">
      <div>
        <h1 className="text-xl font-semibold">Your profile</h1>
        <p className="mt-1 text-sm text-blue-100/70">Changes apply to your next plan; your current plan stays as-is.</p>
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

      {/* Body */}
      <Section title="About you">
        <div className="grid grid-cols-2 gap-4">
          <NumberField
            id="age"
            label="Age"
            value={fields.age}
            onChange={(n) => {
              patch({ age: n });
            }}
            onBlur={() => {
              markTouched("age");
            }}
            error={fieldError("age")}
            placeholder="14–100"
          />
          <NumberField
            id="weight_kg"
            label="Weight (kg)"
            value={fields.weight_kg}
            onChange={(n) => {
              patch({ weight_kg: n });
            }}
            onBlur={() => {
              markTouched("weight_kg");
            }}
            error={fieldError("weight_kg")}
            placeholder="30–200"
          />
        </div>
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

      {/* Read-only fixed fields */}
      <Section title="Fitness & equipment">
        <dl className="divide-y divide-white/10 text-sm">
          {profile.equipment_type === "power_meter" ? (
            <ReadOnlyRow
              label="FTP"
              value={
                profile.ftp_watts != null
                  ? `${profile.ftp_watts} W${profile.ftp_source ? ` (${FTP_SOURCE_LABELS[profile.ftp_source]})` : ""}`
                  : "—"
              }
            />
          ) : (
            <ReadOnlyRow
              label="Fitness level"
              value={profile.fitness_level ? FITNESS_LABELS[profile.fitness_level] : "—"}
            />
          )}
          {profile.equipment_type === "hrm" && (
            <ReadOnlyRow label="Max heart rate" value={profile.max_hr != null ? `${profile.max_hr} bpm` : "—"} />
          )}
        </dl>
        <p className="text-xs text-blue-100/50">FTP can only be updated at plan renewal.</p>
      </Section>

      <div className="flex items-center justify-end gap-3 border-t border-white/10 pt-5">
        {saved && !dirty && <span className="text-sm text-emerald-300">Saved</span>}
        <FieldError message={submitError} />
        <Button type="button" onClick={handleSave} disabled={!canSave}>
          {submitting ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Saving…
            </>
          ) : (
            <>
              <Check className="size-4" /> Save
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

// --- Small presentational helpers (local to the form) ---

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

function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2">
      <dt className="text-blue-100/60">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function FieldError({ message }: { message?: string | null }) {
  if (!message) return null;
  return <p className="text-sm text-red-300">{message}</p>;
}
