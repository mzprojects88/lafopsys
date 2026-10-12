import type { Donor, DonorType, PaymentMethod } from "@/lib/types/donor";
import { parseAmount, parseDate } from "./bank-statement.ts";
import { donorNameKey, editDistance } from "./donor-details.ts";
import { formatDonorName, typeFromKeywords } from "./donor-format.ts";

/**
 * Cash gifts from accounting's sheets (0084). Gifts in kind are recorded in LAF Inventory and
 * nowhere else; cash stays on accounting's sheets, read into ops.cash_gift_lines. A donors editor
 * confirms each sheet NAME once; the database then posts that name's gifts. Pure: the page is
 * Donors > Cash gifts, the readers are LAF Inventory's /api/programs/tracker-sync (2026, hourly)
 * and scripts/import-cash-reports.mjs (the 2024 and 2025 reports, once).
 */
export type CashSource = "2024" | "2025" | "2025_noncash" | "2026";
export const CASH_SOURCE_LABEL: Record<CashSource, string> = {
  "2024": "2024 transaction report",
  "2025": "2025 transaction report",
  "2025_noncash": "2025 non-cash report",
  "2026": "2026 Donation Tracker",
};
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = { cash: "Cash", check: "Check", bank_transfer: "Bank transfer", gcash: "GCash", instapay: "InstaPay", other: "Other" };

export interface CashLine {
  source: CashSource;
  lineKey: string;
  sheetRow: number;
  date: string;
  donorName: string;
  nameKey: string;
  kind: "cash" | "in_kind";
  paymentMethod?: PaymentMethod;
  amount: number;
  invoiceNumber?: string;
  notes?: string;
}

/** The decision on a sheet name: a donor, or null for "not a donor". */
export interface SheetNameDecision {
  nameKey: string;
  donorId: string | null;
}

// ---------------------------------------------------------------------
// Reading a sheet's rows
// ---------------------------------------------------------------------

/** One line as ops.receive_cash_lines takes it. */
export interface CashLineInput {
  sheet_row: number;
  date: string;
  donor_name: string;
  kind: "cash" | "in_kind";
  payment_method: PaymentMethod | null;
  amount: number;
  invoice_number: string | null;
  notes: string | null;
}

const METHODS: [RegExp, PaymentMethod][] = [
  [/insta\s*pay/i, "instapay"],
  [/g\s*-?\s*cash/i, "gcash"],
  [/che(ck|que)/i, "check"],
  [/bank|transfer|deposit|online/i, "bank_transfer"],
  [/cash/i, "cash"],
];
/** The tracker's TYPE column: "BANK TRANSFER", "GCASH"... Anything else written there is "other". */
export function paymentMethodFrom(text: string | undefined): PaymentMethod | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  return METHODS.find(([re]) => re.test(t))?.[1] ?? "other";
}
/** A report's memo names the method only sometimes ("Check from Donor"); "Cash from Donor" just
 * means a cash donation, however it was paid, so it says nothing. */
export function paymentMethodFromMemo(memo: string): PaymentMethod | null {
  const m = METHODS.find(([re]) => re.test(memo))?.[1] ?? null;
  return m === "cash" ? null : m;
}

/** Proceeds and tests that sit among the 2025 cash rows: not gifts, so never read as gifts. */
export const NOT_A_GIFT = /\bsale\b|\bconversion\b|\btest\b/i;

const realDate = (iso: string | null) => (iso && !Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) && new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso ? iso : null);

export interface SheetRead {
  lines: CashLineInput[];
  /** Rows that look like a gift but can't be read, in words staff can act on. */
  problems: string[];
  /** Rows left out on purpose (sales, tests), for the report. */
  leftOut: string[];
}

/**
 * Rows of a sheet -> lines. `cols` says where each field is (0-based); a row needs a date or an
 * amount to count as a gift row at all (titles, totals and blank rows have neither in place).
 */
export function readCashRows(
  rows: readonly (readonly string[])[],
  cols: { date: number; donor: number; amount: number; method?: number; invoice?: number; notes?: number; memo?: number },
  opts: { firstRow: number; kind?: "cash" | "in_kind"; /** The sheet's year: a date outside it is a typing mistake ("7/30/3036"). */ year?: number; /** No gift is dated after this day. */ today?: string } = { firstRow: 2 },
): SheetRead {
  const out: SheetRead = { lines: [], problems: [], leftOut: [] };
  rows.forEach((r, i) => {
    const row = opts.firstRow + i;
    const cell = (c: number | undefined) => (c === undefined ? "" : (r[c] ?? "").replace(/\s+/g, " ").trim());
    const rawDate = cell(cols.date);
    const rawAmount = cell(cols.amount);
    const donor = cell(cols.donor);
    // Not a gift row: nothing date-like in the date column (a title, a total, a blank row).
    if (!/^\d[\d\s/.-]*$/.test(rawDate)) return;
    const date = realDate(parseDate(rawDate));
    const amount = parseAmount(rawAmount.replace(/^PHP\s*/i, ""));
    const memo = cell(cols.memo);
    if (NOT_A_GIFT.test(memo)) return void out.leftOut.push(`row ${row}: ${rawDate} ${donor || "(no name)"} ${rawAmount} "${memo}"`);
    if (!date) return void out.problems.push(`Row ${row}: the date "${rawDate}" can't be read (${donor || "no name"}, ${rawAmount || "no amount"}).`);
    if (opts.year && Number(date.slice(0, 4)) !== opts.year) return void out.problems.push(`Row ${row}: the date ${rawDate} is not in ${opts.year} (${donor || "no name"}, ${rawAmount || "no amount"}).`);
    if (opts.today && date > opts.today) return void out.problems.push(`Row ${row}: the date ${rawDate} has not come yet (${donor || "no name"}, ${rawAmount || "no amount"}).`);
    if (amount === null || !(amount > 0)) return void out.problems.push(`Row ${row}: no amount for ${donor || "this row"} on ${rawDate}.`);
    const kind = opts.kind ?? "cash";
    out.lines.push({
      sheet_row: row,
      date,
      donor_name: (donor || "Anonymous").slice(0, 200),
      kind,
      payment_method: kind !== "cash" ? null : cols.method === undefined ? paymentMethodFromMemo(memo) : paymentMethodFrom(cell(cols.method)),
      amount: Math.round(amount * 100) / 100,
      invoice_number: cell(cols.invoice).slice(0, 60) || null,
      notes: (cell(cols.notes) || memo).slice(0, 500) || null,
    });
  });
  return out;
}

// ---------------------------------------------------------------------
// Names to confirm
// ---------------------------------------------------------------------

/** A memo typed where the name goes: "BreadHouse QC support for LAF- February", "Reimbursement of expense...". */
const NOT_A_NAME = /\b(reimbursement|support for|for the month|payment for|expenses?)\b/i;
/** Name keys (words sorted, so "walk in" is "in walk") that mean nobody in particular. */
const ANONYMOUS_KEYS = new Set(["anonymous", "anon", "unknown", "in walk"]);

export interface NameToConfirm {
  nameKey: string;
  /** As most often written on the sheets. */
  sheetName: string;
  gifts: number;
  total: number;
  firstDate: string;
  lastDate: string;
  sources: CashSource[];
  /** Donors this could be: the same name first, then names one or two letters apart. */
  candidates: { donor: Donor; same: boolean }[];
  /** Other unconfirmed sheet names one or two letters apart ("Marko Tan" / "Marco Tan"). */
  lookAlikes: string[];
  /** What the rules propose: an existing donor, or a new one written the LAF way. */
  proposal: { donorId: string } | { name: string; salutation: string | null; type: DonorType };
  /** Who settled a new donor's type: a clear word in the name, the AI's hint, or the rules' default. */
  typedBy?: "keyword" | "ai" | "rule";
  /** Why a new name should be looked at before it is confirmed. */
  notes: string[];
  /** Safe to confirm with the others in one go: exactly one donor with this name, or a new, full name nothing resembles. */
  ready: boolean;
}

/** The AI's reading of a sheet name (ops.sheet_name_hints): a hint for the editor, never a decision. */
export interface SheetNameHint {
  nameKey: string;
  type: DonorType;
  /** Only a first name or a nickname. */
  incomplete: boolean;
}

/**
 * How a new donor would be written from a sheet name. The rules write the name (the AI once
 * re-spelled real names, 2026-10-08); the type comes from a clear word in the name, else the AI's
 * hint, else the rules' default (a person).
 */
export function newDonorFrom(sheetName: string, hint?: SheetNameHint): { name: string; salutation: string | null; type: DonorType; typedBy: "keyword" | "ai" | "rule"; incomplete: boolean } {
  const keyword = typeFromKeywords(sheetName);
  const type = keyword ?? hint?.type ?? formatDonorName(sheetName).suggestedType;
  const kind = type === "individual" || type === "anonymous" ? "person" : type === "government" ? "government" : "organisation";
  const f = formatDonorName(sheetName, kind);
  return { name: f.name, salutation: f.salutation, type, typedBy: keyword ? "keyword" : hint ? "ai" : "rule", incomplete: kind === "person" && (f.incomplete || !!hint?.incomplete) };
}

/** The sheet names no one has decided yet, each with what the rules propose; those needing a look first, then by value. */
export function namesToConfirm(lines: readonly CashLine[], donors: readonly Donor[], decided: readonly SheetNameDecision[], hints: readonly SheetNameHint[] = []): NameToConfirm[] {
  const done = new Set(decided.map((d) => d.nameKey));
  const hintOf = new Map(hints.map((h) => [h.nameKey, h]));
  const byKey = new Map<string, Donor[]>();
  for (const d of donors) {
    const k = donorNameKey(d.name);
    if (k) byKey.set(k, [...(byKey.get(k) ?? []), d]);
  }
  const anonymous = donors.find((d) => d.type === "anonymous");
  const longKeys = [...byKey.keys()].filter((k) => k.length >= 8);

  const groups = new Map<string, CashLine[]>();
  for (const l of lines) if (!done.has(l.nameKey)) groups.set(l.nameKey, [...(groups.get(l.nameKey) ?? []), l]);
  const pendingKeys = [...groups.keys()];

  const out: NameToConfirm[] = [];
  for (const [nameKey, ls] of groups) {
    const spellings = new Map<string, number>();
    for (const l of ls) spellings.set(l.donorName, (spellings.get(l.donorName) ?? 0) + 1);
    const sheetName = [...spellings].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];
    const same = (byKey.get(nameKey) ?? []).slice().sort((a, b) => b.giftCount - a.giftCount);
    const near = nameKey.length >= 8 ? longKeys.filter((k) => k !== nameKey && editDistance(k, nameKey) <= 2).flatMap((k) => byKey.get(k)!) : [];
    const lookAlikes = nameKey.length >= 8 ? pendingKeys.filter((k) => k !== nameKey && k.length >= 8 && editDistance(k, nameKey) <= 2).map((k) => groups.get(k)![0]!.donorName) : [];
    const isAnonymous = ANONYMOUS_KEYS.has(nameKey) && !!anonymous;
    const dates = ls.map((l) => l.date).sort();
    const existing = isAnonymous ? anonymous!.id : same[0]?.id;
    const fresh = existing ? null : newDonorFrom(sheetName, hintOf.get(nameKey));
    const notes: string[] = [];
    if (fresh?.incomplete) notes.push("Only a first name or nickname: write the full name if you know it.");
    if (fresh && (sheetName.split(" ").length > 6 || NOT_A_NAME.test(sheetName))) notes.push("This reads like a description, not a donor's name: shorten it to the donor.");
    out.push({
      nameKey,
      sheetName,
      gifts: ls.length,
      total: Math.round(ls.reduce((s, l) => s + l.amount, 0) * 100) / 100,
      firstDate: dates[0]!,
      lastDate: dates[dates.length - 1]!,
      sources: [...new Set(ls.map((l) => l.source))].sort(),
      candidates: isAnonymous ? [{ donor: anonymous!, same: true }] : [...same.map((donor) => ({ donor, same: true })), ...near.map((donor) => ({ donor, same: false }))],
      lookAlikes,
      proposal: existing ? { donorId: existing } : { name: fresh!.name, salutation: fresh!.salutation, type: fresh!.type },
      typedBy: fresh?.typedBy,
      notes,
      ready: isAnonymous || same.length === 1 || (same.length === 0 && near.length === 0 && lookAlikes.length === 0 && notes.length === 0),
    });
  }
  return out.sort((a, b) => Number(a.ready) - Number(b.ready) || b.total - a.total || a.sheetName.localeCompare(b.sheetName));
}

/** The tracker is read every hour; past this long without a read, it has stopped arriving. */
export const TRACKER_STALE_MS = 3 * 3_600_000;

export interface InvoiceMatch {
  donor: string;
  amount: number;
  date: string;
  where: "tracker" | "donor list";
}
/** "0328", " 328 " and "0328 " are one invoice number. */
const invoiceKey = (s: string | undefined) => (s ?? "").trim().toLowerCase().replace(/^0+(?=.)/, "");

/**
 * Where an invoice number is already recorded: on the sheets' lines, or on a cash gift in the
 * donor list that is not one of those lines. For the warning before a cash gift is typed by hand
 * (a gift on the tracker arrives by itself; typing it too would count it twice).
 */
export function invoiceMatches(
  invoice: string,
  lines: readonly CashLine[],
  gifts: readonly { donorId: string; date: string; kind: "cash" | "in_kind"; totalValue: number; invoiceNumber?: string }[],
  donorNames: ReadonlyMap<string, string>,
): InvoiceMatch[] {
  const key = invoiceKey(invoice);
  if (!key) return [];
  const onSheet = lines.filter((l) => invoiceKey(l.invoiceNumber) === key);
  const seen = new Set(onSheet.map((l) => `${l.date}|${l.amount}`));
  return [
    ...onSheet.map((l) => ({ donor: l.donorName, amount: l.amount, date: l.date, where: "tracker" as const })),
    ...gifts
      .filter((g) => g.kind === "cash" && invoiceKey(g.invoiceNumber) === key && !seen.has(`${g.date}|${g.totalValue}`))
      .map((g) => ({ donor: donorNames.get(g.donorId) ?? "a donor", amount: g.totalValue, date: g.date, where: "donor list" as const })),
  ];
}

export interface CashTally {
  gifts: number;
  total: number;
}
/** Per sheet: what is in the donor list, what waits for a name, what was left out as not a donor. */
export function cashProgress(lines: readonly CashLine[], decided: readonly SheetNameDecision[]): Record<CashSource, { posted: CashTally; waiting: CashTally; leftOut: CashTally }> {
  const decision = new Map(decided.map((d) => [d.nameKey, d.donorId]));
  const blank = () => ({ posted: { gifts: 0, total: 0 }, waiting: { gifts: 0, total: 0 }, leftOut: { gifts: 0, total: 0 } });
  const out = { "2024": blank(), "2025": blank(), "2025_noncash": blank(), "2026": blank() };
  for (const l of lines) {
    const bucket = !decision.has(l.nameKey) ? "waiting" : decision.get(l.nameKey) ? "posted" : "leftOut";
    out[l.source][bucket].gifts += 1;
    out[l.source][bucket].total += l.amount;
  }
  return out;
}

/** A donor's cash and in-kind totals, for the donor list and the donor file. */
export function givingSplit(donations: readonly { donorId: string; kind: "cash" | "in_kind"; totalValue: number }[]): Map<string, { cash: number; inKind: number }> {
  const out = new Map<string, { cash: number; inKind: number }>();
  for (const d of donations) {
    const t = out.get(d.donorId) ?? { cash: 0, inKind: 0 };
    if (d.kind === "cash") t.cash += d.totalValue;
    else t.inKind += d.totalValue;
    out.set(d.donorId, t);
  }
  return out;
}
