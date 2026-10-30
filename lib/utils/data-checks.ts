/**
 * The data checks (0122): what the Donation Tracker sync found that Accounting should look at.
 * Pure, so `node --test` runs it. Each finding has a stable key (the same problem seen on the next
 * read keeps its decision), a kind, a severity and the details the AI and the page show.
 */

export interface DataCheckFinding {
  key: string;
  kind: "unreadable_row" | "paper_missing" | "paper_nonnumeric" | "paper_reused" | "paper_skipped" | "statement_behind";
  severity: "error" | "warning" | "info";
  title: string;
  details: Record<string, unknown>;
}

export interface CashLineLike {
  sheet_row: number;
  date: string;
  amount: number;
  invoice_number: string | null;
}

/** A sheet problem as readCashRows words it: "Row 24: the date ... (Name, 5,528.30)". */
const PROBLEM_ROW = /^Row (\d+): (.*)$/;

/** Problems and lines from one tab, with the tab's label in the keys. */
export function checkCashTab(tab: string, lines: readonly CashLineLike[], problems: readonly string[]): DataCheckFinding[] {
  const out: DataCheckFinding[] = [];
  const slug = tab.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  for (const p of problems) {
    const m = PROBLEM_ROW.exec(p);
    // Rows dated another year are history on the same tab, not a typo to fix.
    if (!m || /not in \d{4}/.test(m[2]) && /\/20(1\d|2[0-5])\b/.test(m[2])) continue;
    // Never carry the donor's name into the finding: the text after the first parenthesis is theirs.
    const what = m[2].replace(/\s*\(.*$/, "");
    out.push({ key: `${slug}.unreadable:${m[1]}`, kind: "unreadable_row", severity: "error", title: `${tab} row ${m[1]}: ${what}`, details: { tab, row: Number(m[1]), problem: what } });
  }

  const lineKey = (l: CashLineLike) => `${l.date}|${l.amount.toFixed(2)}`;
  const byNumber = new Map<string, CashLineLike[]>();
  for (const l of lines) {
    const n = (l.invoice_number ?? "").trim();
    if (!n) {
      out.push({ key: `${slug}.paper_missing:${lineKey(l)}`, kind: "paper_missing", severity: "error", title: `${tab} row ${l.sheet_row}: no paper receipt number`, details: { tab, row: l.sheet_row, date: l.date, amount: l.amount } });
      continue;
    }
    if (!/^\d+$/.test(n)) {
      out.push({ key: `${slug}.paper_nonnumeric:${lineKey(l)}:${n}`, kind: "paper_nonnumeric", severity: "warning", title: `${tab} row ${l.sheet_row}: paper receipt number is "${n}"`, details: { tab, row: l.sheet_row, date: l.date, amount: l.amount, number: n } });
      continue;
    }
    const k = n.replace(/^0+(?=\d)/, "");
    if (!byNumber.has(k)) byNumber.set(k, []);
    byNumber.get(k)!.push(l);
  }
  for (const [n, rows] of byNumber) {
    if (rows.length < 2) continue;
    out.push({
      key: `${slug}.paper_reused:${n}`,
      kind: "paper_reused",
      severity: "warning",
      title: `${tab}: paper receipt ${rows[0]!.invoice_number} is on ${rows.length} rows`,
      details: { tab, number: rows[0]!.invoice_number, rows: rows.map((r) => ({ row: r.sheet_row, date: r.date, amount: r.amount })) },
    });
  }
  const nums = [...byNumber.keys()].map(Number).sort((a, b) => a - b);
  const width = Math.max(4, ...[...byNumber.values()].map((rows) => (rows[0]!.invoice_number ?? "").trim().length));
  const pad = (x: number) => String(x).padStart(width, "0");
  for (let i = 1; i < nums.length; i++) {
    const from = nums[i - 1]! + 1;
    const to = nums[i]! - 1;
    if (to < from) continue;
    out.push({
      key: `${slug}.paper_skipped:${pad(from)}-${pad(to)}`,
      kind: "paper_skipped",
      severity: "info",
      title: to === from ? `${tab}: paper receipt ${pad(from)} is on no row` : `${tab}: paper receipts ${pad(from)} to ${pad(to)} are on no row`,
      details: { tab, from: pad(from), to: pad(to), count: to - from + 1 },
    });
  }
  return out;
}

/** The statement's last line should reach the end of the last month that has ended. */
export function checkStatement(account: string, lastLine: string | null, today: string): DataCheckFinding[] {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const lastMonthEnd = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
  if (lastLine && lastLine >= lastMonthEnd.slice(0, 8) + "01") return [];
  return [
    {
      key: `bank.statement_behind:${account}`,
      kind: "statement_behind",
      severity: "warning",
      title: lastLine ? `${account}: the bank statement stops at ${lastLine}; ${lastMonthEnd.slice(0, 7)} has ended` : `${account}: no bank statement lines yet`,
      details: { account, lastLine, expectedThrough: lastMonthEnd },
    },
  ];
}
