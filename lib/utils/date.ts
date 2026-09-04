import { format, formatDistanceToNow, parseISO } from "date-fns";
import { dayKey, timeLabel } from "@/lib/utils/dtr";

export { dayKey, timeLabel, formatMinutes, ORG_TIMEZONE } from "@/lib/utils/dtr";

export function formatDate(iso: string, pattern = "MMM d, yyyy") {
  return format(parseISO(iso), pattern);
}

export function formatRelative(iso: string) {
  return formatDistanceToNow(parseISO(iso), { addSuffix: true });
}

export function daysUntil(iso: string, from = new Date("2026-08-04T00:00:00Z")) {
  const target = parseISO(iso);
  return Math.round((target.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * The real current date as `yyyy-MM-dd` in the organisation's timezone
 * (lib/utils/dtr.ts ORG_TIMEZONE). Vercel functions run in UTC, so a plain
 * `new Date()` date on the server would put a 07:00 Manila clock-in on the
 * previous day; staff browsers are in Manila anyway, so this is a no-op there.
 *
 * Distinct from `TODAY_ISO` in lib/utils/seeded-random.ts, which is a frozen
 * constant ("2026-08-04") that demo/seed data is generated around. Anything that
 * records something actually happening -- clock punches above all -- has to use
 * this instead: `ops.time_entries` is `unique (staff_id, date)`, so writing every
 * day under one frozen date would make the second day's clock-in overwrite the
 * first day's record rather than create a new one.
 */
export function todayIso(): string {
  return dayKey(new Date());
}

/** Org-timezone wall-clock time as `HH:mm`, matching the `clock_in`/`clock_out` text columns. */
export function nowTimeLabel(): string {
  return timeLabel(new Date());
}
