import { useState } from "react";
import { z } from "zod";
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import {
  DAY_CODES,
  FITNESS_LEVELS,
  TRAINING_GOALS,
  bodyStepSchema,
  equipmentStepSchema,
  goalStepSchema,
  onboardingInputSchema,
} from "@/lib/onboarding-schema";
import { defaultMaxHr } from "@/lib/onboarding";
import type { EquipmentType, FitnessLevel, TrainingGoal } from "@/types";
import { useOnboardingDraft, type DayCode, type OnboardingAnswers } from "@/components/hooks/useOnboardingDraft";

// Display labels — kept here (UI concern) rather than in the shared schema.
const GOAL_LABELS: Record<TrainingGoal, string> = {
  fitness_health: "General fitness & health",
  endurance: "Build endurance",
  speed_racing: "Speed & racing",
};

const EQUIPMENT_LABELS: Record<EquipmentType, string> = {
  power_meter: "Power meter",
  hrm: "Heart-rate monitor",
  none: "No sensor / just my bike",
};

const FITNESS_LABELS: Record<FitnessLevel, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
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

const TOTAL_STEPS = 4;
const STEP_TITLES = ["Your goal", "About you", "Your equipment", "Review"];

/** Parse a number input's string value, returning undefined for blank/NaN. */
function toNum(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isNaN(n) ? undefined : n;
}

export default function OnboardingWizard() {
  const [draft, setDraft, clearDraft] = useOnboardingDraft();
  const { answers, step } = draft;

  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function patch(next: Partial<OnboardingAnswers>) {
    setDraft((d) => ({ ...d, answers: { ...d.answers, ...next } }));
  }

  function markTouched(field: string) {
    setTouched((prev) => (prev.has(field) ? prev : new Set(prev).add(field)));
  }

  function goToStep(next: number) {
    setDraft((d) => ({ ...d, step: next }));
    setSubmitError(null);
  }

  // --- Build the discriminated objects the per-step / full schemas expect ---

  function equipmentPart(): Record<string, unknown> {
    switch (answers.equipment_type) {
      case "power_meter":
        return answers.knows_ftp
          ? { equipment_type: "power_meter", knows_ftp: true, ftp_watts: answers.ftp_watts }
          : { equipment_type: "power_meter", knows_ftp: false, fitness_level: answers.fitness_level };
      case "hrm":
        return { equipment_type: "hrm", max_hr: answers.max_hr, fitness_level: answers.fitness_level };
      case "none":
        return { equipment_type: "none", fitness_level: answers.fitness_level };
      default:
        return {};
    }
  }

  function bodyPart(): Record<string, unknown> {
    return {
      age: answers.age,
      weight_kg: answers.weight_kg,
      available_days: answers.available_days,
      max_workday_minutes: answers.max_workday_minutes,
      max_weekend_minutes: answers.max_weekend_minutes,
    };
  }

  function fullInput(): Record<string, unknown> {
    return { goal: answers.goal, ...bodyPart(), ...equipmentPart() };
  }

  // --- Per-step validation ---

  function stepErrors(): Record<string, string[] | undefined> {
    let result;
    if (step === 1) result = goalStepSchema.safeParse({ goal: answers.goal });
    else if (step === 2) result = bodyStepSchema.safeParse(bodyPart());
    else if (step === 3) result = equipmentStepSchema.safeParse(equipmentPart());
    else return {};
    return result.success ? {} : z.flattenError(result.error).fieldErrors;
  }

  const errors = stepErrors();
  const stepValid = Object.keys(errors).length === 0;

  function fieldError(field: string): string | undefined {
    return touched.has(field) ? errors[field]?.[0] : undefined;
  }

  function toggleDay(day: DayCode) {
    markTouched("available_days");
    const current = answers.available_days;
    patch({
      available_days: current.includes(day) ? current.filter((d) => d !== day) : [...current, day],
    });
  }

  function selectEquipment(equipment: EquipmentType) {
    markTouched("equipment_type");
    // Reset branch-specific fields so a previous branch's values can't linger
    // and leak into the submission.
    const next: Partial<OnboardingAnswers> = {
      equipment_type: equipment,
      knows_ftp: equipment === "power_meter" ? (answers.knows_ftp ?? true) : undefined,
      ftp_watts: undefined,
      max_hr: equipment === "hrm" ? (answers.max_hr ?? defaultMaxHr(answers.age ?? 40)) : undefined,
      fitness_level: equipment === "power_meter" && answers.knows_ftp ? undefined : answers.fitness_level,
    };
    patch(next);
  }

  async function handleSubmit() {
    const parsed = onboardingInputSchema.safeParse(fullInput());
    if (!parsed.success) {
      setSubmitError("Some answers are incomplete. Please review the previous steps.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (res.ok) {
        clearDraft();
        window.location.href = "/dashboard";
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setSubmitError(body?.error ?? "Could not save your profile. Please try again.");
    } catch {
      setSubmitError("Network error. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const progress = (step / TOTAL_STEPS) * 100;

  return (
    <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-white/10 p-6 text-white backdrop-blur-xl sm:p-8">
      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between text-sm text-blue-100/70">
          <span>
            Step {step} of {TOTAL_STEPS}
          </span>
          <span>{STEP_TITLES[step - 1]}</span>
        </div>
        <Progress value={progress} className="bg-white/10" />
      </div>

      {step === 1 && (
        <Step title="What's your main goal?">
          <RadioGroup
            value={answers.goal ?? ""}
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
        </Step>
      )}

      {step === 2 && (
        <Step title="A little about you">
          <div className="grid grid-cols-2 gap-4">
            <NumberField
              id="age"
              label="Age"
              value={answers.age}
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
              value={answers.weight_kg}
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

          <div className="space-y-2">
            <Label className="text-blue-100/80">Which days can you train?</Label>
            <div className="flex flex-wrap gap-2">
              {DAY_CODES.map((day) => {
                const checked = answers.available_days.includes(day);
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
              value={answers.max_workday_minutes}
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
              value={answers.max_weekend_minutes}
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
        </Step>
      )}

      {step === 3 && (
        <Step title="What do you train with?">
          <RadioGroup
            value={answers.equipment_type ?? ""}
            onValueChange={(v) => {
              selectEquipment(v as EquipmentType);
            }}
            className="gap-2"
          >
            {(Object.keys(EQUIPMENT_LABELS) as EquipmentType[]).map((eq) => (
              <OptionRow key={eq} htmlFor={`equip-${eq}`}>
                <RadioGroupItem id={`equip-${eq}`} value={eq} />
                <span>{EQUIPMENT_LABELS[eq]}</span>
              </OptionRow>
            ))}
          </RadioGroup>
          <FieldError message={fieldError("equipment_type")} />

          {answers.equipment_type === "power_meter" && (
            <div className="mt-5 space-y-4 border-t border-white/10 pt-5">
              <div className="space-y-2">
                <Label className="text-blue-100/80">Do you know your FTP?</Label>
                <RadioGroup
                  value={answers.knows_ftp ? "yes" : "no"}
                  onValueChange={(v) => {
                    // Switching the toggle clears the other branch's field.
                    patch(
                      v === "yes"
                        ? { knows_ftp: true, fitness_level: undefined }
                        : { knows_ftp: false, ftp_watts: undefined },
                    );
                  }}
                  className="flex gap-6"
                >
                  <OptionRow htmlFor="knows-ftp-yes" inline>
                    <RadioGroupItem id="knows-ftp-yes" value="yes" />
                    <span>Yes</span>
                  </OptionRow>
                  <OptionRow htmlFor="knows-ftp-no" inline>
                    <RadioGroupItem id="knows-ftp-no" value="no" />
                    <span>No, estimate it</span>
                  </OptionRow>
                </RadioGroup>
              </div>

              {answers.knows_ftp ? (
                <NumberField
                  id="ftp_watts"
                  label="FTP (watts)"
                  value={answers.ftp_watts}
                  onChange={(n) => {
                    patch({ ftp_watts: n });
                  }}
                  onBlur={() => {
                    markTouched("ftp_watts");
                  }}
                  error={fieldError("ftp_watts")}
                  placeholder="50–600"
                />
              ) : (
                <FitnessLevelField
                  value={answers.fitness_level}
                  onChange={(fl) => {
                    markTouched("fitness_level");
                    patch({ fitness_level: fl });
                  }}
                  error={fieldError("fitness_level")}
                />
              )}
            </div>
          )}

          {answers.equipment_type === "hrm" && (
            <div className="mt-5 space-y-4 border-t border-white/10 pt-5">
              <NumberField
                id="max_hr"
                label="Max heart rate (bpm)"
                value={answers.max_hr}
                onChange={(n) => {
                  patch({ max_hr: n });
                }}
                onBlur={() => {
                  markTouched("max_hr");
                }}
                error={fieldError("max_hr")}
                placeholder="100–230"
                hint={
                  answers.age
                    ? `Suggested from your age (220 − ${answers.age}). Adjust if you know your true max.`
                    : "Adjust to your true max if you know it."
                }
              />
              <FitnessLevelField
                value={answers.fitness_level}
                onChange={(fl) => {
                  markTouched("fitness_level");
                  patch({ fitness_level: fl });
                }}
                error={fieldError("fitness_level")}
              />
            </div>
          )}

          {answers.equipment_type === "none" && (
            <div className="mt-5 space-y-4 border-t border-white/10 pt-5">
              <FitnessLevelField
                value={answers.fitness_level}
                onChange={(fl) => {
                  markTouched("fitness_level");
                  patch({ fitness_level: fl });
                }}
                error={fieldError("fitness_level")}
              />
            </div>
          )}
        </Step>
      )}

      {step === 4 && (
        <Step title="Review your answers">
          <dl className="divide-y divide-white/10 text-sm">
            <ReviewRow label="Goal" value={answers.goal ? GOAL_LABELS[answers.goal] : "—"} />
            <ReviewRow label="Age" value={answers.age ? `${answers.age}` : "—"} />
            <ReviewRow label="Weight" value={answers.weight_kg ? `${answers.weight_kg} kg` : "—"} />
            <ReviewRow
              label="Training days"
              value={answers.available_days.length ? answers.available_days.map((d) => DAY_LABELS[d]).join(", ") : "—"}
            />
            <ReviewRow label="Max weekday" value={`${answers.max_workday_minutes ?? "—"} min`} />
            <ReviewRow label="Max weekend" value={`${answers.max_weekend_minutes ?? "—"} min`} />
            <ReviewRow
              label="Equipment"
              value={answers.equipment_type ? EQUIPMENT_LABELS[answers.equipment_type] : "—"}
            />
            {answers.equipment_type === "power_meter" && answers.knows_ftp && (
              <ReviewRow label="FTP" value={`${answers.ftp_watts ?? "—"} W`} />
            )}
            {answers.fitness_level && <ReviewRow label="Fitness level" value={FITNESS_LABELS[answers.fitness_level]} />}
            {answers.equipment_type === "hrm" && (
              <ReviewRow label="Max heart rate" value={`${answers.max_hr ?? "—"} bpm`} />
            )}
          </dl>
          <FieldError message={submitError} />
        </Step>
      )}

      <div className="mt-8 flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          className="text-white hover:bg-white/10 hover:text-white disabled:opacity-40"
          onClick={() => {
            goToStep(step - 1);
          }}
          disabled={step === 1 || submitting}
        >
          <ArrowLeft className="size-4" /> Back
        </Button>

        {step < TOTAL_STEPS ? (
          <Button
            type="button"
            onClick={() => {
              goToStep(step + 1);
            }}
            disabled={!stepValid}
          >
            Next <ArrowRight className="size-4" />
          </Button>
        ) : (
          <Button type="button" onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Saving…
              </>
            ) : (
              <>
                <Check className="size-4" /> Confirm & continue
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

// --- Small presentational helpers (local to the wizard) ---

function Step({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </div>
  );
}

function OptionRow({ htmlFor, inline, children }: { htmlFor: string; inline?: boolean; children: React.ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      className={
        inline
          ? "flex cursor-pointer items-center gap-2 text-sm"
          : "flex cursor-pointer items-center gap-3 rounded-md border border-white/15 bg-white/5 px-4 py-3 text-sm transition-colors hover:bg-white/10"
      }
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
  hint,
}: {
  id: string;
  label: string;
  value: number | undefined;
  onChange: (n: number | undefined) => void;
  onBlur: () => void;
  error?: string;
  placeholder?: string;
  hint?: string;
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
      {hint && !error && <p className="text-xs text-blue-100/50">{hint}</p>}
      <FieldError message={error} />
    </div>
  );
}

function FitnessLevelField({
  value,
  onChange,
  error,
}: {
  value: FitnessLevel | undefined;
  onChange: (fl: FitnessLevel) => void;
  error?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-blue-100/80">How would you rate your fitness?</Label>
      <Select
        value={value ?? ""}
        onValueChange={(v) => {
          onChange(v as FitnessLevel);
        }}
      >
        <SelectTrigger className="w-full border-white/20 bg-white/5 text-white">
          <SelectValue placeholder="Select a fitness level" />
        </SelectTrigger>
        <SelectContent>
          {FITNESS_LEVELS.map((level) => (
            <SelectItem key={level} value={level}>
              {FITNESS_LABELS[level]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldError message={error} />
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
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
