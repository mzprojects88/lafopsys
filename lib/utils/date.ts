import { format, formatDistanceToNow, parseISO } from "date-fns";
import { dayKey, timeLabel } from "@/lib/utils/dtr";

export { dayKey, timeLabel, formatMinutes, ORG_TIMEZONE } from "@/lib/utils/dtr";

/** A missing or unreadable date shows as "—" rather than throwing and taking the page down
 * (e.g. a donor with no gifts has no first/last gift date since 0082). */
export function formatDate(iso: string | null | undefined, pattern = "MMM d, yyyy") {
  const d = iso ? parseISO(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? format(d, pattern) : "—";
}

export function formatRelative(iso: string | null | undefined) {
  const d = iso ? parseISO(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? formatDistanceToNow(d, { addSuffix: true }) : "—";
}

export function daysUntil(iso: string, from = parseISO(todayIso())) {
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
