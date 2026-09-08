import { parseCsv } from "./bank-statement.ts";

/**
 * Reading the house's Occupancy Tracker (a Google Sheet workbook with ONE TAB
 * PER DAY, newest first, each a short roster of who is in the house that
 * day) and deciding which patient record each roster name is.
 *
 * Pure, like calendar-sheet.ts: no I/O, no Date in the local zone, so the
 * matching can be tested over arrays and the route keeps only fetch, read,
 * write and record.
 *
 * Three facts about the workbook, verified 2026-09-09 against the live sheet
 * (281 tabs, 12/3/25 .. 09/09/2026):
 *  - Tab names are dates in three shapes: "09/09/2026", "12/10/25", "12/3/25".
 *    The newest date, not the first tab, is "today's roster"; a reorder must
 *    not switch sheets. Tab gids change daily, so none is pinned.
 *  - Columns are found by header text ("Patient's Name", "Carer's Name",
 *    "Relationship to Patient", "Next Appointment", "Treatment", "Address");
 *    two columns carry no header: a flag whose value is "LAF" and a phone
 *    number. Those are recognised by their value.
 *  - Names are "Last, First" with the odd "First Last", any case, and the
 *    system's first_name often carries a middle name the sheet omits
 *    ("Carpio, Kieth Xander" is "Carpio, Kieth Xander Ero"). Matching is
 *    the cleaner's rule (scripts/clean-occupancy-data.py): exact last|first,
 *    else last|first-token when exactly one record fits. Anything looser
 *    is a shortlist for the model and a person to confirm.
 */

export const HOUSE_SHEET_ID = "1LJoX7R7FNwnM1g9LRT5IOoroV_oLqAcIZjHOFj4LiuQ";

export function houseSheetHtmlUrl(id: string = HOUSE_SHEET_ID): string {
  return `https://docs.google.com/spreadsheets/d/${id}/htmlview`;
}

export function houseSheetCsvUrl(gid: string, id: string = HOUSE_SHEET_ID): string {
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
}

// ---------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------

export interface SheetTab {
  name: string;
  gid: string;
  /** yyyy-MM-dd when the tab is named as a date; null otherwise. */
  date: string | null;
}

/** "09/09/2026", "12/10/25", "12/3/25", "09092026", "9-3-26" -> yyyy-MM-dd (M/D order, as the sheet writes it). */
export function parseTabDate(name: string): string | null {
  const s = name.trim();
  let m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/.exec(s);
  let month: number, day: number, year: number;
  if (m) {
    month = Number(m[1]);
    day = Number(m[2]);
    year = Number(m[3]);
  } else {
    m = /^(\d{8}|\d{6}|\d{5})$/.exec(s);
    if (!m) return null;
    const d = m[1];
    if (d.length === 8) [month, day, year] = [Number(d.slice(0, 2)), Number(d.slice(2, 4)), Number(d.slice(4))];
    else if (d.length === 6) [month, day, year] = [Number(d.slice(0, 2)), Number(d.slice(2, 4)), Number(d.slice(4))];
    else [month, day, year] = [Number(d.slice(0, 1)), Number(d.slice(1, 3)), Number(d.slice(3))];
  }
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2020 || year > 2100) return null;
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  // Reject Feb 30 and the like.
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return iso;
}

/**
 * The workbook's tabs from its /htmlview page, which embeds
 * `items.push({name: "...", pageUrl: "...", gid: "..."})` per tab. Newest
 * date first; undated tabs last in workbook order.
 */
export function parseTabList(html: string): SheetTab[] {
  const tabs: SheetTab[] = [];
  const re = /items\.push\(\{name:\s*"((?:[^"\\]|\\.)*)",\s*pageUrl:\s*"(?:[^"\\]|\\.)*",\s*gid:\s*"(\d+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    let name = m[1];
    try {
      name = JSON.parse(`"${m[1]}"`) as string;
    } catch {
      // keep the raw text
    }
    name = name.trim();
    tabs.push({ name, gid: m[2], date: parseTabDate(name) });
  }
  const dated = tabs.filter((t) => t.date !== null).sort((a, b) => (a.date! < b.date! ? 1 : a.date! > b.date! ? -1 : 0));
  const undated = tabs.filter((t) => t.date === null);
  return [...dated, ...undated];
}

// ---------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------

/** Letters and digits only, one space between words, lowercase, accents kept as typed (NFC). */
export function normalizeName(raw: string): string {
  return raw
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "Last, First" or "First Last" -> { first, last }. Mirrors clean-occupancy-data.py's split_name. */
export function splitName(fullName: string): { first: string; last: string } {
  const s = fullName.replace(/\s+/g, " ").trim();
  if (s.includes(",")) {
    const [last, first] = s.split(",", 2);
    return { first: (first ?? "").trim(), last: last.trim() };
  }
  const i = s.indexOf(" ");
  if (i > 0) return { first: s.slice(0, i).trim(), last: s.slice(i + 1).trim() };
  return { first: "", last: s };
}

/** The identity of a roster name across days: normalised last|first. */
export function nameKey(fullName: string): string {
  const { first, last } = splitName(fullName);
  return `${normalizeName(last)}|${normalizeName(first)}`;
}

// ---------------------------------------------------------------------
// One day's roster
// ---------------------------------------------------------------------

export interface RosterRow {
  rowNo: number | null;
  patientName: string;
  nameKey: string;
  carerName: string | null;
  relationship: string | null;
  nextAppointmentRaw: string | null;
  /** The first M/D/Y date found in the appointment text, yyyy-MM-dd; null when none. */
  nextAppointmentOn: string | null;
  treatment: string | null;
  address: string | null;
  lafFlag: boolean;
  phone: string | null;
}

export interface RosterParseResult {
  rows: RosterRow[];
  /** Names that appeared twice on the day; the first row wins. */
  duplicates: number;
  problems: string[];
}

const HEADER_TESTS: Record<string, (h: string) => boolean> = {
  rowNo: (h) => h === "#" || h === "no" || h === "no." || h === "count",
  patientName: (h) => /patient/.test(h) && /name/.test(h),
  carerName: (h) => /carer|guardian|watcher/.test(h) && /name/.test(h),
  relationship: (h) => /relationship/.test(h),
  nextAppointment: (h) => /appointment/.test(h),
  treatment: (h) => /treatment|procedure/.test(h),
  address: (h) => /address/.test(h),
};

function normHeader(h: string): string {
  return h.replace(/^﻿/, "").trim().toLowerCase().replace(/[:'’]/g, "").replace(/\s+/g, " ").trim();
}

function text(v: string | undefined): string | null {
  const s = (v ?? "").replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
}

/** The first M/D/YY or M/D/YYYY in free text (the sheet writes American order: "9/9/26 - 09/11/2026"). */
export function firstDateIn(raw: string | null): string | null {
  if (!raw) return null;
  const m = /(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/.exec(raw);
  if (!m) return null;
  return parseTabDate(`${m[1]}/${m[2]}/${m[3]}`);
}

const PHONE_RE = /^\+?[\d\s\-()]{7,20}$/;

/**
 * One day's tab as roster rows. The header row is the first row with a
 * "patient ... name" cell (a stray value typed above it is skipped). Blank
 * names are not people. The two unlabelled columns are read by value:
 * "LAF" (any case) sets the flag; a cell of seven or more digits is the phone.
 */
export function parseRosterCsv(csv: string): RosterParseResult {
  const grid = parseCsv(csv);
  const problems: string[] = [];
  const headerIdx = grid.findIndex((row) => row.some((c) => HEADER_TESTS.patientName(normHeader(c))));
  if (headerIdx < 0) {
    return { rows: [], duplicates: 0, problems: [`No "Patient's Name" column found; first row: ${(grid[0] ?? []).join(" | ")}`] };
  }
  const header = grid[headerIdx].map(normHeader);
  const col: Record<string, number> = {};
  for (const [field, test] of Object.entries(HEADER_TESTS)) {
    const idx = header.findIndex((h) => h !== "" && test(h));
    if (idx >= 0) col[field] = idx;
  }
  const labelled = new Set(Object.values(col));
  const cell = (row: string[], field: string) => (col[field] === undefined ? undefined : row[col[field]]);

  const rows: RosterRow[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  for (const row of grid.slice(headerIdx + 1)) {
    const patientName = text(cell(row, "patientName"));
    if (!patientName) continue;
    const key = nameKey(patientName);
    if (!key.replace("|", "")) continue;
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    let lafFlag = false;
    let phone: string | null = null;
    row.forEach((v, i) => {
      if (labelled.has(i)) return;
      const s = (v ?? "").trim();
      if (!s) return;
      if (s.toLowerCase() === "laf") lafFlag = true;
      else if (PHONE_RE.test(s) && s.replace(/\D/g, "").length >= 7) phone = s;
    });
    // The running number's header is usually blank: read the first small
    // integer to the left of the name when no "#" column was found.
    let rowNoText = text(cell(row, "rowNo"));
    if (rowNoText === null && col.rowNo === undefined) {
      rowNoText = row.slice(0, col.patientName).map((v) => (v ?? "").trim()).find((v) => /^\d{1,3}$/.test(v)) ?? null;
    }
    const rowNo = rowNoText && /^\d+$/.test(rowNoText) ? Number(rowNoText) : null;
    const nextAppointmentRaw = text(cell(row, "nextAppointment"));
    rows.push({
      rowNo,
      patientName,
      nameKey: key,
      carerName: text(cell(row, "carerName")),
      relationship: text(cell(row, "relationship")),
      nextAppointmentRaw,
      nextAppointmentOn: firstDateIn(nextAppointmentRaw),
      treatment: text(cell(row, "treatment")),
      address: text(cell(row, "address")),
      lafFlag,
      phone,
    });
  }
  return { rows, duplicates, problems };
}

// ---------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------

export interface PatientRef {
  id: string;
  patientNumber: string;
  firstName: string;
  lastName: string;
  birthDate: string | null;
  province: string | null;
  city: string | null;
  carerNames: string[];
}

export interface PatientIndex {
  exact: Map<string, string[]>;
  loose: Map<string, string[]>;
  byId: Map<string, PatientRef>;
}

export function indexPatients(patients: readonly PatientRef[]): PatientIndex {
  const exact = new Map<string, string[]>();
  const loose = new Map<string, string[]>();
  const byId = new Map<string, PatientRef>();
  const push = (m: Map<string, string[]>, k: string, id: string) => {
    const list = m.get(k);
    if (list) {
      if (!list.includes(id)) list.push(id);
    } else m.set(k, [id]);
  };
  for (const p of patients) {
    byId.set(p.id, p);
    const last = normalizeName(p.lastName);
    const first = normalizeName(p.firstName);
    push(exact, `${last}|${first}`, p.id);
    push(loose, `${last}|${first.split(" ")[0] ?? ""}`, p.id);
  }
  return { exact, loose, byId };
}

export type DeterministicMatch = { kind: "exact" | "loose"; patientId: string } | { kind: "candidates"; candidates: PatientRef[] };

/** Dice coefficient over character bigrams: 1 = same, 0 = nothing shared. */
export function similarity(a: string, b: string): number {
  const grams = (s: string) => {
    const t = ` ${s} `;
    const out = new Map<string, number>();
    for (let i = 0; i < t.length - 1; i++) {
      const g = t.slice(i, i + 2);
      out.set(g, (out.get(g) ?? 0) + 1);
    }
    return out;
  };
  const ga = grams(a);
  const gb = grams(b);
  let shared = 0;
  let na = 0;
  let nb = 0;
  for (const n of ga.values()) na += n;
  for (const n of gb.values()) nb += n;
  for (const [g, n] of ga) shared += Math.min(n, gb.get(g) ?? 0);
  return na + nb === 0 ? 0 : (2 * shared) / (na + nb);
}

export const SHORTLIST_MAX = 5;
export const SHORTLIST_MIN_SIMILARITY = 0.55;

/**
 * The cleaner's rule first (exact last|first, else last|first token when
 * exactly one record fits), then a shortlist for the model: the closest
 * names by similarity of the whole "last first" string, at most five, only
 * when reasonably close. Zero candidates means no model call.
 */
export function matchDeterministic(sheetName: string, index: PatientIndex): DeterministicMatch {
  const { first, last } = splitName(sheetName);
  const nl = normalizeName(last);
  const nf = normalizeName(first);
  if (nl) {
    const exact = index.exact.get(`${nl}|${nf}`);
    if (exact && exact.length === 1) return { kind: "exact", patientId: exact[0] };
    const token = nf.split(" ")[0] ?? "";
    const loose = index.loose.get(`${nl}|${token}`);
    if (loose && loose.length === 1) return { kind: "loose", patientId: loose[0] };
    // Also accept the reverse: the sheet wrote the full name and the record holds only the first token.
    if (nf.includes(" ")) {
      const reverse = index.exact.get(`${nl}|${token}`);
      if (reverse && reverse.length === 1) return { kind: "loose", patientId: reverse[0] };
    }
  }
  const target = `${nl} ${nf}`.trim();
  const scored: { p: PatientRef; score: number }[] = [];
  for (const p of index.byId.values()) {
    const s = similarity(target, `${normalizeName(p.lastName)} ${normalizeName(p.firstName)}`);
    if (s >= SHORTLIST_MIN_SIMILARITY) scored.push({ p, score: s });
  }
  scored.sort((a, b) => b.score - a.score);
  return { kind: "candidates", candidates: scored.slice(0, SHORTLIST_MAX).map((x) => x.p) };
}

// ---------------------------------------------------------------------
// Reconciling a day's roster with the stored rows (one per person)
// ---------------------------------------------------------------------

export interface DbSheetPerson {
  id: string;
  nameKey: string;
  patientName: string;
  carerName: string | null;
  relationship: string | null;
  nextAppointmentRaw: string | null;
  nextAppointmentOn: string | null;
  treatment: string | null;
  address: string | null;
  lafFlag: boolean;
  phone: string | null;
  firstSeenOn: string;
  lastSeenOn: string;
  daysSeen: number;
  /** Set while the person is not on the newest roster. */
  offSheetAt: string | null;
}

export interface NewSheetPerson {
  name_key: string;
  patient_name: string;
  carer_name: string | null;
  relationship: string | null;
  next_appointment_raw: string | null;
  next_appointment_on: string | null;
  treatment: string | null;
  address: string | null;
  laf_flag: boolean;
  phone: string | null;
  first_seen_on: string;
  last_seen_on: string;
  days_seen: number;
  off_sheet_at: null;
  row_no: number | null;
}

export interface SheetPersonPatch {
  patient_name?: string;
  carer_name?: string | null;
  relationship?: string | null;
  next_appointment_raw?: string | null;
  next_appointment_on?: string | null;
  treatment?: string | null;
  address?: string | null;
  laf_flag?: boolean;
  phone?: string | null;
  last_seen_on?: string;
  days_seen?: number;
  off_sheet_at?: string | null;
  row_no?: number | null;
}

export interface ReconcileRosterInput {
  /** The roster's day, yyyy-MM-dd. */
  tabDate: string;
  roster: readonly RosterRow[];
  db: readonly DbSheetPerson[];
  /** ISO instant. */
  now: string;
}

export interface ReconcileRosterPlan {
  inserts: NewSheetPerson[];
  updates: { id: string; patch: SheetPersonPatch }[];
  /** People stored but not on this roster: marked off-sheet (only when the roster is the newest day). */
  offSheet: string[];
  counts: { seen: number; inserted: number; updated: number; offSheet: number; returned: number };
}

/**
 * A person on the roster is stored once, keyed by name; each day they
 * appear extends last_seen_on and the day count, and the day's details
 * (carer, appointment, address...) replace the stored ones only when the
 * roster is on or after the stored last day. People who are stored but
 * not on the newest roster are marked off-sheet, never deleted -- their
 * match decision must survive a week away and a return.
 */
export function reconcileRoster(input: ReconcileRosterInput): ReconcileRosterPlan {
  const byKey = new Map(input.db.map((p) => [p.nameKey, p]));
  const inserts: NewSheetPerson[] = [];
  const updates: { id: string; patch: SheetPersonPatch }[] = [];
  const onRoster = new Set<string>();
  let updated = 0;
  let returned = 0;
  const newest = !input.db.some((p) => p.lastSeenOn > input.tabDate);

  for (const r of input.roster) {
    onRoster.add(r.nameKey);
    const existing = byKey.get(r.nameKey);
    if (!existing) {
      inserts.push({
        name_key: r.nameKey,
        patient_name: r.patientName,
        carer_name: r.carerName,
        relationship: r.relationship,
        next_appointment_raw: r.nextAppointmentRaw,
        next_appointment_on: r.nextAppointmentOn,
        treatment: r.treatment,
        address: r.address,
        laf_flag: r.lafFlag,
        phone: r.phone,
        first_seen_on: input.tabDate,
        last_seen_on: input.tabDate,
        days_seen: 1,
        off_sheet_at: null,
        row_no: r.rowNo,
      });
      continue;
    }
    const patch: SheetPersonPatch = {};
    const newDay = input.tabDate > existing.lastSeenOn;
    const sameDay = input.tabDate === existing.lastSeenOn;
    if (newDay) {
      patch.last_seen_on = input.tabDate;
      patch.days_seen = existing.daysSeen + 1;
    }
    if (newDay || sameDay) {
      const fields: [keyof SheetPersonPatch, unknown, unknown][] = [
        ["patient_name", existing.patientName, r.patientName],
        ["carer_name", existing.carerName, r.carerName],
        ["relationship", existing.relationship, r.relationship],
        ["next_appointment_raw", existing.nextAppointmentRaw, r.nextAppointmentRaw],
        ["next_appointment_on", existing.nextAppointmentOn, r.nextAppointmentOn],
        ["treatment", existing.treatment, r.treatment],
        ["address", existing.address, r.address],
        ["laf_flag", existing.lafFlag, r.lafFlag],
        ["phone", existing.phone, r.phone],
      ];
      for (const [k, before, after] of fields) {
        if (before !== after) (patch as Record<string, unknown>)[k] = after;
      }
      if (r.rowNo !== null) patch.row_no = r.rowNo;
      if (existing.offSheetAt !== null && (newest || newDay)) {
        patch.off_sheet_at = null;
        returned += 1;
      }
    }
    if (Object.keys(patch).length > 0) {
      updates.push({ id: existing.id, patch });
      if (Object.keys(patch).some((k) => !["last_seen_on", "days_seen", "row_no"].includes(k))) updated += 1;
    }
  }

  const offSheet: string[] = [];
  // An empty roster is a tab nobody has filled in, not an empty house.
  if (newest && input.roster.length > 0) {
    for (const p of input.db) {
      if (!onRoster.has(p.nameKey) && p.offSheetAt === null) offSheet.push(p.id);
    }
  }

  return {
    inserts,
    updates,
    offSheet,
    counts: { seen: input.roster.length, inserted: inserts.length, updated, offSheet: offSheet.length, returned },
  };
}
