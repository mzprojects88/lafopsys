import { addDays, monthKey, weekKey } from "./dtr.ts";

/**
 * Today / This Week / This Month / This Quarter / This Year windows for the
 * calendar, as inclusive `yyyy-MM-dd` day keys.
 *
 * Everything here is arithmetic on day-key strings -- there is no `Date`
 * constructed in the local time zone, so a window computed on a Vercel
 * function (UTC) and one computed in a browser in Manila agree, and the tests
 * do not depend on the machine they run on. Weeks start on Monday, the same
 * rule as payroll (dtr.ts WEEK_STARTS_ON); the old roster strip's Sunday
 * weeks are the exception, not this.
 *
 * Only imports from ./dtr, which has no project imports of its own, so this
 * stays loadable under `node --test`.
 */

export type PeriodKind = "today" | "week" | "month" | "quarter" | "year";

export interface DayWindow {
  /** First day, inclusive. */
  from: string;
  /** Last day, inclusive. */
  to: string;
}

function parts(key: string): [number, number, number] {
  const [y, m, d] = key.split("-");
  return [Number(y), Number(m), Number(d)];
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Days in a month, leap years included -- `Date.UTC` with day 0 of the next month. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** `yyyy-MM-01` of the month containing `key`. */
export function monthStart(key: string): string {
  return `${monthKey(key)}-01`;
}

/** Last day of the month containing `key`. */
export function monthEnd(key: string): string {
  const [y, m] = parts(key);
  return `${monthKey(key)}-${pad(daysInMonth(y, m))}`;
}

/** `yyyy-Qn` of the quarter containing `key`. */
export function quarterKey(key: string): string {
  const [y, m] = parts(key);
  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
}

export function yearKey(key: string): string {
  return key.slice(0, 4);
}

export function periodWindow(kind: PeriodKind, today: string): DayWindow {
  const [y, m] = parts(today);
  switch (kind) {
    case "today":
      return { from: today, to: today };
    case "week": {
      const from = weekKey(today);
      return { from, to: addDays(from, 6) };
    }
    case "month":
      return { from: monthStart(today), to: monthEnd(today) };
    case "quarter": {
      const firstMonth = Math.floor((m - 1) / 3) * 3 + 1;
      const lastMonth = firstMonth + 2;
      return { from: `${y}-${pad(firstMonth)}-01`, to: `${y}-${pad(lastMonth)}-${pad(daysInMonth(y, lastMonth))}` };
    }
    case "year":
      return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
}

/** Day keys compare correctly as strings, which is the whole reason to keep them as keys. */
export function inWindow(dayKey: string, window: DayWindow): boolean {
  return dayKey >= window.from && dayKey <= window.to;
}

/** Shifts a window's anchor by one period in either direction. Returns the
 * new anchor day, from which the caller recomputes the window -- so "next
 * month" from 31 Jan lands in February, not on a 31 Feb that does not exist. */
export function shiftAnchor(kind: PeriodKind, anchor: string, direction: 1 | -1): string {
  const [y, m, d] = parts(anchor);
  switch (kind) {
    case "today":
      return addDays(anchor, direction);
    case "week":
      return addDays(anchor, 7 * direction);
    case "month":
    case "quarter":
    case "year": {
      const step = kind === "month" ? 1 : kind === "quarter" ? 3 : 12;
      const total = y * 12 + (m - 1) + step * direction;
      const ny = Math.floor(total / 12);
      const nm = (total % 12) + 1;
      return `${ny}-${pad(nm)}-${pad(Math.min(d, daysInMonth(ny, nm)))}`;
    }
  }
}

/**
 * The 42 day keys a month grid shows: six Monday-to-Sunday rows starting on
 * the Monday on or before the 1st. Days outside the month are included (the
 * grid dims them) so every row is full.
 */
export function monthGridDays(month: string): string[] {
  const first = `${month}-01`;
  const start = weekKey(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** Human label for a window, e.g. "Sep 7 – Sep 13, 2026" or "Q3 2026". */
export function periodLabel(kind: RangeKind, window: DayWindow): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [fy, fm, fd] = parts(window.from);
  const [ty, tm, td] = parts(window.to);
  const mon = (m: number) => months[m - 1];
  switch (kind) {
    case "today":
      return `${mon(fm)} ${fd}, ${fy}`;
    case "week":
    case "custom":
      if (window.from === window.to) return `${mon(fm)} ${fd}, ${fy}`;
      return fy === ty ? `${mon(fm)} ${fd} – ${mon(tm)} ${td}, ${fy}` : `${mon(fm)} ${fd}, ${fy} – ${mon(tm)} ${td}, ${ty}`;
    case "month":
      return `${mon(fm)} ${fy}`;
    case "quarter":
      return `Q${Math.floor((fm - 1) / 3) + 1} ${fy}`;
    case "year":
      return String(fy);
  }
}

// ---------------------------------------------------------------------------
// Reports (Nov 2026): one picker for every report, with a custom range and the
// "previous range" every report compares itself with.
// ---------------------------------------------------------------------------

/** A report's range: a calendar period around an anchor day, or any two days. */
export type RangeKind = PeriodKind | "custom";

export const RANGE_KINDS: { value: RangeKind; label: string }[] = [
  { value: "today", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "year", label: "Year" },
  { value: "custom", label: "Custom" },
];

/** Inclusive number of days in a window. */
export function windowDays(window: DayWindow): number {
  const [fy, fm, fd] = parts(window.from);
  const [ty, tm, td] = parts(window.to);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000) + 1;
}

/**
 * The range a report compares itself with: the same calendar period just
 * before (last week, last month, last year), or for a day / custom range the
 * same number of days ending the day before it starts.
 */
export function previousWindow(kind: RangeKind, window: DayWindow): DayWindow {
  if (kind === "today" || kind === "custom") {
    const days = windowDays(window);
    const to = addDays(window.from, -1);
    return { from: addDays(to, -(days - 1)), to };
  }
  return periodWindow(kind, shiftAnchor(kind, window.from, -1));
}

/** The window for a picker's state: a calendar period around the anchor day,
 * or the custom days (falling back to the anchor's month when they are missing or reversed). */
export function resolveRange(kind: RangeKind, anchor: string, from?: string | null, to?: string | null): DayWindow {
  if (kind !== "custom") return periodWindow(kind, anchor);
  if (from && to && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to) return { from, to };
  return periodWindow("month", anchor);
}

/** The one-word grain a window is naturally broken into: days for up to five
 * weeks, weeks for up to a year, months beyond. */
export function naturalGrain(window: DayWindow): "day" | "week" | "month" {
  const days = windowDays(window);
  return days <= 35 ? "day" : days <= 371 ? "week" : "month";
}
