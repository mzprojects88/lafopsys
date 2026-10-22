/**
 * Care Cart from the LAF Programs sheet's "Care Cart" tab, worked out into runs and dishes for
 * the half-hourly sync (/api/programs/sheet-sync, 0103). Pure. Copied from LAF Inventory's
 * lib/utils/import-care-cart.ts (the 0043 import), which reads the same tab the same way.
 *
 * The tab has one row per dish: A month, B week, C date, D time, E dish,
 * F quantity + unit ("3 KG", "4 TRAYS (6X5)"), G cost per serving, H total,
 * I servings, J source, K volunteers (L, the volunteers' names, is never read).
 * Date and time cells are merged over a run's dish rows, so a blank one
 * carries the row above. A viand served with rice leaves its servings blank:
 * it feeds the rice's people, so it keeps its cost (servings = total / cost)
 * but adds no one to the run's count.
 */

export interface SheetRow {
  sheetRow: number;
  cells: string[]; // columns A-K
}

export interface ImportDish {
  dish: string;
  quantity: number | null;
  unit: string | null;
  servings: number;
  standardCost: number | null;
  sheetRow: number;
  countsPeople: boolean;
}

export interface ImportRun {
  runKey: string;
  date: string;
  timeSlot: string | null;
  servedCount: number;
  source: "laf_pantry" | "donation" | "sponsor";
  sponsor: string | null;
  volunteerCount: number;
  notes: string;
  sheetRows: number[];
  matchStatus: "new" | "exists" | "needs_review";
  reason: string | null;
  dishes: ImportDish[];
}

const num = (s: string) => {
  const t = s.replace(/[₱,\s]/g, "");
  return t && !Number.isNaN(Number(t)) ? Number(t) : null;
};

/** "9/24/2026" -> "2026-09-24". */
export function isoDate(s: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
  return m ? `${m[3]}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}` : null;
}

/** "10:00 AM" -> "10:00", "5:00 PM" -> "17:00", "12:00 NN" -> "12:00". */
export function slotOf(s: string): string | null {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM|NN)$/i.exec(s.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const ap = m[3]!.toUpperCase();
  if (ap === "PM" && h < 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

/** "3 KG" / "3KG" -> {3, "kg"}; "2 1/2 KG" -> {2.5, "kg"}; "4 TRAYS (6X5)" -> {4, "trays (6x5)"}. */
export function quantityOf(s: string): { quantity: number | null; unit: string | null } {
  const m = /^(\d+(?:[.,]\d+)?(?![\d/]))?(?:\s*(\d+)\/(\d+))?\s*(.*)$/.exec(s.trim());
  const whole = m?.[1] ? num(m[1]) : null;
  const frac = m?.[2] && m[3] && Number(m[3]) ? Number(m[2]) / Number(m[3]) : null;
  if (!m || (whole === null && frac === null)) return { quantity: null, unit: s.trim() ? s.trim().toLowerCase() : null };
  return { quantity: (whole ?? 0) + (frac ?? 0), unit: m[4]!.trim().toLowerCase().replace(/\s+/g, " ").replace(/\(\s*/g, "(") || null };
}

const FIXES: Record<string, string> = { CHAMPORAD0: "CHAMPORADO" };
/** "FOOD PACKS ( RICE, PORK ADOBO)" -> "Food Packs (Rice, Pork Adobo)". */
export function dishName(s: string): string {
  const t = s.trim().replace(/\s+/g, " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")");
  const fixed = FIXES[t.toUpperCase()] ?? t;
  return fixed.toLowerCase().replace(/(^|[\s(&,/-])([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase());
}

function sourceOf(s: string): { source: ImportRun["source"]; sponsor: string | null } {
  const t = s.trim().toUpperCase();
  if (t === "LAF PANTRY" || t === "") return { source: "laf_pantry", sponsor: null };
  if (t === "DONATION") return { source: "donation", sponsor: null };
  return { source: "sponsor", sponsor: s.trim() };
}

const SOURCE_LABEL = { laf_pantry: "LAF Pantry", donation: "Donation", sponsor: "Sponsor" };

/**
 * Rows -> runs. A run is consecutive rows with the same date and time once
 * merged cells are carried down; `existing` holds the app's runs as
 * "date|slot" so a run already recorded there is marked, not duplicated.
 */
export function runsFromSheet(rows: SheetRow[], existing: Set<string> = new Set()): { runs: ImportRun[]; skipped: number[] } {
  const runs: ImportRun[] = [];
  const skipped: number[] = [];
  let prevDate = "";
  let prevTime = "";
  let current: { date: string; time: string; rows: SheetRow[] } | null = null;
  const blocks: { date: string; time: string; rows: SheetRow[] }[] = [];

  for (const row of rows) {
    const c = row.cells;
    const rawDate = (c[2] ?? "").trim();
    const dish = (c[4] ?? "").trim();
    if (!rawDate && !dish) continue;
    const date = rawDate || prevDate;
    let time = (c[3] ?? "").trim();
    if (!time && date === prevDate) time = prevTime;
    if (!isoDate(date) || !dish) {
      skipped.push(row.sheetRow);
      continue;
    }
    if (!current || current.date !== date || current.time !== time) {
      current = { date, time, rows: [] };
      blocks.push(current);
    }
    current.rows.push(row);
    prevDate = date;
    prevTime = time;
  }

  for (const block of blocks) {
    const date = isoDate(block.date)!;
    const timeSlot = block.time ? slotOf(block.time) : null;
    const dishes: ImportDish[] = block.rows.map((row) => {
      const c = row.cells;
      const cost = num(c[6] ?? "");
      const total = num(c[7] ?? "");
      const given = num(c[8] ?? "");
      const { quantity, unit } = quantityOf(c[5] ?? "");
      return {
        dish: dishName(c[4]!),
        quantity,
        unit,
        servings: given ?? (cost && total ? Math.round(total / cost) : 0),
        standardCost: cost,
        sheetRow: row.sheetRow,
        countsPeople: given !== null,
      };
    });
    const sources = block.rows.map((r) => sourceOf(r.cells[9] ?? ""));
    const main = sources[0]!;
    const mixed = sources.some((s) => s.source !== main.source);
    const sheetRows = block.rows.map((r) => r.sheetRow);
    const notes = [
      `From the LAF Programs 2026 sheet, Care Cart tab, row${sheetRows.length > 1 ? `s ${sheetRows[0]}-${sheetRows[sheetRows.length - 1]}` : ` ${sheetRows[0]}`}.`,
      mixed ? `Sources: ${dishes.map((d, i) => `${d.dish} (${SOURCE_LABEL[sources[i]!.source]})`).join(", ")}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
    const exists = timeSlot !== null && existing.has(`${date}|${timeSlot}`);
    runs.push({
      runKey: `${date}|${timeSlot ?? "no-time"}|${sheetRows[0]}`,
      date,
      timeSlot,
      servedCount: dishes.filter((d) => d.countsPeople).reduce((s, d) => s + d.servings, 0),
      source: main.source,
      sponsor: main.sponsor,
      volunteerCount: Math.max(0, ...block.rows.map((r) => num(r.cells[10] ?? "") ?? 0)),
      notes,
      sheetRows,
      matchStatus: exists ? "exists" : timeSlot ? "new" : "needs_review",
      reason: exists ? "Already recorded in the app for this date and time" : timeSlot ? null : block.time ? `Time "${block.time}" not understood` : "No time in the sheet",
      dishes,
    });
  }
  return { runs, skipped };
}
