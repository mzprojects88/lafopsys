/**
 * When the app nudges someone about their time record (DTR plan phase 1):
 * the end-of-shift reminder and the "you didn't clock out" prompt. Pure and
 * relative-import only, so tests/dtr-prompts.test.mjs runs it under node --test.
 */
import { addDays, zonedDayStart } from "./dtr.ts";

/** With no schedule on file: remind after 9 hours (8 worked plus the meal hour, Labor Code Art. 83/85). */
export const REMIND_AFTER_MINUTES = 9 * 60;

/** The instant of an `HH:mm` label on an org-timezone day. */
export function instantOn(day: string, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(zonedDayStart(day).getTime() + (h * 60 + m) * 60_000);
}

/**
 * When the reminder to clock out is due: the scheduled end of the shift
 * (a shift ending before it starts ends the next day), else 9 hours after
 * the day's clock-in.
 */
export function clockOutDueAt(day: string, clockIn: string, shift: { start: string; end: string } | null): Date {
  if (shift) {
    const end = instantOn(day, shift.end);
    return shift.end <= shift.start ? new Date(end.getTime() + 24 * 60 * 60_000) : end;
  }
  return new Date(instantOn(day, clockIn).getTime() + REMIND_AFTER_MINUTES * 60_000);
}

export interface EntryLike {
  id: string;
  staffId: string;
  date: string;
  clockIn?: string | null;
  clockOut?: string | null;
}
export interface RequestLike {
  timeEntryId: string;
  punchType: "clock_in" | "clock_out";
  status: "pending" | "approved" | "rejected";
}

/**
 * Days a person clocked into and never out of, before today, that nobody has
 * asked to fix yet (a rejected request can be asked again). Yesterday's may
 * be a night or 24-hour shift still running, so it is asked about, not
 * assumed forgotten. Oldest first.
 */
export function forgottenDays(
  staffId: string,
  entries: readonly EntryLike[],
  requests: readonly RequestLike[],
  today: string
): { entry: EntryLike; mayStillBeOnDuty: boolean }[] {
  const asked = new Set(requests.filter((r) => r.punchType === "clock_out" && r.status !== "rejected").map((r) => r.timeEntryId));
  const yesterdayKey = addDays(today, -1);
  return entries
    .filter((e) => e.staffId === staffId && !!e.clockIn && !e.clockOut && e.date < today && !asked.has(e.id))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((entry) => ({ entry, mayStillBeOnDuty: entry.date === yesterdayKey }));
}
