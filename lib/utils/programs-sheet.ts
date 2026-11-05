import { nameKey } from "./house-sheet.ts";

/**
 * The LAF Programs sheet's month tabs ("OCT 2026"), for the half-hourly sync (0103). Pure.
 *
 * One row per patient per day: A week, B day, C date ("Oct 1", no year; may be blank under a merged
 * cell, so it carries the row above), F patient, G carer, H BN, I/J/K breakfast / lunch / dinner as
 * people served (2 = patient + carer, 0 = none). L-N and N-L are rides, read per day (dailyRides). A tab's
 * totals row has three-figure numbers and no patient; anything above MAX_PER_ROW isn't a person.
 */
const MAX_PER_ROW = 6;
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** "OCT 2026" / "SEPT 2026" -> { month: 10, year: 2026 }; anything else -> null. */
export function monthTab(name: string): { month: number; year: number } | null {
  const m = /^([A-Za-z]{3,9})\.?\s+(\d{4})$/.exec(name.trim());
  const month = m ? MONTHS[m[1]!.slice(0, 3).toLowerCase()] : undefined;
  return m && month ? { month, year: Number(m[2]) } : null;
}

/** "Oct 1" in a 2026 tab -> "2026-10-01". */
export function monthDay(s: string, year: number): string | null {
  const m = /^([A-Za-z]+)\.?\s+(\d{1,2})$/.exec(s.trim());
  const month = m ? MONTHS[m[1]!.slice(0, 3).toLowerCase()] : undefined;
  if (!m || !month) return null;
  const day = Number(m[2]);
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCMonth() === month - 1 ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : null;
}

export interface PatientMeals {
  date: string;
  nameKey: string;
  patientName: string;
  carerName: string | null;
  bn: number | null;
  breakfast: number;
  lunch: number;
  dinner: number;
  sheetRow: number;
}

const people = (raw: string | undefined) => {
  const digits = (raw ?? "").replace(/[^\d]/g, "");
  const v = digits ? Number(digits) : 0;
  return v > MAX_PER_ROW ? null : v;
};

/** A month tab (header row first) -> one entry per patient per day; the first row wins on a repeat. */
export function patientMeals(rows: string[][], year: number): PatientMeals[] {
  const out = new Map<string, PatientMeals>();
  let date: string | null = null;
  rows.slice(1).forEach((cells, i) => {
    const rawDate = (cells[2] ?? "").trim();
    if (rawDate) date = monthDay(rawDate, year);
    const patientName = (cells[5] ?? "").trim();
    if (!date || !patientName) return;
    const [b, l, d] = [people(cells[8]), people(cells[9]), people(cells[10])];
    if (b === null || l === null || d === null) return; // a totals row
    const key = nameKey(patientName);
    if (!key || out.has(`${date}|${key}`)) return;
    out.set(`${date}|${key}`, {
      date,
      nameKey: key,
      patientName,
      carerName: (cells[6] ?? "").trim() || null,
      bn: people(cells[7]),
      breakfast: b,
      lunch: l,
      dinner: d,
      sheetRow: i + 2,
    });
  });
  return [...out.values()];
}

/** People riding per day (0131): L-N to NCH, N-L to LAF House. Rows without a child's name count, as they do on the
 * sheet's own Report. A totals row is left out by its size.
 * ponytail: a month whose total is still 6 or less can't be told from a ride row; the Report line shows it within days. */
export function dailyRides(rows: string[][], year: number): { date: string; toNch: number; toLaf: number }[] {
  const out = new Map<string, { date: string; toNch: number; toLaf: number }>();
  let date: string | null = null;
  for (const cells of rows.slice(1)) {
    const rawDate = (cells[2] ?? "").trim();
    if (rawDate) date = monthDay(rawDate, year);
    if (!date) continue;
    const [n, l] = [people(cells[11]), people(cells[12])];
    if (n === null || l === null) continue; // a totals row
    const day = out.get(date) ?? { date, toNch: 0, toLaf: 0 };
    day.toNch += n;
    day.toLaf += l;
    out.set(date, day);
  }
  return [...out.values()];
}

export const SHEET_MEALS = ["breakfast", "lunch", "dinner"] as const;

/** The kitchen's headcounts per day and meal, as the 0044 import counted them: a served row is one
 * patient, the rest of its number are carers. */
export function headcounts(rows: readonly PatientMeals[]): { date: string; mealType: (typeof SHEET_MEALS)[number]; patients: number; carers: number }[] {
  const acc = new Map<string, { date: string; mealType: (typeof SHEET_MEALS)[number]; patients: number; carers: number }>();
  for (const r of rows) {
    for (const meal of SHEET_MEALS) {
      const k = `${r.date}|${meal}`;
      const c = acc.get(k) ?? { date: r.date, mealType: meal, patients: 0, carers: 0 };
      if (r[meal] > 0) {
        c.patients += 1;
        c.carers += r[meal] - 1;
      }
      acc.set(k, c);
    }
  }
  return [...acc.values()];
}
