/**
 * Date arithmetic for employment: probation, length of service, document
 * validity. Pure, over `yyyy-MM-dd` day keys, so both the HR landing page
 * and the leave accrual (lib/utils/leave.ts) agree on what "six months of
 * service" means.
 */

import { addDays, dayKey } from "./dtr.ts";

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const a = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  const b = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  return Math.round((b - a) / 86_400_000);
}

/** The same day `n` months later, clamped to the month's last day (Jan 31 + 1 -> Feb 28). */
export function addMonths(key: string, n: number): string {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7)) - 1 + n;
  const d = Number(key.slice(8, 10));
  const target = new Date(Date.UTC(y, m, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return dayKey(target);
}

/** Completed months of service between hire and `asOf` (inclusive of the anniversary day). */
export function serviceMonths(hireDate: string, asOf: string): number {
  if (asOf < hireDate) return 0;
  let months = 0;
  while (addMonths(hireDate, months + 1) <= asOf) months++;
  return months;
}

export function serviceYears(hireDate: string, asOf: string): number {
  return Math.floor(serviceMonths(hireDate, asOf) / 12);
}

/**
 * Probation may not exceed six months from the day the employee started
 * (Labor Code Art. 296); an employee kept on past it is regular by
 * operation of law. Day 150 is the usual last-evaluation reminder, so a
 * decision is made with a month to spare.
 */
export function probationMilestones(hireDate: string): { evaluateBy: string; endsOn: string } {
  return { evaluateBy: addDays(hireDate, 150), endsOn: addMonths(hireDate, 6) };
}

export type ValidityState = "valid" | "expiring" | "expired" | "unknown";

/**
 * Whether a dated document is still good. `expiresOn` wins when set;
 * otherwise `issuedOn` + the type's validity. Expiring = within 30 days.
 */
export function documentValidity(
  doc: { issuedOn: string | null; expiresOn: string | null },
  validityMonths: number | null,
  today: string
): { state: ValidityState; expiresOn: string | null } {
  const expiresOn = doc.expiresOn ?? (doc.issuedOn && validityMonths ? addMonths(doc.issuedOn, validityMonths) : null);
  if (!expiresOn) return { state: "unknown", expiresOn: null };
  const days = daysBetween(today, expiresOn);
  return { state: days < 0 ? "expired" : days <= 30 ? "expiring" : "valid", expiresOn };
}
