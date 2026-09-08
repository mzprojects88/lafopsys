/**
 * Semi-monthly pay periods: the 1st-15th and the 16th-end of each month,
 * twenty-four a year, numbered 1-24. Pay frequency is "Semi-Monthly" for
 * every row of the 201 masterlist, and the bank statement shows the two
 * transfers a month landing 2-6 days after each cutoff.
 *
 * Labor Code Art. 103: wages are paid at least once every two weeks or
 * twice a month at intervals not exceeding sixteen days. Both pay-date
 * rules below satisfy it; `payDateFor` also moves a pay date that lands on
 * a rest day or holiday BACK to the previous working day, never forward,
 * so the sixteen-day interval is never breached by a long weekend.
 *
 * Pure, over `yyyy-MM-dd` day keys, no Date built in the local timezone.
 */

import { addDays } from "./dtr.ts";
import { monthEnd } from "./period.ts";

export interface PayPeriodSpec {
  year: number;
  /** 1-24: odd = 1st-15th, even = 16th-end. */
  seq: number;
  from: string;
  to: string;
  isSecondCutoff: boolean;
}

/** When a cutoff is paid (shared.app_settings.payroll_pay_date_rule, 0038). */
export type PayDateRule = { kind: "offset"; days: number } | { kind: "fixed"; first: number; second: number };

export interface HolidayLike {
  date: string;
  kind: "regular" | "special_non_working" | "special_working";
}

const pad = (n: number) => String(n).padStart(2, "0");

export function semiMonthlyPeriods(year: number): PayPeriodSpec[] {
  const out: PayPeriodSpec[] = [];
  for (let m = 1; m <= 12; m++) {
    const first = `${year}-${pad(m)}-01`;
    out.push({ year, seq: m * 2 - 1, from: first, to: `${year}-${pad(m)}-15`, isSecondCutoff: false });
    out.push({ year, seq: m * 2, from: `${year}-${pad(m)}-16`, to: monthEnd(first), isSecondCutoff: true });
  }
  return out;
}

/** The period a day falls in. */
export function periodFor(day: string): PayPeriodSpec {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const second = Number(day.slice(8, 10)) >= 16;
  return semiMonthlyPeriods(year)[month * 2 - 2 + (second ? 1 : 0)];
}

/** The last day of the calendar month a period belongs to. */
export function periodMonthEnd(spec: PayPeriodSpec): string {
  return monthEnd(spec.from);
}

function weekday(day: string): number {
  // 0 = Sunday ... 6 = Saturday, computed in UTC from the key alone.
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/** Saturday, Sunday, or a regular / special non-working holiday. */
export function isNonWorkingDay(day: string, holidays: readonly HolidayLike[]): boolean {
  const w = weekday(day);
  if (w === 0 || w === 6) return true;
  return holidays.some((h) => h.date === day && h.kind !== "special_working");
}

/**
 * The pay date for a period: an offset after the cutoff ends, or a fixed
 * day of the month (the 1-15 cutoff paid on `first` of the same month, the
 * 16-end cutoff on `second` of the FOLLOWING month). A day of month past
 * the month's length clamps to its last day. Then rolled back to the
 * previous working day while it lands on a rest day or holiday.
 */
export function payDateFor(spec: PayPeriodSpec, rule: PayDateRule, holidays: readonly HolidayLike[] = []): string {
  let day: string;
  if (rule.kind === "offset") {
    day = addDays(spec.to, rule.days);
  } else {
    const monthStart = spec.isSecondCutoff ? addDays(periodMonthEnd(spec), 1) : spec.from;
    const dom = spec.isSecondCutoff ? rule.second : rule.first;
    const lastDom = Number(monthEnd(monthStart).slice(8, 10));
    day = `${monthStart.slice(0, 7)}-${pad(Math.min(Math.max(1, dom), lastDom))}`;
    // A fixed day earlier than the cutoff's end (e.g. "the 10th" for the
    // 1-15 cutoff) cannot be meant as before the work is done; pay the
    // following month instead.
    if (day < spec.to) {
      const next = addDays(monthEnd(day), 1);
      const nextLast = Number(monthEnd(next).slice(8, 10));
      day = `${next.slice(0, 7)}-${pad(Math.min(dom, nextLast))}`;
    }
  }
  let guard = 0;
  while (isNonWorkingDay(day, holidays) && guard++ < 14) day = addDays(day, -1);
  return day;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Sep 16–30, 2026" */
export function payPeriodLabel(spec: PayPeriodSpec): string {
  const m = MONTHS[Number(spec.from.slice(5, 7)) - 1];
  return `${m} ${Number(spec.from.slice(8, 10))}–${Number(spec.to.slice(8, 10))}, ${spec.year}`;
}

/** "2026-18" — the stable id-like key used in filenames and references. */
export function payPeriodKey(spec: Pick<PayPeriodSpec, "year" | "seq">): string {
  return `${spec.year}-${pad(spec.seq)}`;
}
