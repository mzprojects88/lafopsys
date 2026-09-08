/**
 * The DSWD annual reports a licensed social welfare agency files within the
 * first quarter of the following year (MC 17 s.2018 s.2.8): Annex E, the
 * financial report (DSWD-GF-010), and Annex G, the accomplishment report.
 * This drafts their figures from what the system holds; the page lays
 * them out in the forms' own sections for copying onto the templates.
 *
 * Money follows the repo's one rule (migration 0033, finance-summary.ts):
 * the bank statement and the receipt logs are never summed together.
 *   - Income and expenditure TOTALS come from the bank: every credit that
 *     is not the bank's own interest is a donation, every debit an expense.
 *   - The donor list and the local / foreign / government split come from
 *     the receipt logs (cash entries with a donor name), folded for
 *     re-records by donorBreakdown(). Whatever the bank received beyond
 *     the receipts attributed is shown as one reconciling line so the
 *     section still adds up to the bank total.
 *   - Expenditure lines come from the outflows classified against the bank
 *     tab, grouped by their source; the "Butch reimbursements" tab
 *     re-records spending the bank debit already carries, so it is left
 *     out. The remainder is one "Unclassified" line.
 *
 * Pure and dependency-free beyond finance-summary.ts, so it runs under
 * `node --test`.
 */

import { cashInBank, donorBreakdown, monthlySummary, normalizeDonorName, type BankTxnLike, type ReceiptLike } from "./finance-summary.ts";

export interface CashEntryLike extends ReceiptLike {
  source: string;
  currency: "PHP" | "USD";
}

export interface DonorLike {
  name: string;
  type: "individual" | "corporate" | "foundation" | "government" | "anonymous";
  taxJurisdiction: "US" | "PH";
}

export interface PatientLike {
  /** ISO timestamp or day key of admission. */
  admittedAt: string | null;
  sex: "M" | "F" | null;
}

export interface CensusLike {
  /** `yyyy-MM-dd`. */
  date: string;
  inHouse: number;
}

export interface HeadcountLike {
  date: string;
  headcount: number;
}

export type IncomeBucket = "local" | "foreign" | "government" | "others";

export interface DonorIncomeLine {
  donorName: string;
  amount: number;
  gifts: number;
}

export interface AnnexE {
  year: number;
  /** Cash in bank at the end of the prior year; null when no statement covers it. */
  previousBalance: number | null;
  /** From the bank: credits other than interest. */
  totalDonations: number;
  /** From the bank: interest credits. */
  interest: number;
  /** totalDonations + interest. */
  totalIncome: number;
  buckets: Record<IncomeBucket, { total: number; donors: DonorIncomeLine[] }>;
  /** Bank donations not matched to any attributed receipt (never negative). */
  unattributed: number;
  /** True when receipts exceed the bank's donations (and the bank has data): re-records not yet folded. */
  receiptsExceedBank: boolean;
  /** From the bank: every debit. */
  totalExpenses: number;
  expenseLines: { source: string; amount: number; pct: number }[];
  /** Bank expenses not classified by any cash entry (never negative). */
  unclassifiedExpenses: number;
  /** previousBalance + totalIncome - totalExpenses, when the previous balance is known. */
  computedEndingBalance: number | null;
  /** What the bank actually said on its last line of the year. */
  bankEndingBalance: number | null;
  bankEndingAsOf: string | null;
  /** Months of the year with no statement lines: the totals are short by them. */
  monthsWithoutStatements: number[];
}

export interface AnnexG {
  year: number;
  beneficiaries: { male: number; female: number; unknown: number; total: number };
  /** Sum of the daily in-house count over the census dates in the year. */
  bedNights: number;
  /** First census date within the year, or null: the figure covers from here. */
  censusFrom: string | null;
  censusDays: number;
  meals: number;
  careCartServed: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Which Annex E section a receipt belongs to, by the donor it names. */
export function incomeBucketFor(entry: Pick<CashEntryLike, "donorName" | "source">, donorByName: ReadonlyMap<string, DonorLike>): IncomeBucket {
  if (entry.source === "interest") return "others";
  const donor = entry.donorName ? donorByName.get(normalizeDonorName(entry.donorName)) : undefined;
  if (!donor) return "local";
  if (donor.type === "government") return "government";
  if (donor.taxJurisdiction === "US") return "foreign";
  return "local";
}

export function donorIndex(donors: readonly DonorLike[]): Map<string, DonorLike> {
  const m = new Map<string, DonorLike>();
  for (const d of donors) m.set(normalizeDonorName(d.name), d);
  return m;
}

/** The tab whose outflows re-record what the bank debit already carries. */
const REIMBURSEMENT_SHEET = "Butch reimburments";

export function annexEFinancial(txns: readonly BankTxnLike[], entries: readonly CashEntryLike[], donors: readonly DonorLike[], year: number): AnnexE {
  const inYear = txns.filter((t) => t.postingDate.startsWith(`${year}-`));
  const summary = monthlySummary(inYear, year, {});
  const interest = round2(inYear.reduce((a, t) => a + (t.category === "interest" ? t.credit : 0), 0));
  const totalDonations = summary.total.donation;
  const totalExpenses = summary.total.expenses;
  const totalIncome = round2(totalDonations + interest);
  const monthsWithoutStatements = summary.rows.filter((r) => !r.hasData).map((r) => r.monthNumber);

  // Donor list: every month's folded receipts, PHP only, bucketed by the donor record.
  const php = entries.filter((e) => e.currency === "PHP");
  const byName = donorIndex(donors);
  const buckets: AnnexE["buckets"] = { local: { total: 0, donors: [] }, foreign: { total: 0, donors: [] }, government: { total: 0, donors: [] }, others: { total: 0, donors: [] } };
  const lineBy = new Map<string, { bucket: IncomeBucket; line: DonorIncomeLine }>();
  for (let m = 1; m <= 12; m++) {
    const month = `${year}-${String(m).padStart(2, "0")}`;
    for (const line of donorBreakdown(php, month)) {
      const bucket = incomeBucketFor({ donorName: line.donorName, source: "cash_donation" }, byName);
      const key = `${bucket}|${normalizeDonorName(line.donorName)}`;
      const existing = lineBy.get(key);
      if (existing) {
        existing.line.amount = round2(existing.line.amount + line.amount);
        existing.line.gifts += 1;
      } else lineBy.set(key, { bucket, line: { donorName: line.donorName, amount: line.amount, gifts: 1 } });
    }
  }
  for (const { bucket, line } of lineBy.values()) {
    buckets[bucket].donors.push(line);
    buckets[bucket].total = round2(buckets[bucket].total + line.amount);
  }
  for (const b of Object.values(buckets)) b.donors.sort((a, c) => c.amount - a.amount || a.donorName.localeCompare(c.donorName));
  if (interest > 0) {
    buckets.others.donors.push({ donorName: "Interest income on bank deposits", amount: interest, gifts: 0 });
    buckets.others.total = round2(buckets.others.total + interest);
  }
  const attributed = round2(buckets.local.total + buckets.foreign.total + buckets.government.total);
  const unattributed = Math.max(0, round2(totalDonations - attributed));
  const receiptsExceedBank = totalDonations > 0 && attributed > totalDonations;

  // Expenditure: the classified outflows against the bank tab, by source.
  const bySource = new Map<string, number>();
  for (const e of php) {
    if (e.direction !== "outflow" || e.approvalStatus !== "approved" || !e.date?.startsWith(`${year}-`)) continue;
    if (e.sourceSheet === REIMBURSEMENT_SHEET) continue;
    bySource.set(e.source, round2((bySource.get(e.source) ?? 0) + e.amount));
  }
  const expenseLines = [...bySource.entries()]
    .map(([source, amount]) => ({ source, amount, pct: totalExpenses > 0 ? amount / totalExpenses : 0 }))
    .sort((a, b) => b.amount - a.amount);
  const classified = round2(expenseLines.reduce((a, l) => a + l.amount, 0));
  const unclassifiedExpenses = Math.max(0, round2(totalExpenses - classified));

  const prior = cashInBank(txns.filter((t) => t.postingDate <= `${year - 1}-12-31`));
  const previousBalance = prior ? prior.amount : null;
  const ending = cashInBank(inYear);
  return {
    year,
    previousBalance,
    totalDonations,
    interest,
    totalIncome,
    buckets,
    unattributed,
    receiptsExceedBank,
    totalExpenses,
    expenseLines,
    unclassifiedExpenses,
    computedEndingBalance: previousBalance === null ? null : round2(previousBalance + totalIncome - totalExpenses),
    bankEndingBalance: ending ? ending.amount : null,
    bankEndingAsOf: ending ? ending.asOf : null,
    monthsWithoutStatements,
  };
}

export function annexGAccomplishment(patients: readonly PatientLike[], census: readonly CensusLike[], meals: readonly HeadcountLike[], careCart: readonly HeadcountLike[], year: number): AnnexG {
  const y = `${year}-`;
  const admitted = patients.filter((p) => p.admittedAt?.startsWith(y));
  const male = admitted.filter((p) => p.sex === "M").length;
  const female = admitted.filter((p) => p.sex === "F").length;
  const days = census.filter((c) => c.date.startsWith(y)).sort((a, b) => a.date.localeCompare(b.date));
  return {
    year,
    beneficiaries: { male, female, unknown: admitted.length - male - female, total: admitted.length },
    bedNights: days.reduce((a, c) => a + c.inHouse, 0),
    censusFrom: days[0]?.date ?? null,
    censusDays: days.length,
    meals: meals.filter((m) => m.date.startsWith(y)).reduce((a, m) => a + m.headcount, 0),
    careCartServed: careCart.filter((m) => m.date.startsWith(y)).reduce((a, m) => a + m.headcount, 0),
  };
}

/** The Annex E label for a cash-entry source. */
export const EXPENSE_SOURCE_LABELS: Readonly<Record<string, string>> = {
  program_expense: "Programme expenses (patient support)",
  payroll: "Salaries and benefits",
  rent_utilities: "Rent and utilities",
  vehicle_fuel: "Vehicle fuel and transport",
  admin_ops: "Administrative and operating expenses",
  emergency_assistance: "Emergency assistance",
  burial_assistance: "Burial assistance",
};

export function expenseSourceLabel(source: string): string {
  return EXPENSE_SOURCE_LABELS[source] ?? source.replace(/_/g, " ");
}
