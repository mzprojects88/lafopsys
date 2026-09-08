/**
 * The payroll engine: one approved timesheet + one compensation row + the
 * statutory tables in force -> one payslip, as lines that sum exactly.
 *
 * Pure: no dates from the clock, no I/O, centavo integers throughout
 * (money.ts). The server action assembles the input from the database and
 * writes the result; this file decides what the law and the foundation's
 * settings say the amounts are.
 *
 * Rules encoded (as of 2026-09; cited per function):
 * - Labor Code Arts. 83-93: 8-hour day, OT +25%, rest day +30%, rest-day OT
 *   169%, night shift differential +10% for 22:00-06:00 (compounding on the
 *   day's premium), undertime never offsets overtime (Art. 88).
 * - Art. 94 and the DOLE Handbook on Workers' Statutory Monetary Benefits:
 *   regular holiday 100% unworked / 200% worked / 260% on a rest day;
 *   special non-working day no-work-no-pay / 130% / 150% on a rest day.
 * - Monthly-paid daily rate = monthly x 12 / factor (365 pays rest days and
 *   holidays; 313 and 261 pay holidays only; a daily-paid person is paid for
 *   neither unless the day is worked or holiday pay is due).
 * - SSS Circular 2024-006, PhilHealth Circular 2019-0009 / 2024, HDMF
 *   Circular 460 (statutory.ts), withholding per RR 11-2018 Annex E
 *   (TRAIN, 2023+), minimum wage earners exempt (NIRC s.24(A)(2)).
 * - De minimis limits per RR 11-2018; 13th month exempt to 90,000 with
 *   other benefits (NIRC s.32(B)(7)(e)).
 * - Deductions only as Arts. 113-116 allow (the pay item carries the
 *   authorisation; the engine only caps them at the balance).
 */

import { halves, mulC, roundHalfUp, sumC, toCentavos, type Centavos } from "./money.ts";
import { pagibigContribution, philhealthPremium, splitDeMinimis, sssContribution, withholdingTax, THIRTEENTH_MONTH_EXEMPT_CEILING, type PagibigTable, type PhilhealthTable, type SssTable, type TaxTable } from "./statutory.ts";
import { PREMIUM_CLASSES, emptyBuckets, type PeriodAttendance, type PremiumClass } from "./attendance.ts";

// --- inputs ---------------------------------------------------------------------

export type PayBasis = "monthly" | "daily";
export type DaysFactor = 365 | 313 | 261;

export interface AllowanceLike {
  code: string;
  label: string;
  amountMonthly: number | string;
  tax: "taxable" | "de_minimis";
  deMinimisKind?: string;
}

export interface CompensationLike {
  payBasis: PayBasis;
  basicMonthly: number | string | null;
  dailyRate: number | string | null;
  daysFactor: DaysFactor;
  hoursPerDay: number | string;
  allowances: readonly AllowanceLike[];
  isMinimumWageEarner: boolean;
}

export type PayItemKind = "earning" | "deduction";
export type PayItemCode = "allowance_taxable" | "de_minimis" | "salary_advance" | "sss_loan" | "pagibig_loan" | "retro" | "other_earning" | "other_authorized";

export interface PayItemLike {
  id: string;
  kind: PayItemKind;
  code: PayItemCode;
  label: string;
  /** Amount to apply this cutoff, pesos. */
  amount: number | string;
  /** For a running balance (loan, advance): what is still owed before this cutoff, pesos. Null = not tracked. */
  remaining: number | string | null;
  deMinimisKind?: string | null;
}

export interface StatutoryTables {
  sss: SssTable;
  philhealth: PhilhealthTable;
  pagibig: PagibigTable;
  taxSemiMonthly: TaxTable;
  taxAnnual: TaxTable;
}

/** January-to-date figures before this payslip, in pesos (from hr.ytd_openings + approved payslips). */
export interface YearToDate {
  basicEarned: number;
  /** Taxable income after employee contributions: what the annual table is applied to. */
  taxableIncome: number;
  nonTaxable: number;
  taxWithheld: number;
  sssEe: number;
  philhealthEe: number;
  pagibigEe: number;
  /** 13th month and other benefits already paid this year (for the 90k ceiling). */
  thirteenthMonthPaid: number;
}

export const EMPTY_YTD: YearToDate = { basicEarned: 0, taxableIncome: 0, nonTaxable: 0, taxWithheld: 0, sssEe: 0, philhealthEe: 0, pagibigEe: 0, thirteenthMonthPaid: 0 };

export interface PayslipInput {
  period: { from: string; to: string; isSecondCutoff: boolean };
  comp: CompensationLike;
  /** The approved PeriodAttendance totals; null = no approved timesheet (a warning, computed as a full period). */
  attendance: PeriodAttendance["totals"] | null;
  payItems: readonly PayItemLike[];
  tables: StatutoryTables;
  /** The daily minimum wage in force for the person's region; null skips the check. */
  minimumWageDaily: number | null;
  /** Where the month's contributions are taken (app_settings.payroll_contribution_cutoff). */
  contributionCutoff: "second" | "split";
  /** The month's first cutoff, when computing the second: needed for a daily-paid person's actual monthly earnings. */
  firstCutoff: { basicEarned: number; taxableGross: number } | null;
  ytd: YearToDate;
  /** December's second cutoff or a final pay: true-up the year's tax against the annual table. */
  annualise: boolean;
}

// --- output ---------------------------------------------------------------------

export type PayLineKind = "earning" | "deduction" | "employer" | "info";

export interface PayLine {
  code: string;
  label: string;
  kind: PayLineKind;
  /** Centavos. Earnings positive (an absence is a negative earning); deductions positive. */
  amount: Centavos;
  /** Hours or days, when the line is rate x quantity. */
  qty?: number;
  /** Centavos per unit. */
  rate?: Centavos;
  multiplier?: number;
  /** Whether an earning counts toward taxable compensation. */
  taxable?: boolean;
  payItemId?: string;
}

export interface Statutory {
  sssEe: Centavos;
  sssEr: Centavos;
  ec: Centavos;
  mpfEe: Centavos;
  mpfEr: Centavos;
  philhealthEe: Centavos;
  philhealthEr: Centavos;
  pagibigEe: Centavos;
  pagibigEr: Centavos;
  taxWithheld: Centavos;
}

export type PayslipWarning = "below_minimum_wage" | "mwe_flag_mismatch" | "negative_net" | "no_approved_timesheet" | "missed_punches" | "approver_is_payee" | "projected_basic";

export interface PayslipComputation {
  lines: PayLine[];
  /** basic +/- absence, tardiness, undertime, unpaid leave. What 13th month is built on. */
  basicEarned: Centavos;
  gross: Centavos;
  taxableGross: Centavos;
  nonTaxable: Centavos;
  /** taxableGross less employee contributions: the figure the tax table is applied to. */
  taxableIncome: Centavos;
  totalDeductions: Centavos;
  net: Centavos;
  statutory: Statutory;
  employerTotal: Centavos;
  warnings: PayslipWarning[];
  rates: Rates;
}

// --- rates ----------------------------------------------------------------------

export interface Rates {
  /** Monthly equivalent, centavos (contributions for a monthly-paid person are on this). */
  monthly: Centavos;
  /** Unrounded daily rate in centavos; round only once a line is formed. */
  daily: number;
  hourly: number;
  hoursPerDay: number;
}

/** Monthly x 12 / factor = daily; daily / hours = hourly. Daily-paid: monthly equivalent = daily x factor / 12. */
export function rates(comp: CompensationLike): Rates {
  const hoursPerDay = Number(comp.hoursPerDay) || 8;
  if (comp.payBasis === "daily") {
    const daily = toCentavos(comp.dailyRate);
    return { monthly: roundHalfUp((daily * comp.daysFactor) / 12), daily, hourly: daily / hoursPerDay, hoursPerDay };
  }
  const monthly = toCentavos(comp.basicMonthly);
  const daily = (monthly * 12) / comp.daysFactor;
  return { monthly, daily, hourly: daily / hoursPerDay, hoursPerDay };
}

/** Multiplier of the hourly rate for regular and overtime work in each class (DOLE Handbook 2024). */
export const PREMIUM_MULTIPLIERS: Record<PremiumClass, { regular: number; overtime: number }> = {
  ordinary: { regular: 1, overtime: 1.25 },
  rest_day: { regular: 1.3, overtime: 1.69 },
  special_non_working: { regular: 1.3, overtime: 1.69 },
  special_on_rest_day: { regular: 1.5, overtime: 1.95 },
  regular_holiday: { regular: 2, overtime: 2.6 },
  regular_holiday_on_rest_day: { regular: 2.6, overtime: 3.38 },
};

/** Night shift differential: 10% of the hourly rate for the class (Art. 86; compounds on the premium). */
export const NIGHT_DIFFERENTIAL = 0.1;

/**
 * Whether the day's base pay (100%) is already inside the monthly salary.
 * 365 pays every calendar day; 313 and 261 exclude rest days but include
 * holidays; a daily-paid person is paid for a day only by working it.
 */
export function coveredByMonthly(cls: PremiumClass, comp: Pick<CompensationLike, "payBasis" | "daysFactor">): boolean {
  if (comp.payBasis === "daily") return false;
  if (comp.daysFactor === 365) return true;
  return cls === "special_non_working" || cls === "regular_holiday";
}

export const PREMIUM_LABELS: Record<PremiumClass, string> = {
  ordinary: "Ordinary day",
  rest_day: "Rest day",
  special_non_working: "Special non-working day",
  special_on_rest_day: "Special day on rest day",
  regular_holiday: "Regular holiday",
  regular_holiday_on_rest_day: "Regular holiday on rest day",
};

const hours = (minutes: number) => minutes / 60;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** A rate x quantity x multiplier line, rounded once. */
function rateLine(code: string, label: string, kind: PayLineKind, rate: number, qty: number, multiplier: number, extra: Partial<PayLine> = {}): PayLine {
  return { code, label, kind, amount: roundHalfUp(rate * qty * multiplier), qty: r2(qty), rate: roundHalfUp(rate), multiplier, taxable: kind === "earning", ...extra };
}

// --- the payslip ----------------------------------------------------------------

export function computePayslip(input: PayslipInput): PayslipComputation {
  const { comp, period, tables } = input;
  const rt = rates(comp);
  const lines: PayLine[] = [];
  const warnings: PayslipWarning[] = [];
  const t = input.attendance ?? emptyTotals();
  if (!input.attendance) warnings.push("no_approved_timesheet");
  if (t.missedPunches > 0) warnings.push("missed_punches");

  // 1. Basic pay, and what the month's salary loses to absence and lateness.
  if (comp.payBasis === "monthly") {
    const [first, second] = halves(rt.monthly);
    lines.push({ code: "basic", label: "Basic salary", kind: "earning", amount: period.isSecondCutoff ? second : first, taxable: true });
    if (t.absences > 0) lines.push(rateLine("absence", "Absence without leave", "earning", -rt.daily, t.absences, 1));
    if (t.unpaidLeaveDays > 0) lines.push(rateLine("unpaid_leave", "Leave without pay", "earning", -rt.daily, t.unpaidLeaveDays, 1));
    if (t.lateMinutes > 0) lines.push(rateLine("tardiness", "Tardiness", "earning", -rt.hourly, hours(t.lateMinutes), 1));
    if (t.undertimeMinutes > 0) lines.push(rateLine("undertime", "Undertime", "earning", -rt.hourly, hours(t.undertimeMinutes), 1));
  } else {
    // Daily-paid: the ordinary days worked, by the hour actually rendered
    // (a late arrival simply earns less), plus paid leave at the daily rate.
    const ordinary = t.byPremium.ordinary;
    if (ordinary.minutes > 0) lines.push(rateLine("basic", "Basic pay (days worked)", "earning", rt.hourly, hours(ordinary.minutes), 1));
    else lines.push({ code: "basic", label: "Basic pay (days worked)", kind: "earning", amount: 0, qty: 0, rate: roundHalfUp(rt.daily), taxable: true });
    if (t.paidLeaveDays > 0) lines.push(rateLine("paid_leave", "Paid leave", "earning", rt.daily, t.paidLeaveDays, 1));
    if (t.regularHolidaysUnworked > 0) lines.push(rateLine("holiday_pay", "Regular holiday pay (unworked, Art. 94)", "earning", rt.daily, t.regularHolidaysUnworked, 1));
  }
  const basicEarned = sumC(lines.map((l) => l.amount));

  // 2. Premiums: rest days and holidays worked, overtime, night differential.
  for (const cls of PREMIUM_CLASSES) {
    const b = t.byPremium[cls];
    const m = PREMIUM_MULTIPLIERS[cls];
    const label = PREMIUM_LABELS[cls];
    if (cls !== "ordinary" && b.minutes > 0) {
      const covered = coveredByMonthly(cls, comp) ? 1 : 0;
      const mult = r2(m.regular - covered);
      if (mult > 0) lines.push(rateLine(`premium:${cls}`, `${label} worked${covered ? " (premium)" : ""}`, "earning", rt.hourly, hours(b.minutes), mult));
    }
    if (b.overtimeMinutes > 0) lines.push(rateLine(`overtime:${cls}`, cls === "ordinary" ? "Overtime" : `${label} overtime`, "earning", rt.hourly, hours(b.overtimeMinutes), m.overtime));
    if (b.nightMinutes > 0) lines.push(rateLine(`night:${cls}`, cls === "ordinary" ? "Night shift differential" : `${label} night differential`, "earning", rt.hourly, hours(b.nightMinutes), r2(m.regular * NIGHT_DIFFERENTIAL)));
    if (b.nightOvertimeMinutes > 0) lines.push(rateLine(`night_ot:${cls}`, cls === "ordinary" ? "Overtime night differential" : `${label} overtime night differential`, "earning", rt.hourly, hours(b.nightOvertimeMinutes), r2(m.overtime * NIGHT_DIFFERENTIAL)));
  }

  // 3. Allowances: half the monthly amount per cutoff; de minimis within the limit is exempt, the excess taxable.
  let taxableAllowancesMonthly = 0;
  for (const a of comp.allowances) {
    const monthly = toCentavos(a.amountMonthly);
    if (monthly === 0) continue;
    const pick = (c: Centavos) => (period.isSecondCutoff ? halves(c)[1] : halves(c)[0]);
    if (a.tax === "taxable") {
      taxableAllowancesMonthly += monthly;
      lines.push({ code: `allowance:${a.code}`, label: a.label, kind: "earning", amount: pick(monthly), taxable: true });
    } else {
      const split = splitDeMinimis(a.deMinimisKind, monthly / 100);
      const exempt = toCentavos(split.exempt);
      const excess = monthly - exempt;
      if (exempt > 0) lines.push({ code: `allowance:${a.code}`, label: `${a.label} (de minimis)`, kind: "earning", amount: pick(exempt), taxable: false });
      if (excess > 0) {
        taxableAllowancesMonthly += excess;
        lines.push({ code: `allowance:${a.code}:excess`, label: `${a.label} (excess over de minimis limit)`, kind: "earning", amount: pick(excess), taxable: true });
      }
    }
  }

  // 4. Pay items: one-off or recurring earnings and authorised deductions.
  for (const item of input.payItems) {
    const amount = toCentavos(item.amount);
    if (amount <= 0) continue;
    if (item.kind === "earning") {
      const taxable = item.code !== "de_minimis";
      lines.push({ code: `item:${item.code}`, label: item.label, kind: "earning", amount, taxable, payItemId: item.id });
    } else {
      const remaining = item.remaining === null ? null : toCentavos(item.remaining);
      const applied = remaining === null ? amount : Math.min(amount, Math.max(0, remaining));
      if (applied > 0) lines.push({ code: `item:${item.code}`, label: item.label, kind: "deduction", amount: applied, payItemId: item.id });
    }
  }

  const earnings = lines.filter((l) => l.kind === "earning");
  const taxableGross = sumC(earnings.filter((l) => l.taxable).map((l) => l.amount));

  // 5. Contributions, as monthly figures allocated to the cutoff.
  const st = contributions(input, rt, basicEarned, taxableAllowancesMonthly);
  const eeContrib = st.sssEe + st.mpfEe + st.philhealthEe + st.pagibigEe;
  if (st.sssEe > 0) lines.push({ code: "sss_ee", label: "SSS contribution", kind: "deduction", amount: st.sssEe });
  if (st.mpfEe > 0) lines.push({ code: "mpf_ee", label: "SSS MPF contribution", kind: "deduction", amount: st.mpfEe });
  if (st.philhealthEe > 0) lines.push({ code: "philhealth_ee", label: "PhilHealth premium", kind: "deduction", amount: st.philhealthEe });
  if (st.pagibigEe > 0) lines.push({ code: "pagibig_ee", label: "Pag-IBIG contribution", kind: "deduction", amount: st.pagibigEe });

  // 6. Withholding tax on taxable compensation net of contributions (RR 11-2018 Annex E).
  const taxableIncome = Math.max(0, taxableGross - eeContrib);
  let taxWithheld = 0;
  if (comp.isMinimumWageEarner) {
    lines.push({ code: "tax_mwe", label: "Minimum wage earner: exempt from withholding (NIRC s.24(A)(2))", kind: "info", amount: 0 });
  } else {
    taxWithheld = toCentavos(withholdingTax(taxableIncome / 100, tables.taxSemiMonthly));
    if (input.annualise) {
      const annualIncome = toCentavos(input.ytd.taxableIncome) + taxableIncome;
      const annualDue = toCentavos(withholdingTax(annualIncome / 100, tables.taxAnnual));
      const withheldSoFar = toCentavos(input.ytd.taxWithheld) + taxWithheld;
      const adjustment = annualDue - withheldSoFar;
      if (adjustment !== 0) {
        lines.push({ code: "tax_annualisation", label: adjustment > 0 ? "Year-end tax adjustment (annualised)" : "Year-end tax refund (annualised)", kind: "info", amount: adjustment });
        taxWithheld += adjustment;
      }
    }
    if (taxWithheld > 0) lines.push({ code: "tax", label: "Withholding tax", kind: "deduction", amount: taxWithheld });
    else if (taxWithheld < 0) {
      // A refund: more was withheld during the year than the annual table asks. Paid back as a non-taxable earning.
      lines.push({ code: "tax_refund", label: "Tax refund", kind: "earning", amount: -taxWithheld, taxable: false });
    }
  }
  st.taxWithheld = taxWithheld;

  // 7. Employer shares, for the register and the remittance lists; not part of the person's pay.
  if (st.sssEr > 0) lines.push({ code: "sss_er", label: "SSS employer share", kind: "employer", amount: st.sssEr });
  if (st.ec > 0) lines.push({ code: "ec", label: "Employees' Compensation", kind: "employer", amount: st.ec });
  if (st.mpfEr > 0) lines.push({ code: "mpf_er", label: "SSS MPF employer share", kind: "employer", amount: st.mpfEr });
  if (st.philhealthEr > 0) lines.push({ code: "philhealth_er", label: "PhilHealth employer share", kind: "employer", amount: st.philhealthEr });
  if (st.pagibigEr > 0) lines.push({ code: "pagibig_er", label: "Pag-IBIG employer share", kind: "employer", amount: st.pagibigEr });

  // 8. Totals: recomputed from the lines so the invariant is what is stored.
  const finalEarnings = lines.filter((l) => l.kind === "earning");
  const finalGross = sumC(finalEarnings.map((l) => l.amount));
  const finalNonTaxable = sumC(finalEarnings.filter((l) => !l.taxable).map((l) => l.amount));
  const totalDeductions = sumC(lines.filter((l) => l.kind === "deduction").map((l) => l.amount));
  const net = finalGross - totalDeductions;
  const employerTotal = sumC(lines.filter((l) => l.kind === "employer").map((l) => l.amount));
  if (net < 0) warnings.push("negative_net");

  // 9. Minimum wage: on the hourly rate, so reduced hours are not a false alarm but a low rate is.
  if (input.minimumWageDaily !== null) {
    const minHourly = (input.minimumWageDaily * 100) / 8;
    if (!comp.isMinimumWageEarner && rt.hourly + 0.5 < minHourly) warnings.push("below_minimum_wage");
    if (comp.isMinimumWageEarner && Math.abs(rt.hourly - minHourly) > 50) warnings.push("mwe_flag_mismatch");
  }

  return {
    lines,
    basicEarned,
    gross: finalGross,
    taxableGross: finalGross - finalNonTaxable,
    nonTaxable: finalNonTaxable,
    taxableIncome,
    totalDeductions,
    net,
    statutory: st,
    employerTotal,
    warnings,
    rates: rt,
  };
}

function emptyTotals(): PeriodAttendance["totals"] {
  return { scheduledDays: 0, daysWorked: 0, absences: 0, lateMinutes: 0, undertimeMinutes: 0, paidLeaveDays: 0, unpaidLeaveDays: 0, regularHolidaysUnworked: 0, missedPunches: 0, byPremium: emptyBuckets() };
}

/**
 * The month's contributions and this cutoff's share of them.
 * Monthly-paid: on the compensation row's monthly figures (SSS on basic plus
 * taxable allowances, PhilHealth on basic, Pag-IBIG on total compensation),
 * split by the org rule. Daily-paid: on the month's actual earnings, so
 * always at the second cutoff, once the month is known.
 */
function contributions(input: PayslipInput, rt: Rates, basicEarned: Centavos, taxableAllowancesMonthly: Centavos): Statutory {
  const zero: Statutory = { sssEe: 0, sssEr: 0, ec: 0, mpfEe: 0, mpfEr: 0, philhealthEe: 0, philhealthEr: 0, pagibigEe: 0, pagibigEr: 0, taxWithheld: 0 };
  const { comp, tables, period } = input;
  const daily = comp.payBasis === "daily";
  const cutoff = daily ? "second" : input.contributionCutoff;
  if (cutoff === "second" && !period.isSecondCutoff) return zero;

  let basicMonthly: number;
  let compMonthly: number;
  if (daily) {
    const first = toCentavos(input.firstCutoff?.basicEarned ?? 0);
    basicMonthly = first + basicEarned;
    compMonthly = basicMonthly + taxableAllowancesMonthly;
  } else {
    basicMonthly = rt.monthly;
    compMonthly = rt.monthly + taxableAllowancesMonthly;
  }

  const sss = sssContribution(compMonthly / 100, tables.sss);
  const ph = philhealthPremium(basicMonthly / 100, tables.philhealth);
  const pi = pagibigContribution(compMonthly / 100, tables.pagibig);
  const month: Statutory = {
    sssEe: toCentavos(sss.ee),
    sssEr: toCentavos(sss.er),
    ec: toCentavos(sss.ec),
    mpfEe: toCentavos(sss.mpfEe),
    mpfEr: toCentavos(sss.mpfEr),
    philhealthEe: toCentavos(ph.ee),
    philhealthEr: toCentavos(ph.er),
    pagibigEe: toCentavos(pi.ee),
    pagibigEr: toCentavos(pi.er),
    taxWithheld: 0,
  };
  if (cutoff === "second") return month;
  // split: first cutoff takes the half-up half, the second the remainder.
  const share = (c: Centavos) => (period.isSecondCutoff ? halves(c)[1] : halves(c)[0]);
  return {
    sssEe: share(month.sssEe),
    sssEr: share(month.sssEr),
    ec: share(month.ec),
    mpfEe: share(month.mpfEe),
    mpfEr: share(month.mpfEr),
    philhealthEe: share(month.philhealthEe),
    philhealthEr: share(month.philhealthEr),
    pagibigEe: share(month.pagibigEe),
    pagibigEr: share(month.pagibigEr),
    taxWithheld: 0,
  };
}

// --- 13th month (PD 851) -------------------------------------------------------

export interface ThirteenthMonthInput {
  /** Basic salary earned within the calendar year, pesos (sum of basic_earned over the year's payslips plus the opening figure). */
  basicEarnedYear: number;
  /** Already paid this year (an advance in June, say), pesos. */
  alreadyPaid: number;
  /** Other benefits counted against the 90k ceiling, pesos. */
  otherBenefitsYear: number;
  /**
   * Basic salary of the cutoffs not yet paid when the 13th month is computed
   * (PD 851 is 1/12 of the WHOLE calendar year's basic; paying by Dec 24
   * means the December cutoffs are projected at the current rate), pesos.
   */
  projectedBasic?: number;
  /** How many cutoffs the projection covers, for the info line. */
  projectedCutoffs?: number;
}

/** Total basic earned (plus the projected remainder of the year) / 12, pro-rated by construction (a month not worked earned nothing). */
export function computeThirteenthMonth(input: ThirteenthMonthInput): { total: Centavos; payable: Centavos; exempt: Centavos; taxable: Centavos; lines: PayLine[] } {
  const projected = toCentavos(input.projectedBasic ?? 0);
  const total = roundHalfUp((toCentavos(input.basicEarnedYear) + projected) / 12);
  const payable = Math.max(0, total - toCentavos(input.alreadyPaid));
  const ceiling = toCentavos(THIRTEENTH_MONTH_EXEMPT_CEILING);
  const roomLeft = Math.max(0, ceiling - toCentavos(input.otherBenefitsYear) - toCentavos(input.alreadyPaid));
  const exempt = Math.min(payable, roomLeft);
  const taxable = payable - exempt;
  const lines: PayLine[] = [];
  if (exempt > 0) lines.push({ code: "thirteenth_month", label: "13th month pay (PD 851)", kind: "earning", amount: exempt, taxable: false });
  if (taxable > 0) lines.push({ code: "thirteenth_month:excess", label: "13th month pay over the 90,000 exemption", kind: "earning", amount: taxable, taxable: true });
  if (projected > 0) lines.push({ code: "thirteenth_month:projected", label: `Basic salary projected for ${input.projectedCutoffs ?? 0} cutoff${input.projectedCutoffs === 1 ? "" : "s"} not yet paid`, kind: "info", amount: projected });
  return { total, payable, exempt, taxable, lines };
}

// --- final pay (LA 06-20; Arts. 298-299 for separation pay) -----------------------

/** Days of monetised unused VL that are de minimis (RR 11-2018 s.2.78.1(A)(3)). */
export const VL_CONVERSION_DE_MINIMIS_DAYS = 10;

export type SeparationCause = "resignation" | "end_of_contract" | "redundancy" | "retrenchment" | "closure" | "disease" | "just_cause" | "retirement" | "death";

export interface FinalPayInput {
  /** The last partial period, already computed. */
  lastPayslip: Pick<PayslipComputation, "lines" | "gross" | "totalDeductions" | "net">;
  thirteenth: ReturnType<typeof computeThirteenthMonth>;
  /** Unused convertible VL days x daily rate; 0 when not convertible. */
  vlDays: number;
  dailyRate: number;
  monthlyRate: number;
  cause: SeparationCause;
  /** Whole years of service, half a year and up rounds up (Art. 298). */
  serviceYears: number;
  /** Cash advances, unreturned property: pesos. */
  accountabilities: number;
}

/** Separation pay per Arts. 298-299: redundancy 1 month per year, retrenchment / closure / disease half a month per year, both at least one month; nothing for resignation, just cause or end of contract. */
export function separationPay(cause: SeparationCause, monthlyRate: Centavos, serviceYears: number): Centavos {
  const years = Math.max(1, Math.round(serviceYears));
  switch (cause) {
    case "redundancy":
      return monthlyRate * years;
    case "retrenchment":
    case "closure":
    case "disease":
      return Math.max(monthlyRate, mulC(monthlyRate, 0.5 * years));
    default:
      return 0;
  }
}

export function computeFinalPay(input: FinalPayInput): { lines: PayLine[]; gross: Centavos; totalDeductions: Centavos; net: Centavos } {
  const lines: PayLine[] = [...input.lastPayslip.lines.filter((l) => l.kind !== "employer")];
  lines.push(...input.thirteenth.lines.map((l) => ({ ...l, label: `${l.label}, pro-rated` })));
  const daily = toCentavos(input.dailyRate);
  // Monetised unused VL of a private employee is de minimis up to 10 days (RR 11-2018 s.2.78.1(A)(3)); only the excess is taxable.
  const vlExempt = Math.min(input.vlDays, VL_CONVERSION_DE_MINIMIS_DAYS);
  const vlTaxable = Math.max(0, input.vlDays - VL_CONVERSION_DE_MINIMIS_DAYS);
  if (vlExempt > 0) lines.push(rateLine("vl_conversion", "Unused vacation leave converted to cash (de minimis)", "earning", daily, vlExempt, 1, { taxable: false }));
  if (vlTaxable > 0) lines.push(rateLine("vl_conversion:excess", "Unused vacation leave over 10 days converted to cash", "earning", daily, vlTaxable, 1, { taxable: true }));
  const sep = separationPay(input.cause, toCentavos(input.monthlyRate), input.serviceYears);
  if (sep > 0) lines.push({ code: "separation_pay", label: "Separation pay (Art. 298)", kind: "earning", amount: sep, taxable: false });
  const acc = toCentavos(input.accountabilities);
  if (acc > 0) lines.push({ code: "accountabilities", label: "Accountabilities", kind: "deduction", amount: acc });
  const gross = sumC(lines.filter((l) => l.kind === "earning").map((l) => l.amount));
  const totalDeductions = sumC(lines.filter((l) => l.kind === "deduction").map((l) => l.amount));
  return { lines, gross, totalDeductions, net: gross - totalDeductions };
}

// --- differential / adjustment runs ----------------------------------------------

/** The lines an adjustment run pays: recomputed minus original, per code, dropping zeros. */
export function computeDifferential(original: readonly PayLine[], recomputed: readonly PayLine[]): PayLine[] {
  const key = (l: PayLine) => `${l.kind}|${l.code}`;
  const before = new Map<string, PayLine>();
  for (const l of original) before.set(key(l), { ...l, amount: (before.get(key(l))?.amount ?? 0) + l.amount });
  const after = new Map<string, PayLine>();
  for (const l of recomputed) after.set(key(l), { ...l, amount: (after.get(key(l))?.amount ?? 0) + l.amount });
  const out: PayLine[] = [];
  const keys = new Set([...before.keys(), ...after.keys()]);
  for (const k of keys) {
    const a = after.get(k);
    const b = before.get(k);
    const diff = (a?.amount ?? 0) - (b?.amount ?? 0);
    if (diff === 0) continue;
    const src = a ?? b!;
    out.push({ code: src.code, label: `${src.label} (adjustment)`, kind: src.kind, amount: diff, taxable: src.taxable, payItemId: src.payItemId });
  }
  return out;
}

/** Sum a run's payslips into the register totals. */
export function registerTotals(slips: readonly Pick<PayslipComputation, "gross" | "totalDeductions" | "net" | "employerTotal" | "statutory" | "basicEarned" | "taxableGross" | "nonTaxable">[]) {
  const sum = (pick: (s: (typeof slips)[number]) => number) => sumC(slips.map(pick));
  return {
    count: slips.length,
    basicEarned: sum((s) => s.basicEarned),
    gross: sum((s) => s.gross),
    taxableGross: sum((s) => s.taxableGross),
    nonTaxable: sum((s) => s.nonTaxable),
    totalDeductions: sum((s) => s.totalDeductions),
    net: sum((s) => s.net),
    employerTotal: sum((s) => s.employerTotal),
    taxWithheld: sum((s) => s.statutory.taxWithheld),
    sssEe: sum((s) => s.statutory.sssEe),
    sssEr: sum((s) => s.statutory.sssEr),
    ec: sum((s) => s.statutory.ec),
    mpfEe: sum((s) => s.statutory.mpfEe),
    mpfEr: sum((s) => s.statutory.mpfEr),
    philhealthEe: sum((s) => s.statutory.philhealthEe),
    philhealthEr: sum((s) => s.statutory.philhealthEr),
    pagibigEe: sum((s) => s.statutory.pagibigEe),
    pagibigEr: sum((s) => s.statutory.pagibigEr),
  };
}

export type RegisterTotals = ReturnType<typeof registerTotals>;
