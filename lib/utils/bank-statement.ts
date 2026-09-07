/**
 * Reading a bank statement export, and checking that it hangs together.
 *
 * Pure: no project imports, no Date built in the local zone, so it runs the
 * same under `node --test`, in the browser preview, and in the server action
 * that commits the rows. The upload page parses with this to show a preview;
 * the action re-derives everything from the same raw rows before writing,
 * so the browser is never trusted with the numbers.
 */

export interface BankRow {
  /** 1-based position in the file -- the bank's only same-day ordering. */
  rowSeq: number;
  /** `yyyy-MM-dd`. */
  postingDate: string;
  branch: string | null;
  description: string;
  debit: number;
  credit: number;
  runningBalance: number;
  checkNumber: string | null;
  memo: string | null;
}

export type BankCategory = "interest" | "transfer" | "fee";

export interface ParseProblem {
  line: number;
  message: string;
}

export interface ParseResult {
  rows: BankRow[];
  problems: ParseProblem[];
}

// ---------------------------------------------------------------------------
// CSV

/** RFC 4180: quoted fields may contain commas, newlines and doubled quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^﻿/, "");

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// ---------------------------------------------------------------------------
// Cells

const HEADER_ALIASES: Record<keyof Omit<BankRow, "rowSeq">, string[]> = {
  postingDate: ["posting date", "date", "transaction date", "posted"],
  branch: ["branch"],
  description: ["description", "details", "particulars", "transaction description"],
  debit: ["debit", "withdrawal", "withdrawals", "debit amount"],
  credit: ["credit", "deposit", "deposits", "credit amount"],
  runningBalance: ["running balance", "balance", "ending balance"],
  checkNumber: ["check number", "cheque number", "check no", "check no."],
  memo: ["memo", "notes", "note", "remarks", "payee"],
};

function normHeader(h: string): string {
  return h.replace(/^﻿/, "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Maps header names to column indexes, tolerant of order and case. The
 * unlabelled eighth column of the foundation's own export is taken as memo. */
export function mapHeaders(header: string[]): Partial<Record<keyof Omit<BankRow, "rowSeq">, number>> {
  const map: Partial<Record<keyof Omit<BankRow, "rowSeq">, number>> = {};
  header.forEach((raw, i) => {
    const h = normHeader(raw);
    for (const [key, aliases] of Object.entries(HEADER_ALIASES) as [keyof Omit<BankRow, "rowSeq">, string[]][]) {
      if (map[key] === undefined && aliases.includes(h)) map[key] = i;
    }
  });
  if (map.memo === undefined && map.checkNumber !== undefined && header.length > map.checkNumber + 1) {
    const idx = map.checkNumber + 1;
    if (normHeader(header[idx] ?? "") === "") map.memo = idx;
  }
  return map;
}

/** `₱1,234.50`, `(500.00)`, `1 234,50` are all money. Returns null for blank. */
export function parseAmount(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  let s = raw.trim();
  if (s === "" || s === "-") return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  s = s.replace(/[₱$€£\s]/g, "").replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Math.round(Number(s) * 100) / 100;
  return negative ? -n : n;
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", sept: "09", oct: "10", nov: "11", dec: "12",
};

/** `2026-01-02`, `1/2/2026`, `01/02/2026`, `02-Jan-2026`, `Jan 2, 2026` -> `2026-01-02`.
 * Slash dates are read month-first, which is what BDO's export uses. */
export function parseDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})-([A-Za-z]{3,4})-(\d{4})$/);
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, "0")}`;
  m = s.match(/^([A-Za-z]{3,4})\.? (\d{1,2}), (\d{4})$/);
  if (m && MONTHS[m[1].toLowerCase()]) return `${m[3]}-${MONTHS[m[1].toLowerCase()]}-${m[2].padStart(2, "0")}`;
  return null;
}

// ---------------------------------------------------------------------------
// Whole file

export function parseBankCsv(text: string): ParseResult {
  const grid = parseCsv(text);
  const problems: ParseProblem[] = [];
  if (grid.length === 0) return { rows: [], problems: [{ line: 1, message: "The file is empty." }] };

  const map = mapHeaders(grid[0]);
  const missing = (["postingDate", "description", "runningBalance"] as const).filter((k) => map[k] === undefined);
  if (missing.length > 0 || (map.debit === undefined && map.credit === undefined)) {
    return {
      rows: [],
      problems: [{ line: 1, message: `Could not find the columns ${[...missing, ...(map.debit === undefined && map.credit === undefined ? ["debit/credit"] : [])].join(", ")} in the header.` }],
    };
  }

  const cell = (r: string[], key: keyof Omit<BankRow, "rowSeq">) => (map[key] === undefined ? undefined : r[map[key] as number]);
  const rows: BankRow[] = [];
  let seq = 0;

  for (let i = 1; i < grid.length; i++) {
    const r = grid[i];
    const line = i + 1;
    const rawDate = cell(r, "postingDate");
    // Some exports repeat the header partway down.
    if (normHeader(rawDate ?? "") === normHeader(grid[0][map.postingDate as number] ?? "")) continue;

    const postingDate = parseDate(rawDate);
    const balance = parseAmount(cell(r, "runningBalance"));
    const description = (cell(r, "description") ?? "").trim();
    if (!postingDate && balance === null && description === "") continue;

    if (!postingDate) {
      problems.push({ line, message: `Line ${line}: the date "${rawDate ?? ""}" could not be read.` });
      continue;
    }
    if (balance === null) {
      problems.push({ line, message: `Line ${line}: no running balance.` });
      continue;
    }

    let debit = parseAmount(cell(r, "debit")) ?? 0;
    let credit = parseAmount(cell(r, "credit")) ?? 0;
    // A negative in either column is the other column.
    if (debit < 0) {
      credit += -debit;
      debit = 0;
    }
    if (credit < 0) {
      debit += -credit;
      credit = 0;
    }

    seq += 1;
    const check = (cell(r, "checkNumber") ?? "").trim();
    rows.push({
      rowSeq: seq,
      postingDate,
      branch: (cell(r, "branch") ?? "").trim() || null,
      description: description || "(no description)",
      debit: Math.round(debit * 100) / 100,
      credit: Math.round(credit * 100) / 100,
      runningBalance: balance,
      checkNumber: check === "" || /^0(\.0+)?$/.test(check) ? null : check,
      memo: (cell(r, "memo") ?? "").trim() || null,
    });
  }
  return { rows, problems };
}

// ---------------------------------------------------------------------------
// Meaning

/** The bank's own credits and charges, which are not donations or spending
 * in the sense the summary means. "INTEREST WITHHELD" is a debit -- the
 * withholding tax on interest -- and is tagged the same way so a later rule
 * can treat both sides together. */
export function categorize(description: string): BankCategory | null {
  const d = description.toUpperCase();
  if (d.includes("INTEREST")) return "interest";
  if (/(SERVICE|SVC|BANK) (CHARGE|FEE)|MAINTAINING BALANCE|\bSC FEE\b/.test(d)) return "fee";
  return null;
}

/** The unique constraint on ops.bank_transactions, as a string. */
export function naturalKey(row: Pick<BankRow, "postingDate" | "description" | "debit" | "credit" | "runningBalance">, accountId: string): string {
  return [accountId, row.postingDate, row.description, row.debit.toFixed(2), row.credit.toFixed(2), row.runningBalance.toFixed(2)].join("|");
}

export interface ContinuityWarning {
  postingDate: string;
  expected: number;
  actual: number;
  message: string;
}

/**
 * Does each day's closing balance follow from the previous day's plus that
 * day's credits minus its debits? Checked PER DAY rather than per line: the
 * bank posts a day's lines in an order of its own (an interest payment and
 * the tax withheld on it arrive swapped, reversal pairs interleave), so a
 * per-line check cries wolf eight times on a statement that is perfectly
 * consistent by the end of each day.
 *
 * `openingBalance` is the last stored balance before this batch, when known.
 */
export function checkContinuity(rows: readonly BankRow[], openingBalance?: number | null): ContinuityWarning[] {
  const sorted = [...rows].sort((a, b) => a.postingDate.localeCompare(b.postingDate) || a.rowSeq - b.rowSeq);
  const warnings: ContinuityWarning[] = [];
  let carried: number | null = openingBalance ?? null;

  let i = 0;
  while (i < sorted.length) {
    const day = sorted[i].postingDate;
    let debits = 0;
    let credits = 0;
    const balances: number[] = [];
    while (i < sorted.length && sorted[i].postingDate === day) {
      debits += sorted[i].debit;
      credits += sorted[i].credit;
      balances.push(sorted[i].runningBalance);
      i++;
    }
    const printedLast = balances[balances.length - 1];
    if (carried === null) {
      carried = printedLast;
      continue;
    }
    const expected = Math.round((carried + credits - debits) * 100) / 100;
    // The day's true closing line is whichever one carries the expected
    // balance -- not necessarily the one the bank printed last.
    const closes = balances.some((b) => Math.abs(b - expected) <= 0.01);
    if (closes) {
      carried = expected;
    } else {
      warnings.push({
        postingDate: day,
        expected,
        actual: printedLast,
        message: `${day}: the balance should end at ${expected.toFixed(2)} but the statement says ${printedLast.toFixed(2)}.`,
      });
      carried = printedLast;
    }
  }
  return warnings;
}

export interface BatchSummary {
  coversFrom: string;
  coversTo: string;
  /** What the balance was before the first line, implied by that line. */
  impliedOpening: number;
  closing: number;
  totalDebits: number;
  totalCredits: number;
}

export function summarizeBatch(rows: readonly BankRow[]): BatchSummary | null {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => a.postingDate.localeCompare(b.postingDate) || a.rowSeq - b.rowSeq);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  return {
    coversFrom: first.postingDate,
    coversTo: last.postingDate,
    impliedOpening: Math.round((first.runningBalance - first.credit + first.debit) * 100) / 100,
    closing: last.runningBalance,
    totalDebits: Math.round(sorted.reduce((s, r) => s + r.debit, 0) * 100) / 100,
    totalCredits: Math.round(sorted.reduce((s, r) => s + r.credit, 0) * 100) / 100,
  };
}
