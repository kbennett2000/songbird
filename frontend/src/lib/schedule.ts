import type { SermonSourcesStatus } from "@/schemas";

/**
 * The scheduled check, in one line (v1.7 sermon sources, spec §6c).
 *
 * Pure and separate from the page because the phrasing has more rules than it looks: an interval
 * reads in days when it divides into days, "last" is missing until this process has actually run
 * one, and "off" is a different sentence rather than a blank.
 */

/** "7 days" / "day" / "12 hours" / "hour" — how often, in the largest honest unit. */
export function everyPhrase(hours: number): string {
  if (hours % 24 === 0) {
    const days = hours / 24;
    return days === 1 ? "day" : `${days} days`;
  }
  return hours === 1 ? "hour" : `${hours} hours`;
}

/**
 * A scheduled run as "Sun 3:02 AM", in the reader's own timezone.
 *
 * The first `new Date()` formatter in the frontend, and a deliberate departure from the rule
 * `formatEventDate` sets. That rule exists because a sermon's *date* is a calendar day, so
 * `new Date()` would show the day before to anyone west of UTC. A scheduled run is not a calendar
 * day — it is an instant, and the reader wants it in their own clock, which is exactly what
 * `new Date()` gives. No date part: at a weekly interval the weekday is what tells you which day,
 * and at an hourly one the date would be noise.
 */
export function formatRunTime(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const day = at.toLocaleDateString(undefined, { weekday: "short" });
  const time = at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day} ${time}`;
}

/**
 * The whole line, or null when there is nothing worth saying.
 *
 * Null only when there is no key: the page is one setup message then, and a line about a schedule
 * that cannot run would be answering a question nobody has asked yet.
 */
export function describeSchedule(status: SermonSourcesStatus): string | null {
  if (!status.configured) return null;
  if (!status.timer_enabled) return "Scheduled checks are off; use Check now";

  const parts = [`Checks every ${everyPhrase(status.interval_hours)}`];
  // "last" is absent until this songbird has run one. The timer keeps it in memory, so a restart
  // forgets it — each source's own "last checked" is the durable record, and it is on the row.
  if (status.last_scheduled_run_at) parts.push(`last ${formatRunTime(status.last_scheduled_run_at)}`);
  if (status.next_scheduled_run_at) parts.push(`next ${formatRunTime(status.next_scheduled_run_at)}`);
  return parts.join(" · ");
}
