import { parseCsv, parseDate } from "./bank-statement.ts";

/**
 * Reading the master calendar's Google Sheet, and working out what changed.
 *
 * Pure: no project imports beyond the CSV reader, no Date built in the local
 * zone, `today` passed in -- so the whole sync can be tested as functions
 * over arrays and app/api/calendar/sync/route.ts is left with only I/O.
 *
 * The sheet has no row ids. An event is identified by the day it is on, its
 * title (case- and whitespace-insensitive) and its time, with the time
 * normalised because the sheet's CSV export renders a cell as "3:00 PM" while
 * the earlier workbook import stored the same cell as "15:00". A title typo
 * corrected in the sheet therefore looks like a removal plus an addition;
 * that is inherent, and the sync log shows both.
 */

export const CALENDAR_SHEET_ID = "1krxg8BjkZgd0kSHlwm3w25Nq40MMW5DIzJC6gtgj5_g";
/** The list tab. The other tabs are scratch; the old month grids are gone. */
export const CALENDAR_SHEET_GID = "590670193";

/** The export endpoint, not gviz: gviz omits rows the sheet has hidden, and
 * the sheet hides everything in the past. */
export function sheetCsvUrl(id: string = CALENDAR_SHEET_ID, gid: string = CALENDAR_SHEET_GID): string {
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
}

/** Holiday names typed into "Officer on Duty"; not people. Mirrors scripts/clean-calendar-data.py. */
export const JUNK_OFFICERS = new Set(["NINOY AQUINO DAY", "NATIONAL HEROES DAY", "SAY NO"]);
export const HOLIDAY_TITLES = new Set(["maundy thursday", "good friday", "black saturday", "easter sunday"]);

// ---------------------------------------------------------------------------
// Normalisation

const CLOCK_12H = /^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(a\.?m\.?|p\.?m\.?|nn|mn)$/i;
const CLOCK_24H = /^(\d{1,2}):(\d{2})(?::\d{2})?$/;

/**
 * The comparable form of a time cell.
 *
 *   clock times  -> "HH:MM", 24-hour: "3:00 PM", "3:00:00 PM", "9 AM",
 *                   "12:00 NN" (noon), "12:00 MN" (midnight), "15:00", "9:00"
 *   anything else -> lower-cased, whitespace-collapsed text: ranges
 *                   ("3:00 PM - 5:00 PM", "1-5pm"), "All day", "TBD", "evening"
 *   blank, or the junk "SAY NO" -> ""
 *
 * The sheet's own text is what gets displayed; this is only for matching.
 */
export function normalizeTime(raw: string | null | undefined): string {
  if (!raw) return "";
  const s = raw.replace(/\s+/g, " ").trim();
  if (s === "" || s.toUpperCase() === "SAY NO") return "";

  let m = s.match(CLOCK_12H);
  if (m) {
    let hour = Number(m[1]);
    const minute = Number(m[2] ?? "0");
    const marker = m[3].replace(/\./g, "").toLowerCase();
    if (hour > 12 || minute > 59) return s.toLowerCase();
    if (marker === "nn") hour = 12;
    else if (marker === "mn") hour = 0;
    else if (marker === "am") hour = hour === 12 ? 0 : hour;
    else if (marker === "pm") hour = hour === 12 ? 12 : hour + 12;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  m = s.match(CLOCK_24H);
  if (m) {
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    if (hour <= 23 && minute <= 59) return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  return s.toLowerCase();
}

export function normalizeTitle(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().toLowerCase();
}

export function buildKey(date: string, title: string, timeKey: string): string {
  return `${date}|${normalizeTitle(title)}|${timeKey}`;
}

// ---------------------------------------------------------------------------
// The sheet

export interface SheetEvent {
  /** `yyyy-MM-dd`. */
  date: string;
  /** The sheet's own text, for display. Null when blank or junk. */
  time: string | null;
  title: string;
  venue: string | null;
  officerOnDuty: string | null;
  staffNeeded: string | null;
  bookedBy: string | null;
  contactInfo: string | null;
  remarks: string | null;
  isHoliday: boolean;
  timeKey: string;
  key: string;
  /** 1-based line in the CSV, for messages. */
  line: number;
}

export interface SheetParseResult {
  events: SheetEvent[];
  /** Rows whose key repeats an earlier row's; the first is kept. */
  duplicates: number;
  /** Rows that took their date from the row above. */
  forwardFilled: number;
  problems: string[];
}

const COLUMN_ALIASES: Record<string, string[]> = {
  date: ["date"],
  time: ["time"],
  title: ["event", "events", "activity"],
  venue: ["venue", "location"],
  officer: ["officer on duty", "officer", "ood"],
  staffNeeded: ["staff needed", "staff"],
  bookedBy: ["booked by", "booked"],
  contactInfo: ["contact name and number", "contact", "contact number"],
  remarks: ["remarks", "notes"],
};

function normHeader(h: string): string {
  return h.replace(/^﻿/, "").trim().toLowerCase().replace(/:$/, "").replace(/\s+/g, " ").trim();
}

function text(v: string | undefined): string | null {
  const s = (v ?? "").replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
}

/**
 * The sheet's list tab, as events. Columns are found by name (a moved column
 * must not silently break the sync); the weekday in column A is ignored.
 * Dates are written only on a day's first event and carried down. Rules for
 * junk officers and holidays are the cleaner's, so a row parses the same
 * whichever path it came in by.
 */
export function parseSheetCsv(csv: string): SheetParseResult {
  const grid = parseCsv(csv);
  const problems: string[] = [];
  if (grid.length === 0) return { events: [], duplicates: 0, forwardFilled: 0, problems: ["The sheet came back empty."] };

  const header = grid[0].map(normHeader);
  const col: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const idx = header.findIndex((h) => aliases.includes(h));
    if (idx >= 0) col[field] = idx;
  }
  const missing = ["date", "title"].filter((f) => col[f] === undefined);
  if (missing.length > 0) {
    return { events: [], duplicates: 0, forwardFilled: 0, problems: [`The sheet's header has no ${missing.join(" or ")} column; got: ${grid[0].join(" | ")}`] };
  }
  const cell = (row: string[], field: string) => (col[field] === undefined ? undefined : row[col[field]]);

  const events: SheetEvent[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  let forwardFilled = 0;
  let lastDate: string | null = null;
  let beforeAnyDate = 0;

  for (let i = 1; i < grid.length; i++) {
    const row = grid[i];
    const line = i + 1;
    const rawDate = text(cell(row, "date"));
    const title = text(cell(row, "title"));

    if (rawDate) {
      const parsed = parseDate(rawDate);
      if (parsed) lastDate = parsed;
      else if (title) problems.push(`Line ${line}: the date "${rawDate}" could not be read; the row was kept under the previous date.`);
    } else if (title) {
      forwardFilled += 1;
    }
    if (!title) continue;
    if (!lastDate) {
      beforeAnyDate += 1;
      continue;
    }

    const venue = text(cell(row, "venue"));
    let officer = text(cell(row, "officer"));
    const officerIsJunk = officer !== null && JUNK_OFFICERS.has(officer.toUpperCase());
    const isHoliday =
      (venue ?? "").toUpperCase() === "HOLIDAY" ||
      officerIsJunk ||
      title.toLowerCase().includes("holiday") ||
      HOLIDAY_TITLES.has(normalizeTitle(title));
    if (officerIsJunk) officer = null;

    const rawTime = text(cell(row, "time"));
    const time = rawTime && rawTime.toUpperCase() !== "SAY NO" ? rawTime : null;
    const timeKey = normalizeTime(time);
    const key = buildKey(lastDate, title, timeKey);
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);

    events.push({
      date: lastDate,
      time,
      title,
      venue,
      officerOnDuty: officer,
      staffNeeded: text(cell(row, "staffNeeded")),
      bookedBy: text(cell(row, "bookedBy")),
      contactInfo: text(cell(row, "contactInfo")),
      remarks: text(cell(row, "remarks")),
      isHoliday,
      timeKey,
      key,
      line,
    });
  }
  if (beforeAnyDate > 0) problems.push(`${beforeAnyDate} row(s) with an event but no date yet were skipped.`);

  return { events, duplicates, forwardFilled, problems };
}

// ---------------------------------------------------------------------------
// Reconciling with what the app holds

/** A sheet-sourced row as the app has it. `timeKey` is already coalesced by
 * the caller (`time_key ?? normalizeTime(time)`). */
export interface DbSheetRow {
  id: string;
  date: string;
  time: string | null;
  timeKey: string;
  title: string;
  venue: string | null;
  officerOnDuty: string | null;
  staffNeeded: string | null;
  bookedBy: string | null;
  contactInfo: string | null;
  remarks: string | null;
  isHoliday: boolean;
  sheetKey: string | null;
  sheetRemovedAt: string | null;
}

/** Column names are the database's: this is what gets written. */
export interface SheetRowPatch {
  time?: string | null;
  time_key?: string;
  title?: string;
  venue?: string | null;
  officer_on_duty?: string | null;
  staff_needed?: string | null;
  booked_by?: string | null;
  contact_info?: string | null;
  remarks?: string | null;
  is_holiday?: boolean;
  sheet_key?: string;
  sheet_synced_at: string;
  sheet_removed_at?: null;
  updated_by: null;
}

export interface NewSheetRow {
  date: string;
  time: string | null;
  time_key: string;
  title: string;
  venue: string | null;
  officer_on_duty: string | null;
  staff_needed: string | null;
  booked_by: string | null;
  contact_info: string | null;
  remarks: string | null;
  is_holiday: boolean;
  source: "sheet";
  sheet_key: string;
  sheet_synced_at: string;
  created_by: null;
  updated_by: null;
}

export interface ReconcileInput {
  sheet: readonly SheetEvent[];
  dbSheet: readonly DbSheetRow[];
  /** Keys of every app-created row, so the sheet can never overwrite one. */
  appKeys: ReadonlySet<string>;
  /** `yyyy-MM-dd`, Manila. */
  today: string;
  /** ISO instant stamped on everything touched. */
  now: string;
}

export interface ReconcileCounts {
  seen: number;
  inserted: number;
  updated: number;
  removed: number;
  restored: number;
  collisions: number;
}

export interface ReconcilePlan {
  inserts: NewSheetRow[];
  updates: { id: string; patch: SheetRowPatch }[];
  /** Ids to hide: upcoming, sheet-sourced, and gone from the sheet. */
  removes: string[];
  counts: ReconcileCounts;
}

/**
 * What to write so the app matches the sheet.
 *
 * The sheet is the master for today and what is to come; the app is the
 * archive of what has been. So an upcoming event missing from the sheet is
 * hidden (kept, restorable), a past one is left as it was, and a row the app
 * created is never touched -- if the sheet grows an identical key the sheet
 * row is skipped and counted as a collision.
 *
 * Matching is by full key first, then by date + title alone when exactly one
 * unmatched candidate remains -- the case of a time retyped in the sheet,
 * which must read as a change, not as a removal and an addition.
 */
export function reconcile(input: ReconcileInput): ReconcilePlan {
  const { sheet, dbSheet, appKeys, today, now } = input;
  const byKey = new Map<string, DbSheetRow>();
  const byDateTitle = new Map<string, DbSheetRow[]>();
  for (const row of dbSheet) {
    const key = row.sheetKey ?? buildKey(row.date, row.title, row.timeKey);
    if (!byKey.has(key)) byKey.set(key, row);
    const dt = `${row.date}|${normalizeTitle(row.title)}`;
    const list = byDateTitle.get(dt);
    if (list) list.push(row);
    else byDateTitle.set(dt, [row]);
  }

  const matched = new Set<string>();
  const plan: ReconcilePlan = { inserts: [], updates: [], removes: [], counts: { seen: sheet.length, inserted: 0, updated: 0, removed: 0, restored: 0, collisions: 0 } };

  for (const s of sheet) {
    if (appKeys.has(s.key)) {
      plan.counts.collisions += 1;
      continue;
    }
    let row = byKey.get(s.key);
    if (row && matched.has(row.id)) row = undefined;
    if (!row) {
      const candidates = (byDateTitle.get(`${s.date}|${normalizeTitle(s.title)}`) ?? []).filter((r) => !matched.has(r.id));
      if (candidates.length === 1) row = candidates[0];
    }

    if (!row) {
      plan.inserts.push({
        date: s.date,
        time: s.time,
        time_key: s.timeKey,
        title: s.title,
        venue: s.venue,
        officer_on_duty: s.officerOnDuty,
        staff_needed: s.staffNeeded,
        booked_by: s.bookedBy,
        contact_info: s.contactInfo,
        remarks: s.remarks,
        is_holiday: s.isHoliday,
        source: "sheet",
        sheet_key: s.key,
        sheet_synced_at: now,
        created_by: null,
        updated_by: null,
      });
      plan.counts.inserted += 1;
      continue;
    }

    matched.add(row.id);
    const patch: SheetRowPatch = { sheet_synced_at: now, updated_by: null };
    let changed = false;
    const set = <K extends keyof SheetRowPatch>(k: K, v: SheetRowPatch[K]) => {
      patch[k] = v;
      changed = true;
    };
    if ((row.time ?? null) !== s.time) set("time", s.time);
    if (row.title !== s.title) set("title", s.title);
    if ((row.venue ?? null) !== s.venue) set("venue", s.venue);
    if ((row.officerOnDuty ?? null) !== s.officerOnDuty) set("officer_on_duty", s.officerOnDuty);
    if ((row.staffNeeded ?? null) !== s.staffNeeded) set("staff_needed", s.staffNeeded);
    if ((row.bookedBy ?? null) !== s.bookedBy) set("booked_by", s.bookedBy);
    if ((row.contactInfo ?? null) !== s.contactInfo) set("contact_info", s.contactInfo);
    if ((row.remarks ?? null) !== s.remarks) set("remarks", s.remarks);
    if (row.isHoliday !== s.isHoliday) set("is_holiday", s.isHoliday);

    // Bookkeeping that does not count as a change to the event.
    let bookkeeping = false;
    if (row.sheetKey !== s.key) {
      patch.sheet_key = s.key;
      bookkeeping = true;
    }
    if (row.timeKey !== s.timeKey) {
      patch.time_key = s.timeKey;
      bookkeeping = true;
    }
    if (row.sheetRemovedAt !== null) {
      patch.sheet_removed_at = null;
      plan.counts.restored += 1;
      changed = true;
    }

    if (changed || bookkeeping) {
      plan.updates.push({ id: row.id, patch });
      if (changed) plan.counts.updated += 1;
    }
  }

  for (const row of dbSheet) {
    if (matched.has(row.id) || row.sheetRemovedAt !== null) continue;
    if (row.date >= today) {
      plan.removes.push(row.id);
      plan.counts.removed += 1;
    }
  }

  return plan;
}
