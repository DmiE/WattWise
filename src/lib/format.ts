/**
 * The single UTC-safe formatter for ISO `YYYY-MM-DD` calendar dates.
 *
 * Calendar dates carry no time/zone, so parsing them with the local-time `Date`
 * constructor would shift the day backward for users west of UTC. We rebuild the
 * date in UTC (`Date.UTC` + `timeZone: "UTC"`) so the rendered day always matches
 * the stored `scheduled_date`/`start_date`/`end_date`.
 *
 * `weekday: true` prepends the short weekday (e.g. `"Mon, Jun 15"`) — used by the
 * history list, where rows span months/plans and an unambiguous label helps; the
 * plan grid omits it and gets the compact `"Jun 15"`.
 */
export function formatSessionDate(iso: string, opts?: { weekday?: boolean }): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(undefined, {
    ...(opts?.weekday ? { weekday: "short" } : {}),
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
