import { useCallback, useState } from "react";
import { Activity, Ban, Bike, Check, Loader2, RefreshCw, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePlanGeneration } from "@/components/hooks/usePlanGeneration";
import { useSessionStatus } from "@/components/hooks/useSessionStatus";
import type {
  PlanSegment,
  PlanSessionWithLog,
  PlanWithSessions,
  SessionLog,
  SessionStatus,
  SessionStatusUpdate,
  SessionType,
} from "@/types";

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
      <Panel role="alert">
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

// User-facing status copy. `pending` reads as "Planned" — the cyclist hasn't
// acted on the session yet; "pending" is an internal enum value.
const STATUS_LABELS: Record<SessionStatus, string> = {
  pending: "Planned",
  done: "Done",
  skipped: "Skipped",
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
  // Lift sessions into state (seeded from the server-rendered source of truth)
  // so status/log changes can be applied optimistically.
  const [sessions, setSessions] = useState<PlanSessionWithLog[]>(plan.sessions);
  const [error, setError] = useState<string | null>(null);
  const { mutate, pending } = useSessionStatus();
  const sessionByDay = new Map(sessions.map((session) => [session.day_index, session]));

  // Apply a status change optimistically, then persist. Kept synchronous (the
  // POST runs in a fire-and-forget `.then`) so it can be passed straight to a
  // void-returning click handler. On failure we restore the exact prior session
  // (status + log) from the snapshot and surface a transient inline error.
  const setStatus = useCallback(
    (sessionId: string, input: SessionStatusUpdate) => {
      setError(null);

      // On `done`, attach the entered values as a local log so the detail
      // renders them immediately without a refetch; clear it otherwise.
      const optimisticLog: SessionLog | null =
        input.status === "done"
          ? { plan_session_id: sessionId, ...input.log, logged_at: new Date().toISOString() }
          : null;

      // Snapshot from the latest committed state inside the updater (not from a
      // possibly-stale render closure) so a rollback always restores the true
      // prior session rather than another in-flight optimistic value.
      let captured: PlanSessionWithLog | undefined;
      setSessions((prev) => {
        captured = prev.find((s) => s.id === sessionId);
        if (!captured) return prev;
        return prev.map((s) => (s.id === sessionId ? { ...s, status: input.status, log: optimisticLog } : s));
      });
      if (!captured) return;
      const snapshot = captured;

      void mutate(sessionId, input).then((result) => {
        if (!result.ok) {
          setSessions((prev) => prev.map((s) => (s.id === sessionId ? snapshot : s)));
          setError(result.error);
        }
      });
    },
    [mutate],
  );

  return (
    <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-white/10 p-5 text-white backdrop-blur-xl sm:p-7">
      <header className="mb-5">
        <h1 className="bg-gradient-to-r from-blue-200 to-purple-200 bg-clip-text text-2xl font-bold text-transparent">
          Your 4-week plan
        </h1>
        <p className="mt-1 text-sm text-blue-100/70">
          {formatDate(plan.plan.start_date)} – {formatDate(plan.plan.end_date)} · {sessions.length} sessions
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
              {expandedSession && (
                // key by session id so the inline form state resets when the
                // user expands a different day.
                <SessionDetail
                  key={expandedSession.id}
                  session={expandedSession}
                  onSetStatus={setStatus}
                  pending={pending}
                  error={error}
                />
              )}
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
  session: PlanSessionWithLog | undefined;
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
  const { status } = session;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-label={`${label}: ${session.title}, ${session.planned_duration_min} minutes, ${STATUS_LABELS[status]}`}
      className={cn(
        "flex min-h-16 cursor-pointer flex-col items-center rounded-lg border px-1 py-1.5 text-center transition-colors",
        expanded
          ? "border-white/40 bg-white/20"
          : status === "done"
            ? "border-emerald-400/40 bg-emerald-400/10 hover:bg-emerald-400/20"
            : "border-white/10 bg-white/10 hover:bg-white/15",
        status === "skipped" && !expanded && "opacity-50",
      )}
    >
      <span className="text-[10px] text-blue-100/60">{label}</span>
      {/* Status conveyed by icon + tint (not color alone): a check for done, a
          slash for skipped, the session-type dot for planned. */}
      {status === "done" ? (
        <Check className="mt-1 size-3.5 text-emerald-300" aria-hidden />
      ) : status === "skipped" ? (
        <Ban className="mt-1 size-3.5 text-blue-100/50" aria-hidden />
      ) : (
        <span className={cn("mt-1 size-2 rounded-full", style.dot)} />
      )}
      <span
        className={cn(
          "mt-auto text-[11px] font-medium text-white",
          status === "skipped" && "text-blue-100/50 line-through",
        )}
      >
        {session.planned_duration_min}′
      </span>
    </button>
  );
}

function SessionDetail({
  session,
  onSetStatus,
  pending,
  error,
}: {
  session: PlanSessionWithLog;
  onSetStatus: (sessionId: string, input: SessionStatusUpdate) => void;
  pending: boolean;
  error: string | null;
}) {
  const style = SESSION_STYLES[session.session_type];
  const Icon = SESSION_ICONS[session.session_type];

  // Inline action surface: idle (action buttons), the log form, or the skip
  // confirm. No modal dependency.
  const [mode, setMode] = useState<"idle" | "log" | "skip">("idle");
  // Log form fields, prefilled from any existing log, else the plan defaults.
  const [duration, setDuration] = useState(String(session.log?.actual_duration_min ?? session.planned_duration_min));
  const [rating, setRating] = useState(session.log?.rating ?? 3);
  const [km, setKm] = useState(session.log?.km_ridden != null ? String(session.log.km_ridden) : "");

  const durationNum = Number(duration);
  const kmNum = Number(km);
  const canSave =
    duration.trim() !== "" && Number.isFinite(durationNum) && km.trim() !== "" && Number.isFinite(kmNum) && kmNum > 0;

  const saveLog = () => {
    onSetStatus(session.id, {
      status: "done",
      log: { actual_duration_min: durationNum, rating, km_ridden: kmNum },
    });
    setMode("idle");
  };

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

      <div className="mt-4 flex items-center gap-2 border-t border-white/10 pt-4 text-xs">
        <span className="text-blue-100/50">Status</span>
        <StatusBadge status={session.status} />
      </div>

      {session.status === "done" && session.log && (
        <dl className="mt-3 grid grid-cols-3 gap-2 rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-3 text-center text-xs">
          <div>
            <dt className="text-blue-100/50">Duration</dt>
            <dd className="mt-0.5 font-medium text-white">{session.log.actual_duration_min} min</dd>
          </div>
          <div>
            <dt className="text-blue-100/50">Rating</dt>
            <dd className="mt-0.5 font-medium text-white">{session.log.rating} / 5</dd>
          </div>
          <div>
            <dt className="text-blue-100/50">Distance</dt>
            <dd className="mt-0.5 font-medium text-white">{session.log.km_ridden} km</dd>
          </div>
        </dl>
      )}

      {error && (
        <p className="mt-3 text-xs text-red-300" role="alert">
          {error}
        </p>
      )}

      <div className="mt-4">
        {mode === "idle" && (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => {
                setMode("log");
              }}
              disabled={pending}
              className="bg-emerald-400/20 text-emerald-100 hover:bg-emerald-400/30"
            >
              <Check className="size-4" /> Mark done
            </Button>
            <Button
              type="button"
              onClick={() => {
                setMode("skip");
              }}
              disabled={pending}
              className="bg-white/10 text-white hover:bg-white/20"
            >
              <Ban className="size-4" /> Skip
            </Button>
            {session.status !== "pending" && (
              <Button
                type="button"
                onClick={() => {
                  onSetStatus(session.id, { status: "pending" });
                }}
                disabled={pending}
                className="bg-transparent text-blue-100/70 hover:bg-white/10"
              >
                <RefreshCw className="size-4" /> Reset to planned
              </Button>
            )}
          </div>
        )}

        {mode === "log" && (
          <div className="space-y-3">
            <div className="flex flex-col gap-1">
              <label htmlFor={`dur-${session.id}`} className="text-xs text-blue-100/60">
                Duration (min)
              </label>
              <input
                id={`dur-${session.id}`}
                type="number"
                min={1}
                max={600}
                value={duration}
                onChange={(e) => {
                  setDuration(e.target.value);
                }}
                className="w-32 rounded-md border border-white/15 bg-white/5 px-2 py-1.5 text-sm text-white"
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-blue-100/60">Rating</span>
              <div className="flex gap-1.5" role="group" aria-label="Rating, 1 to 5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={rating === n}
                    onClick={() => {
                      setRating(n);
                    }}
                    className={cn(
                      "size-8 rounded-md border text-sm transition-colors",
                      rating === n
                        ? "border-blue-300 bg-blue-400/30 text-white"
                        : "border-white/15 bg-white/5 text-blue-100/70 hover:bg-white/10",
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`km-${session.id}`} className="text-xs text-blue-100/60">
                Distance (km)
              </label>
              <input
                id={`km-${session.id}`}
                type="number"
                min={0}
                step="0.01"
                value={km}
                onChange={(e) => {
                  setKm(e.target.value);
                }}
                className="w-32 rounded-md border border-white/15 bg-white/5 px-2 py-1.5 text-sm text-white"
              />
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                onClick={saveLog}
                disabled={pending || !canSave}
                className="bg-emerald-400/20 text-emerald-100 hover:bg-emerald-400/30"
              >
                Save
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setMode("idle");
                }}
                disabled={pending}
                className="bg-transparent text-blue-100/70 hover:bg-white/10"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {mode === "skip" && (
          <div className="space-y-3">
            <p className="text-sm text-blue-100/80">
              Skip means you won&apos;t do this session — it won&apos;t be rescheduled.
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                onClick={() => {
                  onSetStatus(session.id, { status: "skipped" });
                  setMode("idle");
                }}
                disabled={pending}
                className="bg-white/10 text-white hover:bg-white/20"
              >
                Confirm skip
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setMode("idle");
                }}
                disabled={pending}
                className="bg-transparent text-blue-100/70 hover:bg-white/10"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Status as icon + label (legible without relying on color alone). */
function StatusBadge({ status }: { status: SessionStatus }) {
  if (status === "done") {
    return (
      <span className="inline-flex items-center gap-1 font-medium text-emerald-300">
        <Check className="size-3.5" aria-hidden /> Done
      </span>
    );
  }
  if (status === "skipped") {
    return (
      <span className="inline-flex items-center gap-1 font-medium text-blue-100/60">
        <Ban className="size-3.5" aria-hidden /> Skipped
      </span>
    );
  }
  return <span className="font-medium text-blue-100/80">Planned</span>;
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

function Panel({ children, role }: { children: React.ReactNode; role?: string }) {
  return (
    <div
      role={role}
      className="w-full max-w-md rounded-2xl border border-white/10 bg-white/10 p-8 text-center text-white backdrop-blur-xl"
    >
      {children}
    </div>
  );
}
