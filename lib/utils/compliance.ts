/**
 * The compliance calendar: every recurring government obligation of the
 * foundation, its due rule, and the dates that rule produces for a window.
 *
 * Pure. Items come from hr.compliance_items (0043, seeded from the
 * foundation's compliance workbook); filings from hr.compliance_filings.
 * Due dates roll FORWARD to the next business day, the opposite of pay
 * dates: a deadline on a Saturday is met on Monday (BIR RMC 30-2018 and
 * the agencies' practice), while pay must arrive before the weekend.
 *
 * Rules encoded (as of 2026-09):
 * - BIR 1601-C: 10th of the following month; December's return is due
 *   January 15 (RR 11-2018 s.2.81). 1604-C, the alphalist and the 2316
 *   to employees: January 31 (RR 11-2018 s.2.83). 1702Q: 60 days after
 *   Q1-Q3; 2551Q: 25 days after every quarter; 1702: April 15.
 * - SSS: last day of the month following the applicable month (Circular
 *   2019-006). PhilHealth EPRS: PEN ending 0-4 by the 15th, 5-9 by the
 *   20th of the following month (Circular 2019-0009). Pag-IBIG: by the
 *   employer's first letter, A-D 14th, E-L 19th, M-Q 24th, R-Z and
 *   numerals the last day of the following month (HDMF Circular 275).
 * - 13th month: paid by December 24, reported to DOLE by January 15
 *   (PD 851 IRR; DOLE LA 18-24).
 * - Headcount thresholds: SIL exempt below 10 workers (Art. 95); the
 *   maternity salary-differential exemption is available at 10 or fewer
 *   workers on application (RA 11210 IRR s.3); OSH staffing tiers by
 *   headcount (DO 198-18 s.14).
 */

import { addDays, dayKey } from "./dtr.ts";
import type { HolidayLike } from "./pay-period.ts";
import { isNonWorkingDay } from "./pay-period.ts";

// --- rules --------------------------------------------------------------------------

export type Frequency = "monthly" | "quarterly" | "annual" | "as_needed";
export type Applies = "yes" | "if_employees" | "conditional" | "not_required";
export type ComplianceCategory = "employment" | "corporate" | "lgu" | "data_privacy" | "osh";

export type DueRule =
  /** Annual: month/day, `yearOffset` 1 when the obligation for year Y falls in Y+1 (most returns). */
  | { kind: "fixed"; month: number; day: number; yearOffset?: 0 | 1 }
  /** Monthly: the day of the FOLLOWING month; `december` overrides the December return (1601-C -> Jan 15). */
  | { kind: "day_of_month"; day: number; december?: { month: number; day: number } }
  /** Monthly: the last day of the following month. */
  | { kind: "last_day_next_month" }
  /** Quarterly: either N days after the quarter ends, or a day of the following month, or its last day. */
  | { kind: "quarterly"; offsetDays?: number; day?: number; monthEnd?: boolean; quarters?: number[] }
  /** Monthly: PhilHealth, by the PEN's last digit. */
  | { kind: "pen_digit" }
  /** Monthly: Pag-IBIG, by the employer name's first character. */
  | { kind: "employer_initial" }
  /** No calendar date: tracked when it happens. */
  | { kind: "as_needed" };

export interface ComplianceItemLike {
  id: string;
  code: string;
  agency: string;
  name: string;
  form: string | null;
  category: ComplianceCategory;
  frequency: Frequency;
  dueRule: DueRule;
  applies: Applies;
  /** HR's switch: CONDITIONAL items start off. */
  active: boolean;
}

export type FilingStatus = "due" | "in_progress" | "filed" | "late" | "na";

export interface FilingLike {
  itemId: string;
  periodKey: string;
  status: FilingStatus;
  filedOn: string | null;
}

export interface ComplianceContext {
  /** Last digit of the PhilHealth Employer Number; null until set in Settings. */
  penLastDigit: number | null;
  /** First character of the employer's registered name; null until set. */
  employerInitial: string | null;
  /** The calendar starts here: periods ending before it are not shown as overdue. */
  trackingFrom: string;
  holidays: readonly HolidayLike[];
}

// --- dates --------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Forward to the next business day (Mon-Fri, not a national holiday). */
export function rollForward(day: string, holidays: readonly HolidayLike[]): string {
  let d = day;
  for (let i = 0; i < 10 && isNonWorkingDay(d, holidays); i++) d = addDays(d, 1);
  return d;
}

export function parseDueRule(raw: unknown): DueRule {
  if (!raw || typeof raw !== "object") throw new Error("Due rule must be an object");
  const r = raw as Record<string, unknown>;
  const n = (k: string) => {
    const v = r[k];
    if (typeof v !== "number" || !Number.isInteger(v)) throw new Error(`Due rule ${k} must be a whole number`);
    return v;
  };
  switch (r.kind) {
    case "fixed": {
      const month = n("month");
      const day = n("day");
      if (month < 1 || month > 12 || day < 1 || day > 31) throw new Error("Due rule month/day out of range");
      return { kind: "fixed", month, day, yearOffset: r.yearOffset === 1 ? 1 : 0 };
    }
    case "day_of_month": {
      const day = n("day");
      if (day < 1 || day > 31) throw new Error("Due rule day out of range");
      const dec = r.december as Record<string, unknown> | undefined;
      return dec ? { kind: "day_of_month", day, december: { month: Number(dec.month), day: Number(dec.day) } } : { kind: "day_of_month", day };
    }
    case "last_day_next_month":
      return { kind: "last_day_next_month" };
    case "quarterly": {
      const out: DueRule = { kind: "quarterly" };
      if (r.offsetDays !== undefined) out.offsetDays = n("offsetDays");
      if (r.day !== undefined) out.day = n("day");
      if (r.monthEnd) out.monthEnd = true;
      if (Array.isArray(r.quarters)) out.quarters = r.quarters.map(Number);
      if (out.offsetDays === undefined && out.day === undefined && !out.monthEnd) throw new Error("Quarterly rule needs offsetDays, day or monthEnd");
      return out;
    }
    case "pen_digit":
      return { kind: "pen_digit" };
    case "employer_initial":
      return { kind: "employer_initial" };
    case "as_needed":
      return { kind: "as_needed" };
    default:
      throw new Error(`Unknown due rule kind ${String(r.kind)}`);
  }
}

/** PhilHealth Circular 2019-0009: PEN ending 0-4 by the 15th, 5-9 by the 20th. */
export function philhealthDueDay(penLastDigit: number): number {
  return penLastDigit <= 4 ? 15 : 20;
}

/** HDMF Circular 275: A-D 10th-14th, E-L 15th-19th, M-Q 20th-24th, R-Z and numerals 25th-end. */
export function pagibigDueDay(initial: string, y: number, m: number): number {
  const c = initial.trim().toUpperCase()[0] ?? "Z";
  if (c >= "A" && c <= "D") return 14;
  if (c >= "E" && c <= "L") return 19;
  if (c >= "M" && c <= "Q") return 24;
  return lastDay(y, m);
}

export interface Deadline {
  itemId: string;
  code: string;
  /** "2026-08", "2026-Q3", "2026". */
  periodKey: string;
  periodLabel: string;
  /** The rule's date before rolling. */
  dueRaw: string;
  dueOn: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Every deadline of one item whose PERIOD ends inside the window (so the
 * August return, due September 10, belongs to August). Windows are
 * inclusive day keys. Items needing a PEN digit or employer initial yield
 * nothing until the context has it.
 */
export function dueDatesFor(item: ComplianceItemLike, window: { from: string; to: string }, ctx: ComplianceContext): Deadline[] {
  const out: Deadline[] = [];
  const rule = item.dueRule;
  if (rule.kind === "as_needed") return out;
  const push = (periodKey: string, periodLabel: string, dueRaw: string) => out.push({ itemId: item.id, code: item.code, periodKey, periodLabel, dueRaw, dueOn: rollForward(dueRaw, ctx.holidays) });
  const fromY = Number(window.from.slice(0, 4));
  const toY = Number(window.to.slice(0, 4));
  const start = ctx.trackingFrom > window.from ? ctx.trackingFrom : window.from;

  for (let y = fromY - 1; y <= toY; y++) {
    if (rule.kind === "fixed") {
      const periodEnd = iso(y, 12, 31);
      if (periodEnd < start || periodEnd > window.to) continue;
      push(String(y), String(y), iso(y + (rule.yearOffset ?? 0), rule.month, rule.day));
      continue;
    }
    if (rule.kind === "quarterly") {
      for (const q of rule.quarters ?? [1, 2, 3, 4]) {
        const endM = q * 3;
        const periodEnd = iso(y, endM, lastDay(y, endM));
        if (periodEnd < start || periodEnd > window.to) continue;
        let due: string;
        if (rule.offsetDays !== undefined) due = addDays(periodEnd, rule.offsetDays);
        else {
          const ny = endM === 12 ? y + 1 : y;
          const nm = endM === 12 ? 1 : endM + 1;
          due = iso(ny, nm, rule.monthEnd ? lastDay(ny, nm) : rule.day!);
        }
        push(`${y}-Q${q}`, `Q${q} ${y}`, due);
      }
      continue;
    }
    // monthly kinds
    for (let m = 1; m <= 12; m++) {
      const periodEnd = iso(y, m, lastDay(y, m));
      if (periodEnd < start || periodEnd > window.to) continue;
      const ny = m === 12 ? y + 1 : y;
      const nm = m === 12 ? 1 : m + 1;
      let due: string | null = null;
      switch (rule.kind) {
        case "day_of_month":
          due = m === 12 && rule.december ? iso(ny, rule.december.month, rule.december.day) : iso(ny, nm, Math.min(rule.day, lastDay(ny, nm)));
          break;
        case "last_day_next_month":
          due = iso(ny, nm, lastDay(ny, nm));
          break;
        case "pen_digit":
          if (ctx.penLastDigit === null) break;
          due = iso(ny, nm, philhealthDueDay(ctx.penLastDigit));
          break;
        case "employer_initial":
          if (!ctx.employerInitial) break;
          due = iso(ny, nm, pagibigDueDay(ctx.employerInitial, ny, nm));
          break;
      }
      if (due) push(`${y}-${pad(m)}`, `${MONTHS[m - 1]} ${y}`, due);
    }
  }
  return out.sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : 0));
}

// --- the calendar -------------------------------------------------------------------

export type CalendarStatus = "due" | "due_soon" | "overdue" | "in_progress" | "filed" | "late" | "na";

export interface CalendarEntry<F extends FilingLike = FilingLike, I extends ComplianceItemLike = ComplianceItemLike> extends Deadline {
  item: I;
  filing: F | null;
  status: CalendarStatus;
  daysLeft: number;
}

export const DUE_SOON_DAYS = 14;

/** Deadlines of every active item in the window, with the filing's state or what the calendar says about it. */
export function complianceCalendar<F extends FilingLike, I extends ComplianceItemLike>(items: readonly I[], filings: readonly F[], window: { from: string; to: string }, ctx: ComplianceContext, today: string): CalendarEntry<F, I>[] {
  const byKey = new Map(filings.map((f) => [`${f.itemId}|${f.periodKey}`, f]));
  const out: CalendarEntry<F, I>[] = [];
  for (const item of items) {
    if (!item.active || item.applies === "not_required") continue;
    for (const d of dueDatesFor(item, window, ctx)) {
      const filing = byKey.get(`${item.id}|${d.periodKey}`) ?? null;
      const daysLeft = daysBetweenKeys(today, d.dueOn);
      let status: CalendarStatus;
      if (filing?.status === "filed") status = filing.filedOn && filing.filedOn > d.dueOn ? "late" : "filed";
      else if (filing?.status === "na") status = "na";
      else if (filing?.status === "late") status = "late";
      else if (daysLeft < 0) status = "overdue";
      else if (filing?.status === "in_progress") status = "in_progress";
      else if (daysLeft <= DUE_SOON_DAYS) status = "due_soon";
      else status = "due";
      out.push({ ...d, item, filing, status, daysLeft });
    }
  }
  return out.sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : a.item.agency.localeCompare(b.item.agency)));
}

function daysBetweenKeys(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

// --- payroll-derived deadlines ------------------------------------------------------------

/** The item codes the payroll figures attach to. */
export const PAYROLL_ITEM_CODES = {
  withholding: "bir_1601c",
  sss: "sss_prn",
  philhealth: "philhealth_eprs",
  pagibig: "pagibig_mcrf",
  thirteenth: "dole_13th_report",
  annualReturn: "bir_1604c",
  alphalist: "bir_alphalist",
  certificates: "bir_2316",
} as const;

/** For one month of payroll: the four remittance deadlines it creates (no PEN/initial -> null dates). */
export function monthlyRemittanceDeadlines(year: number, month: number, ctx: ComplianceContext): { code: string; dueOn: string | null }[] {
  const ny = month === 12 ? year + 1 : year;
  const nm = month === 12 ? 1 : month + 1;
  const roll = (d: string) => rollForward(d, ctx.holidays);
  return [
    { code: PAYROLL_ITEM_CODES.withholding, dueOn: roll(month === 12 ? iso(ny, 1, 15) : iso(ny, nm, 10)) },
    { code: PAYROLL_ITEM_CODES.sss, dueOn: roll(iso(ny, nm, lastDay(ny, nm))) },
    { code: PAYROLL_ITEM_CODES.philhealth, dueOn: ctx.penLastDigit === null ? null : roll(iso(ny, nm, philhealthDueDay(ctx.penLastDigit))) },
    { code: PAYROLL_ITEM_CODES.pagibig, dueOn: ctx.employerInitial ? roll(iso(ny, nm, pagibigDueDay(ctx.employerInitial, ny, nm))) : null },
  ];
}

/** Year-end: 13th month paid by Dec 24, DOLE report Jan 15, 1604-C + alphalist + 2316 Jan 31. */
export function yearEndDeadlines(year: number, ctx: ComplianceContext): { code: string; label: string; dueOn: string }[] {
  const roll = (d: string) => rollForward(d, ctx.holidays);
  return [
    { code: "thirteenth_month_pay", label: "13th month pay released", dueOn: iso(year, 12, 24) },
    { code: PAYROLL_ITEM_CODES.thirteenth, label: "DOLE 13th month compliance report", dueOn: roll(iso(year + 1, 1, 15)) },
    { code: PAYROLL_ITEM_CODES.annualReturn, label: "BIR 1604-C", dueOn: roll(iso(year + 1, 1, 31)) },
    { code: PAYROLL_ITEM_CODES.alphalist, label: "Alphalist of employees", dueOn: roll(iso(year + 1, 1, 31)) },
    { code: PAYROLL_ITEM_CODES.certificates, label: "BIR 2316 to every employee", dueOn: roll(iso(year + 1, 1, 31)) },
  ];
}

// --- headcount --------------------------------------------------------------------------

export interface HeadcountThresholds {
  headcount: number;
  /** Art. 95: establishments regularly employing fewer than 10 are exempt from SIL. */
  silExempt: boolean;
  /** RA 11210 IRR: an employer with 10 or fewer workers may apply for exemption from the salary differential. */
  maternityDifferentialExemptEligible: boolean;
  /** DO 198-18: 1-9 workers need a first aider and a safety officer 1; 10-50 a safety officer and first aider; more, dedicated staff. */
  oshTier: "1-9" | "10-50" | "51-200" | "201+";
}

export function headcountThresholds(headcount: number): HeadcountThresholds {
  return {
    headcount,
    silExempt: headcount < 10,
    maternityDifferentialExemptEligible: headcount <= 10,
    oshTier: headcount <= 9 ? "1-9" : headcount <= 50 ? "10-50" : headcount <= 200 ? "51-200" : "201+",
  };
}

/** Today's day key for a Date (Manila), re-exported so pages have one import. */
export const todayKey = (d: Date) => dayKey(d);
