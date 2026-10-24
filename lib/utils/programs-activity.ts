/** One Activity Center session day at one site, as the LAF Programs sheet records it (0107). */
export interface SheetActivity {
  date: string;
  site: "NCH" | "LAF";
  participants: number;
  volunteers: number;
  hours: number;
  /** The sheet's time text ("1:00 PM - 3:00 PM"), kept as the facilitator note is free text. */
  time: string;
  sheetKey: string;
}

// Activity Center tab columns: A month, B week, C date, D time, E NCH names, F NCH # participants,
// G NCH hours, H NCH volunteers' names, I NCH # volunteers, J blank, K LAF names, L LAF # participants,
// M LAF # volunteers, N LAF volunteers' names. Only the counts are read; names stay on the sheet.
const COL = { date: 2, time: 3, nchPeople: 5, nchHours: 6, nchVolunteers: 8, lafPeople: 11, lafVolunteers: 12 } as const;

/** "3/30/2026" -> "2026-03-30" (as programs-care-cart's isoDate; copied so node --test can load this file alone). */
const isoDate = (s: string) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
  return m ? `${m[3]}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}` : null;
};

const num = (raw: string | undefined) => {
  const v = Number((raw ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(v) && v > 0 ? v : 0;
};

/** A tab (header row first) -> one session per dated row and site that has a participant count. */
export function activitySessions(rows: string[][]): SheetActivity[] {
  const out = new Map<string, SheetActivity>();
  for (const cells of rows.slice(1)) {
    const date = isoDate(cells[COL.date] ?? "");
    if (!date) continue;
    const time = (cells[COL.time] ?? "").trim();
    const sites: [SheetActivity["site"], number, number, number][] = [
      ["NCH", num(cells[COL.nchPeople]), num(cells[COL.nchVolunteers]), num(cells[COL.nchHours])],
      ["LAF", num(cells[COL.lafPeople]), num(cells[COL.lafVolunteers]), 0],
    ];
    for (const [site, participants, volunteers, hours] of sites) {
      if (!participants) continue;
      const sheetKey = `${date}|${site}`;
      if (out.has(sheetKey)) continue; // the first row for a day and site wins
      out.set(sheetKey, { date, site, participants, volunteers, hours, time, sheetKey });
    }
  }
  return [...out.values()];
}
