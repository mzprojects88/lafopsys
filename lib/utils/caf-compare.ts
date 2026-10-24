// The LAF Programs sheet's CAF Record tab against the app's CAF bill (release 2 of 0103): compare only.
import { nameKey } from "./house-sheet.ts";
import { monthDay } from "./programs-sheet.ts";

/** One child's nights in one month as the CAF Record tab lists them. */
export interface SheetCafLine {
  nameKey: string;
  dates: string[];
}

/**
 * The CAF Record tab: blocks of four columns per month (PATIENT NAME, DATE, blank, blank), a name
 * row followed by one date per row until the next name. Block i is month i+1 of `year`. Names stay
 * in the result only as keys (never printed anywhere but the app).
 */
export function cafRecordLines(rows: string[][], year: number): Record<string, SheetCafLine[]> {
  const out: Record<string, SheetCafLine[]> = {};
  const width = Math.max(0, ...rows.map((r) => r.length));
  for (let block = 0; block * 4 + 1 < width && block < 12; block++) {
    const month = `${year}-${String(block + 1).padStart(2, "0")}`;
    const lines = new Map<string, SheetCafLine>();
    let current: SheetCafLine | null = null;
    for (const cells of rows.slice(1)) {
      const name = (cells[block * 4] ?? "").trim();
      if (name) {
        const key = nameKey(name);
        current = key ? (lines.get(key) ?? { nameKey: key, dates: [] }) : null;
        if (current) lines.set(key, current);
      }
      const date = monthDay((cells[block * 4 + 1] ?? "").trim(), year);
      if (current && date && date.startsWith(month) && !current.dates.includes(date)) current.dates.push(date);
    }
    out[month] = [...lines.values()].filter((l) => l.dates.length > 0);
  }
  return out;
}

export interface CafCompareRow {
  patientId: string;
  sheetOnly: string[];
  billOnly: string[];
  both: number;
}

/** Per child: the nights only the sheet has, only the bill has, and the ones both have. */
export function compareCaf(sheet: { patientId: string | null; dates: string[] }[], bill: { patientId: string; nights: string[] }[]): { rows: CafCompareRow[]; unmatched: number } {
  const bySheet = new Map<string, Set<string>>();
  let unmatched = 0;
  for (const s of sheet) {
    if (!s.patientId) {
      unmatched++;
      continue;
    }
    const set = bySheet.get(s.patientId) ?? new Set<string>();
    s.dates.forEach((d) => set.add(d));
    bySheet.set(s.patientId, set);
  }
  const ids = new Set([...bySheet.keys(), ...bill.map((b) => b.patientId)]);
  const rows = [...ids].map((patientId) => {
    const s = bySheet.get(patientId) ?? new Set<string>();
    const b = new Set(bill.find((x) => x.patientId === patientId)?.nights ?? []);
    return {
      patientId,
      sheetOnly: [...s].filter((d) => !b.has(d)).sort(),
      billOnly: [...b].filter((d) => !s.has(d)).sort(),
      both: [...s].filter((d) => b.has(d)).length,
    };
  });
  return { rows, unmatched };
}
