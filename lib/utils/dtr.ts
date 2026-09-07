/**
 * DTR arithmetic: which punches make a session, how long it lasted, and what a
 * day / week / month adds up to -- all in the organisation's timezone.
 *
 * Shared by the punch API route (what gets persisted on ops.time_entries), the
 * /staff/dtr page and the clock widget (what gets displayed), so the numbers
 * agree by construction. Deliberately has no project imports and uses only
 * erasable TypeScript so `node --test tests/dtr.test.mjs` can load it directly.
 *
 * Time source is always the punch timestamp. The `HH:mm` text columns on
 * time_entries are labels for humans: an overnight session reads out "02:00"
 * before in "22:00", which is exactly why duration is never computed from them.
 */

/** Little Ark operates in Manila. Vercel functions run in UTC and staff
 * browsers are wherever the staff are, so "today" is defined here, once. */
export const ORG_TIMEZONE = "Asia/Manila";
/** 0 = Sunday ... 6 = Saturday. Payroll weeks run Monday to Sunday. */
export const WEEK_STARTS_ON = 1;
/** An open session older than this is a forgotten clock-out, not a shift --
 * it stops accruing and is shown as a missed punch. Above the 24h shift label. */
export const MAX_SESSION_MINUTES = 25 * 60;
/** Flagged for review on the DTR, but still counted. */
export const LONG_SESSION_MINUTES = 12 * 60;

const DAY_MS = 86_400_000;

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: ORG_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: ORG_TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: ORG_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

type DateInput = Date | string | number;

function toDate(d: DateInput): Date {
  return d instanceof Date ? d : new Date(d);
}

function ms(d: DateInput): number {
  return toDate(d).getTime();
}

/** `yyyy-MM-dd` of the instant in the org timezone. */
export function dayKey(d: DateInput): string {
  return dayFormatter.format(toDate(d));
}

/** `HH:mm` of the instant in the org timezone. */
export function timeLabel(d: DateInput): string {
  return timeFormatter.format(toDate(d));
}

/** Offset of the org timezone from UTC at the given instant, in ms (Manila: +8h). */
function zoneOffsetMs(at: Date): number {
  const parts: Record<string, string> = {};
  for (const part of partsFormatter.formatToParts(at)) parts[part.type] = part.value;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second)
  );
  return Math.round((asUtc - at.getTime()) / 60_000) * 60_000;
}

function splitKey(key: string): [number, number, number] {
  const [y, m, d] = key.split("-").map(Number);
  return [y, m, d];
}

/** Midnight at the start of `key` in the org timezone, as a real instant. */
export function zonedDayStart(key: string): Date {
  const [y, m, d] = splitKey(key);
  const guess = Date.UTC(y, m - 1, d);
  // The offset that applies at local midnight is the one at (guess - offset);
  // two passes cover a zone whose offset changes on that day.
  const first = guess - zoneOffsetMs(new Date(guess));
  return new Date(guess - zoneOffsetMs(new Date(first)));
}

export function addDays(key: string, n: number): string {
  const [y, m, d] = splitKey(key);
  return new Date(Date.UTC(y, m - 1, d) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Day key of the first day (Monday) of the week containing `key`. */
export function weekKey(key: string): string {
  const [y, m, d] = splitKey(key);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(key, -((dow - WEEK_STARTS_ON + 7) % 7));
}

/** `yyyy-MM` of the month containing `key`. */
export function monthKey(key: string): string {
  return key.slice(0, 7);
}

// ---------------------------------------------------------------------------

export interface PunchLike {
  id: string;
  staffId: string;
  punchType: "clock_in" | "clock_out";
  /** ISO timestamp. */
  punchedAt: string;
  timeEntryId?: string;
}

export type SessionStatus =
  /** Clocked in, not yet out. */
  | "open"
  /** A clock-in matched by a clock-out. */
  | "closed"
  /** A clock-in that was never closed before the next day's clock-in (or ran past MAX_SESSION_MINUTES). */
  | "missed_out"
  /** A clock-out with no clock-in to attach to. Counts for nothing. */
  | "orphan_out";

export interface DtrSession {
  /** Id of the clock-in punch (or of the clock-out punch for an orphan). */
  id: string;
  staffId: string;
  timeEntryId?: string;
  clockInAt?: string;
  clockOutAt?: string;
  /** The org-timezone day the session belongs to: the day it was clocked IN.
   * An overnight shift counts wholly toward the day it started. */
  dayKey: string;
  status: SessionStatus;
}

/**
 * Pairs punches into sessions, per staff member, in time order:
 * - clock_in with nothing open starts a session;
 * - clock_in while one is open on the same day is a duplicate (two devices
 *   racing) and is ignored; on a later day it closes the old one as a missed
 *   clock-out and starts a new one;
 * - clock_out closes the open session; with nothing open it is an orphan.
 * Accepts any order (the store serves newest-first).
 */
export function pairSessions(punches: readonly PunchLike[]): DtrSession[] {
  const sorted = [...punches].sort((a, b) => ms(a.punchedAt) - ms(b.punchedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const open = new Map<string, DtrSession>();
  const out: DtrSession[] = [];

  for (const p of sorted) {
    const current = open.get(p.staffId);
    if (p.punchType === "clock_in") {
      const key = dayKey(p.punchedAt);
      if (current) {
        if (current.dayKey === key) continue;
        current.status = "missed_out";
        open.delete(p.staffId);
      }
      const session: DtrSession = {
        id: p.id,
        staffId: p.staffId,
        timeEntryId: p.timeEntryId,
        clockInAt: p.punchedAt,
        dayKey: key,
        status: "open",
      };
      open.set(p.staffId, session);
      out.push(session);
    } else if (current) {
      current.clockOutAt = p.punchedAt;
      current.status = "closed";
      open.delete(p.staffId);
    } else {
      out.push({
        id: p.id,
        staffId: p.staffId,
        timeEntryId: p.timeEntryId,
        clockOutAt: p.punchedAt,
        dayKey: dayKey(p.punchedAt),
        status: "orphan_out",
      });
    }
  }
  return out;
}

/** `open` sessions that have run past the cap are reported as missed clock-outs. */
export function effectiveStatus(s: DtrSession, now: DateInput): SessionStatus {
  if (s.status === "open" && s.clockInAt && ms(now) - ms(s.clockInAt) > MAX_SESSION_MINUTES * 60_000) return "missed_out";
  return s.status;
}

/** Whole minutes worked in the session; an open session is measured up to `now`. */
export function sessionMinutes(s: DtrSession, now: DateInput): number {
  if (!s.clockInAt) return 0;
  if (s.status === "closed" && s.clockOutAt) return Math.max(0, Math.floor((ms(s.clockOutAt) - ms(s.clockInAt)) / 60_000));
  if (s.status === "open") {
    const elapsed = Math.floor((ms(now) - ms(s.clockInAt)) / 60_000);
    return elapsed > MAX_SESSION_MINUTES ? 0 : Math.max(0, elapsed);
  }
  return 0;
}

export function isLong(s: DtrSession, now: DateInput): boolean {
  return sessionMinutes(s, now) >= LONG_SESSION_MINUTES;
}

export interface DtrTotals {
  today: number;
  week: number;
  month: number;
  /** Sessions still running (not past the cap). */
  openCount: number;
}

/** Minutes for today, this week and this month as of `now`, over the given
 * staff (all staff when `staffIds` is omitted). Open sessions tick with `now`. */
export function totalsFor(sessions: readonly DtrSession[], opts: { now: DateInput; staffIds?: readonly string[] }): DtrTotals {
  const today = dayKey(opts.now);
  const week = weekKey(today);
  const month = monthKey(today);
  const wanted = opts.staffIds ? new Set(opts.staffIds) : null;
  const totals: DtrTotals = { today: 0, week: 0, month: 0, openCount: 0 };

  for (const s of sessions) {
    if (wanted && !wanted.has(s.staffId)) continue;
    const minutes = sessionMinutes(s, opts.now);
    if (effectiveStatus(s, opts.now) === "open") totals.openCount += 1;
    if (s.dayKey === today) totals.today += minutes;
    if (weekKey(s.dayKey) === week) totals.week += minutes;
    if (monthKey(s.dayKey) === month) totals.month += minutes;
  }
  return totals;
}

/** What the punch route persists on the day's ops.time_entries row: minutes of
 * completed sessions, and how many sessions the day had (open ones included,
 * orphans excluded). */
export function entryTotals(sessions: readonly DtrSession[], day: string, staffId: string): { totalMinutes: number; sessionCount: number } {
  let totalMinutes = 0;
  let sessionCount = 0;
  for (const s of sessions) {
    if (s.staffId !== staffId || s.dayKey !== day || s.status === "orphan_out") continue;
    sessionCount += 1;
    if (s.status === "closed") totalMinutes += sessionMinutes(s, 0);
  }
  return { totalMinutes, sessionCount };
}

/**
 * The normal working day in minutes -- 8 hours, Art. 83 of the Labor Code.
 * Only the fallback: the live value is shared.app_settings.
 * overtime_threshold_minutes, which an admin can change in Settings.
 */
export const DEFAULT_OVERTIME_THRESHOLD_MINUTES = 8 * 60;

/**
 * Splits a day's worked minutes into regular and overtime.
 *
 * Computed wherever it is shown rather than stored on the entry: the threshold
 * is a setting, and a stored figure would keep whatever number happened to
 * apply the day it was written. ops.time_entries.overtime_minutes existed for
 * that and was never once written to (dropped in 0029).
 *
 * Overtime is per DAY, not per week or per session -- someone who works two
 * four-hour sessions has done eight regular hours, not two short days.
 */
export function splitOvertime(
  totalMinutes: number,
  thresholdMinutes: number = DEFAULT_OVERTIME_THRESHOLD_MINUTES
): { regular: number; overtime: number } {
  const total = Math.max(0, Math.round(totalMinutes));
  const threshold = Math.max(0, Math.round(thresholdMinutes));
  return { regular: Math.min(total, threshold), overtime: Math.max(0, total - threshold) };
}

/** `7h 45m`. */
export function formatMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
