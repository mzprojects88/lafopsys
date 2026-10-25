// The 2026 LAF Donation Tracker's tabs -> lines for the app (0110). Pure; the route fetches.
import { readCashRows, type CashLineInput, type SheetRead } from "./cash-gifts.ts";

/** "2026 LAF Donation Tracker" (the original; public link). */
export const TRACKER_SHEET_ID = "1JZUTyMou9iTVb8kotsEpzclRpXitJUWI9kk9Edt0DcI";
export const TRACKER_YEAR = 2026;

/** CASH tab: A date, C donor, H payment type, I amount, J invoice number, L notes (B time, D-F contact details are never read). */
export const CASH_COLS = { date: 0, donor: 2, method: 7, amount: 8, invoice: 9, notes: 11 } as const;
/** BDO_CASH DONATIONS tab: A date, B amount, C donor, D service invoice no., E/F deposit-slip links, H notes. */
const BDO_COLS = { date: 0, donor: 2, amount: 1, invoice: 3, notes: 7 } as const;

export function cashLinesFromTab(rows: readonly (readonly string[])[], today: string): SheetRead {
  return readCashRows(rows.slice(1), CASH_COLS, { firstRow: 2, kind: "cash", year: TRACKER_YEAR, today });
}

export interface DepositLine {
  sheet_row: number;
  date: string;
  donor_name: string;
  amount: number;
  invoice_number: string | null;
  slip_named: string | null;
  slip_anonymous: string | null;
  notes: string | null;
}

/** Deposits dated this year (the tab goes back to 2025; older deposits reconcile nothing the app holds). */
export function depositsFromTab(rows: readonly (readonly string[])[], today: string): { lines: DepositLine[]; problems: string[] } {
  const read = readCashRows(rows.slice(1), BDO_COLS, { firstRow: 2, kind: "cash", today });
  const lines: DepositLine[] = [];
  for (const l of read.lines) {
    if (!l.date.startsWith(`${TRACKER_YEAR}-`)) continue;
    const r = rows[l.sheet_row - 1] ?? [];
    const link = (c: number) => (r[c] ?? "").trim().slice(0, 500) || null;
    lines.push({ sheet_row: l.sheet_row, date: l.date, donor_name: l.donor_name, amount: l.amount, invoice_number: l.invoice_number, slip_named: link(4), slip_anonymous: link(5), notes: l.notes });
  }
  // Problems about other years are the tab's history, not today's typing.
  return { lines, problems: read.problems.filter((p) => !/not in \d{4}/.test(p)) };
}

export type { CashLineInput };
