import { useState } from "react";
import { Activity, Bike, Loader2, RefreshCw, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePlanGeneration } from "@/components/hooks/usePlanGeneration";
import type { PlanSegment, PlanSessionView, PlanWithSessions, SessionType } from "@/types";

/**
 * The dashboard plan island.
 *
 *   - `plan === null` → no active plan yet: kick off generate-on-load with a
 *     progress indicator, falling back to a retry state on failure.
 *   - `plan` present → render the 4-week overview; tapping a session expands
 *     its detail in place with equipment-correct intensity targets.
 *
 * The plan is server-rendered (source of truth); after a successful generation
 * the hook reloads so this component re-mounts in the `plan`-present branch.
 */
export default function PlanView({ plan }: { plan: PlanWithSessions | null }) {
  if (!plan) {
    return <PlanGenerating />;
  }
  return <PlanOverview plan={plan} />;
}

// --- Generate-on-load / progress + retry ---

function PlanGenerating() {
  const { status, error, retry } = usePlanGeneration(true);

  if (status === "error") {
    return (
      <Panel>
        <h2 className="text-lg font-semibold text-white">We couldn&apos;t build your plan</h2>
        <p className="mt-2 text-sm text-blue-100/70">{error}</p>
        <Button type="button" onClick={retry} className="mt-5 bg-white/15 text-white hover:bg-white/25">
          <RefreshCw className="size-4" /> Try again
        </Button>
      </Panel>
    );
  }

  return (
    <Panel>
      <div className="flex flex-col items-center gap-4 py-2 text-center">
        <Loader2 className="size-8 animate-spin text-blue-200" aria-hidden />
        <h2 className="text-lg font-semibold text-white">Building your 4-week plan…</h2>
        <p className="max-w-sm text-sm text-blue-100/70">
          Our coach is mapping your goal, fitness, and available days into a personalized training plan. This usually
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
    </Panel>
  );
}

// --- 4-week overview ---

const WEEKS = [0, 1, 2, 3] as const;
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const SESSION_STYLES: Record<SessionType, { dot: string; label: string }> = {
  endurance: { dot: "bg-blue-400", label: "Endurance" },
  intervals: { dot: "bg-amber-400", label: "Intervals" },
  recovery: { dot: "bg-emerald-400", label: "Recovery" },
};

const SESSION_ICONS: Record<SessionType, typeof Bike> = {
  endurance: Bike,
  intervals: Zap,
  recovery: Activity,
};

function weekdayLabel(dayIndex: number): string {
  return WEEKDAY_LABELS[(dayIndex - 1) % 7];
}

/** Format an ISO `YYYY-MM-DD` date as e.g. "Jun 15", using UTC to avoid TZ drift. */
function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function PlanOverview({ plan }: { plan: PlanWithSessions }) {
  const [expandedDay, setExpandedDay] = useState<number | null>(null);
  const sessionByDay = new Map(plan.sessions.map((session) => [session.day_index, session]));

  return (
    <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-white/10 p-5 text-white backdrop-blur-xl sm:p-7">
      <header className="mb-5">
        <h1 className="bg-gradient-to-r from-blue-200 to-purple-200 bg-clip-text text-2xl font-bold text-transparent">
          Your 4-week plan
        </h1>
        <p className="mt-1 text-sm text-blue-100/70">
          {formatDate(plan.plan.start_date)} – {formatDate(plan.plan.end_date)} · {plan.sessions.length} sessions
        </p>
      </header>

      <div className="space-y-5">
        {WEEKS.map((week) => {
          const firstDay = week * 7 + 1;
          const days = Array.from({ length: 7 }, (_, i) => firstDay + i);
          const expandedSession =
            expandedDay !== null && expandedDay >= firstDay && expandedDay <= firstDay + 6
              ? sessionByDay.get(expandedDay)
              : undefined;

          return (
            <section key={week}>
              <h2 className="mb-2 text-xs font-semibold tracking-wide text-blue-100/50 uppercase">Week {week + 1}</h2>
              <div className="grid grid-cols-7 gap-1.5">
                {days.map((dayIndex) => (
                  <DayCell
                    key={dayIndex}
                    dayIndex={dayIndex}
                    session={sessionByDay.get(dayIndex)}
                    expanded={expandedDay === dayIndex}
                    onToggle={() => {
                      setExpandedDay((current) => (current === dayIndex ? null : dayIndex));
                    }}
                  />
                ))}
              </div>
              {expandedSession && <SessionDetail session={expandedSession} />}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function DayCell({
  dayIndex,
  session,
  expanded,
  onToggle,
}: {
  dayIndex: number;
  session: PlanSessionView | undefined;
  expanded: boolean;
  onToggle: () => void;
}) {
  const label = weekdayLabel(dayIndex);

  if (!session) {
    // Rest day — empty, non-interactive cell.
    return (
      <div className="flex min-h-16 flex-col items-center rounded-lg border border-white/5 bg-white/5 px-1 py-1.5 text-center opacity-60">
        <span className="text-[10px] text-blue-100/40">{label}</span>
        <span className="mt-auto mb-1 text-[10px] text-blue-100/30">Rest</span>
      </div>
    );
  }

  const style = SESSION_STYLES[session.session_type];
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-label={`${label}: ${session.title}, ${session.planned_duration_min} minutes`}
      className={cn(
        "flex min-h-16 cursor-pointer flex-col items-center rounded-lg border px-1 py-1.5 text-center transition-colors",
        expanded ? "border-white/40 bg-white/20" : "border-white/10 bg-white/10 hover:bg-white/15",
      )}
    >
      <span className="text-[10px] text-blue-100/60">{label}</span>
      <span className={cn("mt-1 size-2 rounded-full", style.dot)} />
      <span className="mt-auto text-[11px] font-medium text-white">{session.planned_duration_min}′</span>
    </button>
  );
}

function SessionDetail({ session }: { session: PlanSessionView }) {
  const style = SESSION_STYLES[session.session_type];
  const Icon = SESSION_ICONS[session.session_type];

  return (
    <div className="mt-2 rounded-xl border border-white/15 bg-white/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Icon className="size-4 text-blue-200" aria-hidden />
            <h3 className="font-semibold text-white">{session.title}</h3>
          </div>
          <p className="mt-0.5 text-xs text-blue-100/50">
            {weekdayLabel(session.day_index)} · {formatDate(session.scheduled_date)} · {style.label}
          </p>
        </div>
        <span className="shrink-0 rounded-md bg-white/10 px-2 py-1 text-xs font-medium text-blue-100">
          {session.planned_duration_min} min
        </span>
      </div>

      {session.description && <p className="mt-3 text-sm text-blue-100/80">{session.description}</p>}

      <ol className="mt-4 space-y-2">
        {session.structure.segments.map((segment, index) => (
          <li
            key={index}
            className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm"
          >
            <span className="text-white">{segment.label}</span>
            <span className="flex items-center gap-3 text-blue-100/70">
              <span className="tabular-nums">{segment.duration_min} min</span>
              <span className="font-medium text-blue-100">{formatTarget(segment)}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Format a segment's intensity target in its equipment-correct unit. */
function formatTarget(segment: PlanSegment): string {
  const { target } = segment;
  switch (target.kind) {
    case "watts":
      return `${target.low_watts}–${target.high_watts} W`;
    case "hr_zone":
      return `Z${target.zone} · ${target.low_bpm}–${target.high_bpm} bpm`;
    case "rpe":
      return `RPE ${target.rpe} · ${target.description}`;
  }
}

// --- shared shell ---

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/10 p-8 text-center text-white backdrop-blur-xl">
      {children}
    </div>
  );
}
