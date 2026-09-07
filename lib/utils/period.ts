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
export function periodLabel(kind: PeriodKind, window: DayWindow): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [fy, fm, fd] = parts(window.from);
  const [ty, tm, td] = parts(window.to);
  const mon = (m: number) => months[m - 1];
  switch (kind) {
    case "today":
      return `${mon(fm)} ${fd}, ${fy}`;
    case "week":
      return fy === ty ? `${mon(fm)} ${fd} – ${mon(tm)} ${td}, ${fy}` : `${mon(fm)} ${fd}, ${fy} – ${mon(tm)} ${td}, ${ty}`;
    case "month":
      return `${mon(fm)} ${fy}`;
    case "quarter":
      return `Q${Math.floor((fm - 1) / 3) + 1} ${fy}`;
    case "year":
      return String(fy);
  }
}
