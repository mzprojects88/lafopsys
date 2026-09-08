/**
 * Leave: accrual, balances, the length of a request in scheduled workdays,
 * and statutory eligibility. Pure; balances are never stored (0040 keeps
 * only adjustments and requests), so the arithmetic here is the balance.
 *
 * Basis (as of 2026-09-08):
 * - Service Incentive Leave, Art. 95: five days with pay after one year of
 *   service; not required of employers with fewer than ten employees; a
 *   vacation leave of at least five days discharges it (s.95(b)); unused
 *   SIL is commutable to cash at year end.
 * - Vacation and sick leave beyond that are the foundation's own benefit
 *   (Settings), accruing monthly so a mid-year hire earns a pro-rated share.
 * - Maternity RA 11210 (105 days, +15 solo parent; 60 for miscarriage),
 *   paternity RA 8187 (7 days, married, first four deliveries), solo
 *   parent RA 8972 as amended by RA 11861 (7 days after six months'
 *   service), VAWC RA 9262 (10 days), women's special leave RA 9710 (up
 *   to two months after six months' service in the last twelve).
 */

import { addDays } from "./dtr.ts";
import { addMonths, serviceMonths } from "./employment.ts";
import { holidayOn, scheduledShift, type HolidayLike, type ScheduleOverrideLike, type WorkScheduleLike } from "./attendance.ts";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/**
 * Days accrued in `year` by `asOf`: one twelfth of the yearly entitlement
 * per calendar month completed while employed, the hire month pro-rated by
 * days, the current month not yet counted. Capped at the entitlement and
 * at the separation date.
 */
export function accruedDays(input: { entitlementPerYear: number; hireDate: string; year: number; asOf: string; separationDate?: string | null }): number {
  const { entitlementPerYear, hireDate, year } = input;
  if (entitlementPerYear <= 0) return 0;
  const end = input.separationDate && input.separationDate < input.asOf ? input.separationDate : input.asOf;
  if (end < hireDate) return 0;
  const endYear = Number(end.slice(0, 4));
  const endMonth = Number(end.slice(5, 7));
  let months = 0;
  for (let m = 1; m <= 12; m++) {
    const monthStart = `${year}-${String(m).padStart(2, "0")}-01`;
    const monthLast = `${year}-${String(m).padStart(2, "0")}-${daysInMonth(year, m)}`;
    // Only months fully in the past relative to `end`.
    const complete = year < endYear || (year === endYear && m < endMonth) || (input.separationDate !== undefined && input.separationDate !== null && end === input.separationDate && monthLast <= end);
    if (!complete) break;
    if (hireDate > monthLast) continue;
    if (hireDate > monthStart) {
      const dim = daysInMonth(year, m);
      months += (dim - Number(hireDate.slice(8, 10)) + 1) / dim;
    } else {
      months += 1;
    }
  }
  return round2(Math.min(entitlementPerYear, (entitlementPerYear * months) / 12));
}

export interface LeaveBalance {
  typeId: string;
  year: number;
  /** The year's full entitlement, pro-rated for a hire or separation within it. */
  entitled: number;
  accrued: number;
  carriedIn: number;
  used: number;
  pending: number;
  converted: number;
  /** accrued + carriedIn - used - converted. */
  available: number;
}

export function leaveBalance(input: {
  typeId: string;
  year: number;
  entitlementPerYear: number;
  hireDate: string;
  asOf: string;
  separationDate?: string | null;
  adjustments: readonly { leaveTypeId: string; year: number; kind: string; days: number }[];
  requests: readonly { leaveTypeId: string; status: string; days: number; startsOn: string }[];
}): LeaveBalance {
  const { typeId, year } = input;
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const from = input.hireDate > yearStart ? input.hireDate : yearStart;
  const to = input.separationDate && input.separationDate < yearEnd ? input.separationDate : yearEnd;
  const employedDays = to >= from ? Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1 : 0;
  const yearDays = Math.round((Date.parse(yearEnd) - Date.parse(yearStart)) / 86_400_000) + 1;
  const entitled = round2((input.entitlementPerYear * employedDays) / yearDays);
  const accrued = accruedDays(input);
  let carriedIn = 0;
  let converted = 0;
  for (const a of input.adjustments) {
    if (a.leaveTypeId !== typeId || a.year !== year) continue;
    if (a.kind === "conversion" || a.kind === "forfeit") converted += a.days;
    else carriedIn += a.days;
  }
  let used = 0;
  let pending = 0;
  for (const r of input.requests) {
    if (r.leaveTypeId !== typeId || !r.startsOn.startsWith(String(year))) continue;
    if (r.status === "approved") used += r.days;
    else if (r.status === "pending") pending += r.days;
  }
  return {
    typeId,
    year,
    entitled,
    accrued,
    carriedIn: round2(carriedIn),
    used: round2(used),
    pending: round2(pending),
    converted: round2(converted),
    available: round2(accrued + carriedIn - used - converted),
  };
}

/** Scheduled workdays covered by a request, holidays skipped, half days honoured on the ends. */
export function requestDays(input: {
  from: string;
  to: string;
  startHalf: boolean;
  endHalf: boolean;
  schedule: WorkScheduleLike | null;
  overrides: readonly ScheduleOverrideLike[];
  holidays: readonly HolidayLike[];
  city?: string | null;
}): number {
  if (input.to < input.from) return 0;
  let days = 0;
  for (let d = input.from; d <= input.to; d = addDays(d, 1)) {
    const shift = input.schedule || input.overrides.some((o) => o.date === d) ? scheduledShift(d, input.schedule, input.overrides) : { start: "", end: "" };
    if (!shift) continue;
    const h = holidayOn(d, input.holidays, input.city);
    if (h === "regular" || h === "special_non_working") continue;
    let fraction = 1;
    if (d === input.from && input.startHalf) fraction -= 0.5;
    if (d === input.to && input.endHalf) fraction -= 0.5;
    days += Math.max(0, fraction);
  }
  return days;
}

export interface LeaveTypeRules {
  minServiceMonths?: number;
  sex?: "female" | "male";
  civilStatus?: string;
  maxOccurrences?: number;
  perEvent?: boolean;
}

/** Whether this person may take this leave today, and the first reason they may not. */
export function statutoryEligibility(input: {
  rules: LeaveTypeRules;
  hireDate: string;
  asOf: string;
  sex?: string | null;
  civilStatus?: string | null;
  priorOccurrences: number;
}): { eligible: boolean; reason?: string } {
  const r = input.rules;
  if (r.sex && (input.sex ?? "").toLowerCase() !== r.sex) return { eligible: false, reason: `Only for ${r.sex} employees.` };
  if (r.civilStatus && (input.civilStatus ?? "").toLowerCase() !== r.civilStatus.toLowerCase()) return { eligible: false, reason: `Only for ${r.civilStatus} employees.` };
  if (r.minServiceMonths !== undefined && serviceMonths(input.hireDate, input.asOf) < r.minServiceMonths) {
    return { eligible: false, reason: `Needs ${r.minServiceMonths} months of service (from ${addMonths(input.hireDate, r.minServiceMonths)}).` };
  }
  if (r.maxOccurrences !== undefined && input.priorOccurrences >= r.maxOccurrences) return { eligible: false, reason: `Limited to ${r.maxOccurrences} occurrences.` };
  return { eligible: true };
}

/** Vacation leave of at least five days discharges the Service Incentive Leave (Art. 95(b)). */
export function silDischarged(vlDaysPerYear: number): boolean {
  return vlDaysPerYear >= 5;
}

/** Whether the employer is covered by Art. 95 at all: ten or more employees. */
export function silApplies(activeEmployees: number): boolean {
  return activeEmployees >= 10;
}
