// Relative imports with extensions: `node --test` loads this file without the @/ alias.
import type { BookingItem, BookingRequest, BookingStatus, PlanStatus, RequestorKind, SlotState } from "../types/booking.ts";
import { longDate } from "./booking-emails.ts";
import { formatTime12 } from "./time12.ts";

/**
 * LAF Activity Center Bookings: the words and small sums the pages share. Pure, so the same rules can be shown on
 * the public form before the database repeats them (booking.web_request is the judge; this only saves a round trip).
 */

export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  pending: "Pending approval",
  approved: "Approved",
  declined: "Declined",
  cancelled: "Cancelled",
  completed: "Completed",
  no_show: "Did not come",
};

/** The tone names of lib/utils/status-colors. */
export const BOOKING_STATUS_TONE: Record<BookingStatus, "positive" | "info" | "warning" | "negative" | "neutral"> = {
  pending: "warning",
  approved: "positive",
  declined: "negative",
  cancelled: "neutral",
  completed: "info",
  no_show: "negative",
};

export const SLOT_STATE_LABEL: Record<SlotState, string> = {
  open: "Open",
  pending: "Pending approval",
  booked: "Booked",
  closed: "Closed",
  holiday: "Holiday",
  too_soon: "Too soon to book",
  too_far: "Not open yet",
  past: "Past",
};

export const REQUESTOR_KINDS: { key: RequestorKind; label: string }[] = [
  { key: "person", label: "A person" },
  { key: "company", label: "Company" },
  { key: "school", label: "School" },
  { key: "church", label: "Church" },
  { key: "organization", label: "Organization" },
  { key: "government", label: "Government office" },
];

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const PLAN_STATUS_LABEL: Record<PlanStatus, string> = { draft: "Draft", submitted: "For NCH approval", approved: "Approved by NCH", returned: "Returned by NCH" };

/** "December 2026" from `yyyy-MM`. */
export const monthName = (month: string): string => longDate(`${month}-01`).replace(/^\w+, (\w+) \d+, (\d+)$/, "$1 $2");
/** "December 1 to 31, 2026": an Activity Plan always covers the first to the last day of its month. */
export const monthCover = (month: string): string => longDate(`${month}-01`).replace(/^\w+, (\w+) \d+, (\d+)$/, `$1 1 to ${Number(lastDayOf(month).slice(8))}, $2`);

/** The weekly slots in a sentence: "Monday, Tuesday, Thursday and Friday, 10:00 AM to 12:00 PM"; slots at
 * another time follow after a semicolon. */
export function slotsLine(slots: { weekday: number; start: string; end: string }[]): string {
  const byTime = new Map<string, number[]>();
  for (const s of [...slots].sort((a, b) => a.start.localeCompare(b.start) || a.weekday - b.weekday)) byTime.set(`${s.start}|${s.end}`, [...(byTime.get(`${s.start}|${s.end}`) ?? []), s.weekday]);
  return [...byTime].map(([time, days]) => {
    const names = [...new Set(days)].sort((a, b) => a - b).map((d) => WEEKDAYS[d]);
    const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
    const [start, end] = time.split("|");
    return `${list}, ${formatTime12(start)} to ${formatTime12(end)}`;
  }).join("; ");
}

/** `HH:mm` as minutes since midnight; NaN when it is not a time. */
export function minutesOf(time: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(time ?? "");
  if (!m) return Number.NaN;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h > 23 || min > 59 ? Number.NaN : h * 60 + min;
}

/** "1 h 30 min", "45 min", "2 h"; empty when the times don't make a duration. */
export function durationLabel(start: string, end: string): string {
  const total = minutesOf(end) - minutesOf(start);
  if (!Number.isFinite(total) || total <= 0) return "";
  const h = Math.floor(total / 60);
  const min = total % 60;
  return [h ? `${h} h` : "", min ? `${min} min` : ""].filter(Boolean).join(" ");
}

/** Who an activity is for, in words: "Patients only · ages 4 to 12 · girls". */
export function participantsLabel(item: Pick<BookingItem, "who" | "ages" | "gender" | "note">): string {
  const who = item.who === "both" ? "Patients and carers" : item.who === "carers" ? "Carers only" : "Patients only";
  const gender = item.gender === "girls" ? "girls" : item.gender === "boys" ? "boys" : "";
  return [who, item.ages ? `ages ${item.ages}` : "", gender, item.note].filter(Boolean).join(" · ");
}

export interface FlowRow {
  activity: string;
  start: string;
  end: string;
}

/**
 * What is wrong with a program flow, one line per problem, in the words booking.web_request uses: 1 to 3
 * activities, each named, each inside the slot, each ending after it starts, none starting before the one
 * before it has ended.
 */
export function flowProblems(rows: FlowRow[], slotStart: string, slotEnd: string): string[] {
  const problems: string[] = [];
  if (rows.length < 1 || rows.length > 3) return ["The program flow needs 1 to 3 activities."];
  let previousEnd = Number.NaN;
  rows.forEach((row, i) => {
    const n = i + 1;
    const from = minutesOf(row.start);
    const to = minutesOf(row.end);
    if (row.activity.trim().length < 2) problems.push(`Activity ${n}: please name the activity.`);
    if (!Number.isFinite(from) || !Number.isFinite(to)) problems.push(`Activity ${n}: please give its start and end time.`);
    else if (to <= from) problems.push(`Activity ${n}: the end time must be after the start time.`);
    else if (from < minutesOf(slotStart) || to > minutesOf(slotEnd)) problems.push(`Activity ${n}: it must fit inside the slot.`);
    else if (Number.isFinite(previousEnd) && from < previousEnd) problems.push(`Activity ${n}: it starts before the one before it has ended.`);
    if (Number.isFinite(to)) previousEnd = to;
  });
  return problems;
}

/** The order staff read requests in: those waiting first (soonest day first), then the rest, newest day first. */
export function byNeedsAnswer(a: Pick<BookingRequest, "status" | "date" | "start">, b: Pick<BookingRequest, "status" | "date" | "start">): number {
  const waitA = a.status === "pending" ? 0 : 1;
  const waitB = b.status === "pending" ? 0 : 1;
  if (waitA !== waitB) return waitA - waitB;
  const order = `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`);
  return waitA === 0 ? order : -order;
}

/** The weeks of a month for a calendar: Sunday first, `null` for the cells outside the month. `month` is `yyyy-MM`. */
export function monthWeeks(month: string): (string | null)[][] {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const cells: (string | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)];
  while (cells.length % 7 !== 0) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

/** The month before or after (`yyyy-MM`). */
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The same weekday of the same week in another month: the 2nd Thursday of November gives the 2nd Thursday of
 * December. Null when that month has no such day (a 5th Friday, say). `day` is `yyyy-MM-dd`, `month` `yyyy-MM`. */
export function sameWeekdayIn(day: string, month: string): string | null {
  const [y, m, d] = day.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const nth = Math.ceil(d / 7);
  const [ty, tm] = month.split("-").map(Number);
  const first = new Date(Date.UTC(ty, tm - 1, 1)).getUTCDay();
  const target = 1 + ((weekday - first + 7) % 7) + (nth - 1) * 7;
  return target <= Number(lastDayOf(month).slice(8)) ? `${month}-${String(target).padStart(2, "0")}` : null;
}

/** The last day of a month (`yyyy-MM` -> `yyyy-MM-dd`). */
export function lastDayOf(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}
