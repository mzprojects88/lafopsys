/**
 * The printed DTR (DTR plan phase 5): one line per day of a pay period, in
 * the CS Form 48 manner -- arrival and departure, hours, remarks -- for the
 * employee and their supervisor to sign. Pure and relative-import only, so
 * tests/dtr-print.test.mjs runs it under node --test.
 *
 * Late and undertime need a schedule; nobody has one yet (phase 3), so the
 * print shows hours worked and says what is missing or corrected.
 */
import { addDays, pairSessions, sessionMinutes, timeLabel, type PunchLike } from "./dtr.ts";

export interface PrintPunch extends PunchLike {
  source: "device" | "adjustment";
  siteStatus: "on_site" | "off_site" | "unknown";
}

export interface DtrPrintRow {
  day: string;
  weekday: string;
  /** Arrival and departure per session, `HH:mm` or "" when missing. */
  sessions: { in: string; out: string }[];
  minutes: number;
  remarks: string[];
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function dtrPrintRows(
  punches: readonly PrintPunch[],
  staffId: string,
  from: string,
  to: string,
  today: string
): { rows: DtrPrintRow[]; totalMinutes: number; daysPresent: number } {
  const mine = punches.filter((p) => p.staffId === staffId);
  const at = new Map(mine.map((p) => [`${p.punchType}@${new Date(p.punchedAt).toISOString()}`, p]));
  const sessions = pairSessions(mine).filter((s) => s.status !== "orphan_out");
  const rows: DtrPrintRow[] = [];
  let totalMinutes = 0;
  let daysPresent = 0;
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const own = sessions.filter((s) => s.dayKey === day);
    const remarks = new Set<string>();
    let minutes = 0;
    for (const s of own) {
      if (s.status === "closed") minutes += sessionMinutes(s, 0);
      else if (s.status === "open" && day >= today) remarks.add("Still clocked in");
      else remarks.add("No clock-out");
      const inPunch = s.clockInAt ? at.get(`clock_in@${s.clockInAt}`) : undefined;
      const outPunch = s.clockOutAt ? at.get(`clock_out@${s.clockOutAt}`) : undefined;
      if (outPunch?.source === "adjustment" || inPunch?.source === "adjustment") remarks.add("Time corrected (approved)");
      if (inPunch?.siteStatus === "off_site" || outPunch?.siteStatus === "off_site") remarks.add("Off-site");
    }
    if (own.length > 0) daysPresent += 1;
    totalMinutes += minutes;
    rows.push({
      day,
      weekday: WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()],
      sessions: own.map((s) => ({ in: s.clockInAt ? timeLabel(s.clockInAt) : "", out: s.clockOutAt ? timeLabel(s.clockOutAt) : "" })),
      minutes,
      remarks: [...remarks],
    });
  }
  return { rows, totalMinutes, daysPresent };
}
