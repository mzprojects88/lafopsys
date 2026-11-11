/**
 * The voucher registers (PV, PCV and GCash tabs of the 2026 Payment Voucher workbook, Aug-Oct) read into
 * ArkOS's voucher records (0134 history columns): pure, so the import script and its test share it. Nothing here
 * is guessed silently: what doesn't fit the chart, the funds or the register's own totals is flagged for Finance
 * to clean up, with the reason.
 */
export type HistoryType = "PV" | "PCV" | "GCV";
export type CleanupReason = "no_fund" | "unknown_code" | "name_differs" | "duplicate_number" | "total_differs" | "unknown_status" | "no_date";

export interface HistoryContext {
  /** The chart's accounts by code (5204 has two). */
  accountsByCode: ReadonlyMap<string, readonly { id: string; name: string }[]>;
  /** The cost center and program an account's spending counts under (52xx -> Program:Housing ... else Admin). */
  classOf: (code: string) => { t1: string; t3: string | null };
  /** The donor fund (T2) a register's "Type of Funding" means, or null. */
  fundOf: (label: string) => string | null;
  /** A staff member by the name the register gives, matched by rule only (full name, or a first name only one has). */
  staffOf: (name: string) => string | null;
}
export interface HistoryLine {
  sort: number;
  description: string;
  qty: number;
  unitCost: number;
  amount: number;
  orNumber: string | null;
  accountId: string | null;
  t1Id: string | null;
  t3Id: string | null;
  legacyCode: string | null;
  legacyAccountName: string | null;
}
export interface HistorySigner {
  action: "prepare" | "review" | "approve";
  staffId: string | null;
  text: string;
}
export interface HistoryVoucher {
  /** Stable across runs: type, number and which occurrence of the number in its register. */
  key: string;
  type: HistoryType;
  number: string;
  date: string | null;
  payee: string | null;
  purpose: string;
  fundId: string | null;
  total: number;
  link: string | null;
  status: "prepared" | "approved" | "cancelled";
  paidOn: string | null;
  signers: HistorySigner[];
  lines: HistoryLine[];
  reasons: CleanupReason[];
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-08-02", "8/2/2026" (month first, as the sheet writes it) or "Aug 2, 2026" -> "2026-08-02"; null otherwise. */
export function parseDay(raw: string): string | null {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${pad(+m[1])}-${pad(+m[2])}`;
  m = /^([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})$/.exec(s);
  if (m && MONTHS.includes(m[1].toLowerCase())) return `${m[3]}-${pad(MONTHS.indexOf(m[1].toLowerCase()) + 1)}-${pad(+m[2])}`;
  return null;
}

/** "₱1,234.50", "1234.5", "(250)" -> a number; blank or unreadable -> null. */
export function parseMoney(raw: string): number | null {
  const s = raw.replace(/[₱,\s]/g, "").replace(/^PHP/i, "");
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s);
  const n = Number(s.replace(/[()]/g, ""));
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

const same = (a: string, b: string) => a.trim().toLowerCase().replace(/\s+/g, " ") === b.trim().toLowerCase().replace(/\s+/g, " ");

/** Column index by header (case-insensitive); the first header that contains `name` when no exact match. */
function columns(header: readonly string[]) {
  const h = header.map((x) => x.trim().toLowerCase());
  return (name: string) => {
    const exact = h.indexOf(name.toLowerCase());
    return exact >= 0 ? exact : h.findIndex((x) => x.includes(name.toLowerCase()));
  };
}

/** One account for a code: the only one, or among several (5204) the one whose name the register gives. */
function accountFor(ctx: HistoryContext, code: string, name: string) {
  const all = ctx.accountsByCode.get(code) ?? [];
  return all.length === 1 ? all[0] : (all.find((a) => same(a.name, name)) ?? null);
}

/**
 * Reads one register (with its detail tab, the first row of each being the header) into vouchers. Rows without
 * a voucher number are skipped and counted. A number that repeats in the register keeps every row (each its own
 * key) and is flagged; its details go to its first row.
 */
export function readHistory(type: HistoryType, register: readonly string[][], details: readonly string[][], ctx: HistoryContext): { vouchers: HistoryVoucher[]; skipped: number; orphanDetails: number } {
  const rc = columns(register[0] ?? []);
  const dc = columns(details[0] ?? []);
  const col = { no: rc("voucher no"), date: rc("date"), payee: rc("payee"), purpose: rc("purpose"), code: rc("coa #"), account: rc("account"), fund: rc("type of funding"),
    prepared: rc("prepared by"), reviewed: rc("reviewed"), approved: rc("approved by"), link: rc("supporting documents"), status: rc("status"), paid: rc("date paid"), total: rc("total amount") };
  const dcol = { no: dc("voucher no"), text: dc("particulars"), code: dc("coa code"), account: dc("account name"), ref: dc("reference"), qty: dc("qty"), unit: dc("unit cost"), amount: dc("amount") };
  const get = (row: readonly string[], i: number) => (i >= 0 ? (row[i] ?? "").trim() : "");

  const detailsOf = new Map<string, string[][]>();
  for (const d of details.slice(1)) {
    const no = get(d, dcol.no);
    if (no) detailsOf.set(no, [...(detailsOf.get(no) ?? []), [...d]]);
  }
  const seen = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const r of register.slice(1)) {
    const no = get(r, col.no);
    if (no) counts.set(no, (counts.get(no) ?? 0) + 1);
  }

  let skipped = 0;
  const vouchers: HistoryVoucher[] = [];
  for (const r of register.slice(1)) {
    const number = get(r, col.no);
    if (!number) {
      skipped++;
      continue;
    }
    const occ = (seen.get(number) ?? 0) + 1;
    seen.set(number, occ);
    const reasons = new Set<CleanupReason>();
    if ((counts.get(number) ?? 0) > 1) reasons.add("duplicate_number");
    const date = parseDay(get(r, col.date));
    if (!date) reasons.add("no_date");
    const fundLabel = get(r, col.fund);
    const fundId = fundLabel ? ctx.fundOf(fundLabel) : null;
    if (!fundId) reasons.add("no_fund");
    const purpose = (get(r, col.purpose) || "(no purpose in the register)").slice(0, 500);
    const registerTotal = parseMoney(get(r, col.total)) ?? 0;

    const line = (sort: number, description: string, code: string, name: string, qty: number, unit: number, amount: number, ref: string | null): HistoryLine => {
      const account = code ? accountFor(ctx, code, name) : null;
      if (!account) reasons.add("unknown_code");
      else if (name && !same(account.name, name)) reasons.add("name_differs");
      const cls = account ? ctx.classOf(code) : null;
      return { sort, description: description.slice(0, 300) || purpose.slice(0, 300), qty, unitCost: unit, amount, orNumber: ref ? ref.slice(0, 60) : null,
        accountId: account?.id ?? null, t1Id: cls?.t1 ?? null, t3Id: cls?.t3 ?? null, legacyCode: code ? code.slice(0, 20) : null, legacyAccountName: name ? name.slice(0, 200) : null };
    };
    const rows = occ === 1 ? (detailsOf.get(number) ?? []) : [];
    const lines = rows.length
      ? rows.map((d, i) => {
          const qty = parseMoney(get(d, dcol.qty)) || 1;
          const amount = parseMoney(get(d, dcol.amount)) ?? qty * (parseMoney(get(d, dcol.unit)) ?? 0);
          const unit = parseMoney(get(d, dcol.unit)) ?? Math.round((amount / qty) * 100) / 100;
          return line(i + 1, get(d, dcol.text), get(d, dcol.code), get(d, dcol.account), qty, unit, Math.round(amount * 100) / 100, get(d, dcol.ref) || null);
        })
      : [line(1, purpose, get(r, col.code), get(r, col.account), 1, registerTotal, registerTotal, null)];
    const total = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
    if (Math.abs(total - registerTotal) > 0.01) reasons.add("total_differs");

    const signers: HistorySigner[] = [];
    for (const [action, i] of [["prepare", col.prepared], ["review", col.reviewed], ["approve", col.approved]] as const) {
      const text = get(r, i);
      if (text) signers.push({ action, staffId: ctx.staffOf(text), text: text.slice(0, 120) });
    }
    const statusText = get(r, col.status).toLowerCase();
    const paidOn = statusText === "paid" ? (parseDay(get(r, col.paid)) ?? date) : null;
    let status: HistoryVoucher["status"];
    if (statusText === "paid" || (!statusText && signers.some((s) => s.action === "approve"))) status = "approved";
    else if (/^(cancel|void)/.test(statusText)) status = "cancelled";
    else {
      status = "prepared";
      if (statusText) reasons.add("unknown_status");
    }

    vouchers.push({ key: `${type}:${number}:${occ}`, type, number, date, payee: get(r, col.payee).slice(0, 200) || null, purpose, fundId, total, link: get(r, col.link).slice(0, 500) || null,
      status, paidOn, signers, lines, reasons: [...reasons] });
  }
  // Detail rows whose number the register doesn't have: reported, not guessed into a voucher.
  const orphanDetails = [...detailsOf].filter(([no]) => !counts.has(no)).reduce((s, [, rows]) => s + rows.length, 0);
  return { vouchers, skipped, orphanDetails };
}
