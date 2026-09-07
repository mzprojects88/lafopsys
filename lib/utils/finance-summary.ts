/**
 * The CEO's "Income and Expenses Tracking" sheet, as arithmetic.
 *
 * Pure and dependency-free so it runs under `node --test`. Two inputs, kept
 * apart on purpose (see migration 0033):
 *
 *   bank transactions -> Expenses, Donation, Net, %, Cash in Bank
 *   cash-entry receipts -> the donor breakdown (who gave)
 *
 * They are never summed together. Bank credits do not carry donor names;
 * receipts re-record the same gifts from several tabs. Each answers the
 * question it can answer.
 */

export interface BankTxnLike {
  /** `yyyy-MM-dd`. */
  postingDate: string;
  rowSeq: number;
  debit: number;
  credit: number;
  runningBalance: number;
  category: "interest" | "transfer" | "fee" | null;
}

export interface MonthRow {
  /** `yyyy-MM`. */
  month: string;
  /** 1..12, for labelling. */
  monthNumber: number;
  /** False when no statement covers the month: every figure is then null. */
  hasData: boolean;
  expenses: number | null;
  donation: number | null;
  net: number | null;
  /** expenses / donation, or null when there was no donation. */
  pctSpent: number | null;
  drivers: string;
}

export interface YearSummary {
  year: number;
  rows: MonthRow[];
  total: { expenses: number; donation: number; net: number; pctSpent: number | null; monthsWithData: number };
}

export interface CashInBank {
  amount: number;
  /** The posting date of the last imported statement line. */
  asOf: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Expenses = every debit, the bank's own withholding included -- money left
 * the account. Donation = every credit that is not the bank paying interest.
 * The sheet did the same, by hand; where its figures differ from these by a
 * few pesos, the hand slipped (its June and July left out two withholding
 * lines), and these are what the bank says.
 */
export function monthlySummary(txns: readonly BankTxnLike[], year: number, notes: Readonly<Record<string, string>>): YearSummary {
  const rows: MonthRow[] = [];
  const total = { expenses: 0, donation: 0, net: 0, pctSpent: null as number | null, monthsWithData: 0 };

  for (let m = 1; m <= 12; m++) {
    const month = `${year}-${String(m).padStart(2, "0")}`;
    let expenses = 0;
    let donation = 0;
    let hasData = false;
    for (const t of txns) {
      if (!t.postingDate.startsWith(month)) continue;
      hasData = true;
      expenses += t.debit;
      if (t.category !== "interest") donation += t.credit;
    }
    expenses = round2(expenses);
    donation = round2(donation);
    const net = round2(donation - expenses);
    const row: MonthRow = {
      month,
      monthNumber: m,
      hasData,
      expenses: hasData ? expenses : null,
      donation: hasData ? donation : null,
      net: hasData ? net : null,
      pctSpent: hasData && donation > 0 ? expenses / donation : null,
      drivers: notes[month] ?? "",
    };
    rows.push(row);
    if (hasData) {
      total.expenses = round2(total.expenses + expenses);
      total.donation = round2(total.donation + donation);
      total.net = round2(total.net + net);
      total.monthsWithData += 1;
    }
  }
  total.pctSpent = total.donation > 0 ? total.expenses / total.donation : null;
  return { year, rows, total };
}

/** The balance on the last line of the last statement, whichever year is
 * being looked at -- "cash in bank" is a fact about today, not about 2025. */
export function cashInBank(txns: readonly BankTxnLike[]): CashInBank | null {
  let last: BankTxnLike | null = null;
  for (const t of txns) {
    if (!last || t.postingDate > last.postingDate || (t.postingDate === last.postingDate && t.rowSeq > last.rowSeq)) last = t;
  }
  return last ? { amount: last.runningBalance, asOf: last.postingDate } : null;
}

/** The years a summary can be shown for, newest first; at least the current one. */
export function availableYears(txns: readonly BankTxnLike[], currentYear: number): number[] {
  const years = new Set<number>([currentYear]);
  for (const t of txns) years.add(Number(t.postingDate.slice(0, 4)));
  return [...years].sort((a, b) => b - a);
}

// ---------------------------------------------------------------------------
// Donor breakdown

export interface ReceiptLike {
  id: string;
  /** `yyyy-MM-dd` or null for the handful of rows with no date. */
  date: string | null;
  amount: number;
  direction: "inflow" | "outflow";
  donorName: string | null;
  /** Which sheet tab the row was imported from; null for rows keyed in-app. */
  sourceSheet: string | null;
  approvalStatus: string;
  duplicateOfId: string | null;
}

export interface DonorLine {
  id: string;
  date: string;
  donorName: string;
  amount: number;
  /** Rows folded into this one as re-records of the same gift. */
  duplicates: number;
}

/** Tabs that record gifts from the donor's side. The bank tab has no names
 * and the reimbursement tab is money going out; neither belongs here. */
const RECEIPT_SHEETS = new Set(["CASH", "BDO_CASH DONATIONS", "CASH+BDO_CASH DONATIONS"]);
const DUPLICATE_WINDOW_DAYS = 3;

function dayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function normalizeDonorName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Every donor-attributed receipt in the month, with re-records of the same
 * gift folded together.
 *
 * The CASH and BDO tabs both logged many of the same gifts -- Manny Chan's
 * ₱30,000 is on the 2nd in one and the 3rd in the other. Two receipts with
 * the same donor and the same amount within three days are one gift; the
 * earliest is kept, and on the same day the BDO line wins because it is the
 * one backed by a deposit slip. Rows the importer already marked as a
 * duplicate of another are folded regardless of dates.
 */
export function donorBreakdown(receipts: readonly ReceiptLike[], month: string): DonorLine[] {
  const inMonth = receipts.filter(
    (r) =>
      r.direction === "inflow" &&
      r.donorName &&
      r.donorName.trim() !== "" &&
      r.approvalStatus === "approved" &&
      r.date !== null &&
      r.date.startsWith(month) &&
      (r.sourceSheet === null || RECEIPT_SHEETS.has(r.sourceSheet))
  );

  const rank = (r: ReceiptLike) => (r.sourceSheet === "BDO_CASH DONATIONS" ? 0 : r.sourceSheet === "CASH+BDO_CASH DONATIONS" ? 1 : 2);
  const sorted = [...inMonth].sort((a, b) => a.date!.localeCompare(b.date!) || rank(a) - rank(b) || a.id.localeCompare(b.id));

  const keptById = new Map<string, DonorLine>();
  const lastKeptInGroup = new Map<string, { id: string; day: number }>();
  const lines: DonorLine[] = [];

  for (const r of sorted) {
    if (r.duplicateOfId && keptById.has(r.duplicateOfId)) {
      keptById.get(r.duplicateOfId)!.duplicates += 1;
      continue;
    }
    const group = `${normalizeDonorName(r.donorName!)}|${r.amount.toFixed(2)}`;
    const day = dayNumber(r.date!);
    const prev = lastKeptInGroup.get(group);
    if (prev && day - prev.day <= DUPLICATE_WINDOW_DAYS) {
      keptById.get(prev.id)!.duplicates += 1;
      continue;
    }
    const line: DonorLine = { id: r.id, date: r.date!, donorName: r.donorName!.trim(), amount: r.amount, duplicates: 0 };
    lines.push(line);
    keptById.set(r.id, line);
    lastKeptInGroup.set(group, { id: r.id, day });
  }

  return lines.sort((a, b) => b.amount - a.amount || a.date.localeCompare(b.date));
}

/** Months that have at least one donor-attributed receipt, newest first. */
export function monthsWithReceipts(receipts: readonly ReceiptLike[]): string[] {
  const months = new Set<string>();
  for (const r of receipts) {
    if (r.direction === "inflow" && r.donorName && r.date && (r.sourceSheet === null || RECEIPT_SHEETS.has(r.sourceSheet))) {
      months.add(r.date.slice(0, 7));
    }
  }
  return [...months].sort().reverse();
}
