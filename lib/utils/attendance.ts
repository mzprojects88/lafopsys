/**
 * Attendance: what a day of DTR sessions means once it is held against the
 * person's schedule, the holiday list and their approved leave.
 *
 * Computed at read time, never stored per day (ops.time_entries.flag keeps
 * only `missed_punch`, which the punch route writes): the schedule, the
 * grace period and the holiday list are all data that can change, and a
 * stored flag would keep whatever rule applied the day it was written. The
 * one thing that IS stored is the period summary (hr.period_timesheets,
 * 0039) -- frozen at approval, so what was approved is what payroll pays.
 *
 * Rules, with their basis (as of 2026-09-08):
 * - A day belongs to the day it was clocked IN (lib/utils/dtr.ts); an
 *   overnight shift counts wholly toward its start day.
 * - Meal break: the schedule's unpaid break (Art. 85, at least 60 minutes)
 *   is deducted from a day's gross worked time once the day reaches five
 *   hours, the point at which a meal period is due.
 * - Late: minutes after the scheduled start, less the grace period from
 *   Settings (a grace period is policy, not law). Undertime: minutes before
 *   the scheduled end. Neither is ever netted against overtime (Art. 88).
 * - Overtime: paid minutes beyond the org's daily threshold (Art. 87, work
 *   beyond eight hours; shared.app_settings.overtime_threshold_minutes).
 *   Overtime is taken from the END of the day's work, so night overtime is
 *   whatever part of those last minutes fell between 22:00 and 06:00.
 * - Night shift differential: minutes between 22:00 and 06:00 (Art. 86).
 * - Rest day: a day the pattern (or an override) leaves blank (Art. 91-93).
 * - Holidays: regular (Art. 94) and special non-working days classify the
 *   day's premium; a special WORKING day is an ordinary day. Local holidays
 *   apply only when the person's city matches.
 * - Absent: a scheduled workday, not a holiday, with no session and no
 *   approved leave. Half-day leave with no session is half an absence.
 * - Regular holiday pay when unworked (daily-paid): due if the person was
 *   present or on paid leave on the workday immediately before (IRR Book
 *   III Rule IV s.6). Recorded per day; the engine applies it by pay basis.
 */

import { addDays, sessionMinutes, zonedDayStart, type DtrSession, type SessionStatus } from "./dtr.ts";

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
const WEEKDAYS: Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export interface ShiftTimes {
  /** `HH:MM`; `end` earlier than `start` is an overnight shift. */
  start: string;
  end: string;
}

export type SchedulePattern = Record<Weekday, ShiftTimes | null>;

export interface WorkScheduleLike {
  pattern: SchedulePattern;
  breakMinutes: number;
  hoursPerDay: number;
}

export interface ScheduleOverrideLike {
  date: string;
  start: string | null;
  end: string | null;
  isRestDay: boolean;
}

export type HolidayKind = "regular" | "special_non_working" | "special_working";

export interface HolidayLike {
  date: string;
  kind: HolidayKind;
  scopeCity?: string | null;
}

export interface LeaveLike {
  from: string;
  to: string;
  startHalf: boolean;
  endHalf: boolean;
  paid: boolean;
  typeId: string;
}

export type DayClass = "workday" | "rest_day";
export type DayFlag = "on_time" | "late" | "early_out" | "missed_punch" | "absent" | "rest_day" | "holiday" | "on_leave" | "unscheduled";

/** Which premium the day's minutes attract (payroll.ts premiumMultipliers). */
export type PremiumClass = "ordinary" | "rest_day" | "special_non_working" | "special_on_rest_day" | "regular_holiday" | "regular_holiday_on_rest_day";

export const PREMIUM_CLASSES: PremiumClass[] = ["ordinary", "rest_day", "special_non_working", "special_on_rest_day", "regular_holiday", "regular_holiday_on_rest_day"];

export interface DayAttendance {
  day: string;
  dayClass: DayClass;
  /** null when the person has no schedule at all (worked minutes still count). */
  scheduled: ShiftTimes | null;
  holiday: HolidayKind | null;
  premium: PremiumClass;
  /** Gross minutes clocked. */
  workedMinutes: number;
  /** Gross less the unpaid meal break. regular + overtime. */
  paidMinutes: number;
  regularMinutes: number;
  overtimeMinutes: number;
  nightMinutes: number;
  nightOvertimeMinutes: number;
  lateMinutes: number;
  undertimeMinutes: number;
  leave: { typeId: string; paid: boolean; fraction: 0.5 | 1 } | null;
  /** 0, 0.5 or 1 of a day's pay lost to absence without leave. */
  absent: number;
  missedPunch: boolean;
  /** Daily-paid: unworked regular holiday is paid only when this is true. */
  eligibleForHolidayPay: boolean;
  flag: DayFlag;
}

export interface DayAttendanceInput {
  day: string;
  schedule: WorkScheduleLike | null;
  overrides: readonly ScheduleOverrideLike[];
  sessions: readonly DtrSession[];
  holidays: readonly HolidayLike[];
  leaves: readonly LeaveLike[];
  overtimeThresholdMinutes: number;
  graceMinutes: number;
  /** The person's city for local holidays; null = national only. */
  city?: string | null;
  now: Date | string | number;
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const ms = (d: Date | string | number) => (d instanceof Date ? d.getTime() : typeof d === "number" ? d : Date.parse(d));

/** The shift a day is scheduled for: an override first, then the weekly pattern. Null = rest day or no schedule. */
export function scheduledShift(day: string, schedule: WorkScheduleLike | null, overrides: readonly ScheduleOverrideLike[]): ShiftTimes | null {
  const o = overrides.find((x) => x.date === day);
  if (o) return o.isRestDay || !o.start || !o.end ? null : { start: o.start, end: o.end };
  if (!schedule) return null;
  const w = WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()];
  return schedule.pattern[w] ?? null;
}

export function holidayOn(day: string, holidays: readonly HolidayLike[], city?: string | null): HolidayKind | null {
  const h = holidays.find((x) => x.date === day && (!x.scopeCity || (city && x.scopeCity.toLowerCase() === city.toLowerCase())));
  return h ? h.kind : null;
}

/** Approved leave covering the day, and how much of it. */
export function leaveOn(day: string, leaves: readonly LeaveLike[]): DayAttendance["leave"] {
  for (const l of leaves) {
    if (day < l.from || day > l.to) continue;
    const half = (day === l.from && l.startHalf) || (day === l.to && l.endHalf);
    return { typeId: l.typeId, paid: l.paid, fraction: half ? 0.5 : 1 };
  }
  return null;
}

/** Minutes of a session that fall between 22:00 and 06:00, anchored on its clock-in day. */
export function nightMinutes(session: DtrSession, now: Date | string | number): number {
  const total = sessionMinutes(session, now);
  if (!session.clockInAt || total === 0) return 0;
  const start = (ms(session.clockInAt) - zonedDayStart(session.dayKey).getTime()) / 60_000;
  return nightOverlap(start, start + total);
}

/** Overlap of [from, to) (minutes since the day's 00:00, may run past 1440) with the night windows. */
function nightOverlap(from: number, to: number): number {
  const windows: [number, number][] = [
    [-120, 360], // 22:00 the previous evening to 06:00 (for a clock-in before midnight on the prior day)
    [1320, 1800], // 22:00 to 06:00 next day
    [2760, 3240], // the night after that (a session capped at 25 h can reach it)
  ];
  let n = 0;
  for (const [a, b] of windows) n += Math.max(0, Math.min(to, b) - Math.max(from, a));
  return Math.round(n);
}

function premiumFor(dayClass: DayClass, holiday: HolidayKind | null): PremiumClass {
  const rest = dayClass === "rest_day";
  if (holiday === "regular") return rest ? "regular_holiday_on_rest_day" : "regular_holiday";
  if (holiday === "special_non_working") return rest ? "special_on_rest_day" : "special_non_working";
  return rest ? "rest_day" : "ordinary";
}

const MEAL_BREAK_AFTER_MINUTES = 5 * 60;

export function dayAttendance(input: DayAttendanceInput): DayAttendance {
  const { day, schedule, overrides, holidays, leaves, now } = input;
  const sessions = input.sessions.filter((s) => s.dayKey === day && s.status !== "orphan_out").sort((a, b) => ms(a.clockInAt ?? 0) - ms(b.clockInAt ?? 0));
  const scheduled = scheduledShift(day, schedule, overrides);
  const hasSchedule = schedule !== null || overrides.some((o) => o.date === day);
  const dayClass: DayClass = hasSchedule && scheduled === null ? "rest_day" : "workday";
  const holiday = holidayOn(day, holidays, input.city);
  const premium = premiumFor(dayClass, holiday === "special_working" ? null : holiday);
  const leave = leaveOn(day, leaves);
  const dayStart = zonedDayStart(day).getTime();

  let workedMinutes = 0;
  let missedPunch = false;
  let firstIn: number | null = null;
  let lastOut: number | null = null;
  const spans: [number, number][] = [];
  for (const s of sessions) {
    const status: SessionStatus = s.status === "open" && s.clockInAt && ms(now) - ms(s.clockInAt) > 25 * 60 * 60_000 ? "missed_out" : s.status;
    if (status === "missed_out") missedPunch = true;
    // A session still running earns nothing yet: the same rule as the DTR
    // page (entryTotals counts closed sessions only), and the only rule
    // under which a period summary frozen at approval cannot contain a
    // partial day. Recompute after the clock-out.
    if (s.status === "open") continue;
    const mins = sessionMinutes(s, now);
    if (!s.clockInAt || mins === 0) continue;
    const from = (ms(s.clockInAt) - dayStart) / 60_000;
    spans.push([from, from + mins]);
    workedMinutes += mins;
    firstIn = firstIn === null ? from : Math.min(firstIn, from);
    lastOut = lastOut === null ? from + mins : Math.max(lastOut, from + mins);
  }

  const breakMinutes = schedule?.breakMinutes ?? 0;
  const paidMinutes = workedMinutes >= MEAL_BREAK_AFTER_MINUTES ? Math.max(0, workedMinutes - breakMinutes) : workedMinutes;
  const overtimeMinutes = Math.max(0, paidMinutes - Math.max(0, Math.round(input.overtimeThresholdMinutes)));
  const regularMinutes = paidMinutes - overtimeMinutes;

  let nightTotal = 0;
  for (const [a, b] of spans) nightTotal += nightOverlap(a, b);
  // Overtime is the last `overtimeMinutes` of the day's work; count the night part of those.
  let nightOvertimeMinutes = 0;
  let left = overtimeMinutes;
  for (let i = spans.length - 1; i >= 0 && left > 0; i--) {
    const [a, b] = spans[i];
    const take = Math.min(left, b - a);
    nightOvertimeMinutes += nightOverlap(b - take, b);
    left -= take;
  }

  let lateMinutes = 0;
  let undertimeMinutes = 0;
  if (dayClass === "workday" && scheduled && holiday !== "regular" && holiday !== "special_non_working" && firstIn !== null && lastOut !== null) {
    const start = toMin(scheduled.start);
    let end = toMin(scheduled.end);
    if (end <= start) end += 1440;
    const late = Math.round(firstIn - start);
    lateMinutes = late > input.graceMinutes ? late - Math.max(0, input.graceMinutes) : 0;
    undertimeMinutes = Math.max(0, Math.round(end - lastOut));
  }

  const isWorkingHoliday = holiday === "regular" || holiday === "special_non_working";
  let absent = 0;
  if (dayClass === "workday" && hasSchedule && scheduled && !isWorkingHoliday && workedMinutes === 0) {
    absent = leave ? 1 - leave.fraction : 1;
  }

  // Daily-paid regular-holiday pay: present or on paid leave the workday before.
  let eligibleForHolidayPay = false;
  if (holiday === "regular") {
    let prev = addDays(day, -1);
    for (let i = 0; i < 7; i++) {
      const prevShift = scheduledShift(prev, schedule, overrides);
      const prevHoliday = holidayOn(prev, holidays, input.city);
      if (prevShift === null || prevHoliday === "regular" || prevHoliday === "special_non_working") {
        prev = addDays(prev, -1);
        continue;
      }
      const worked = input.sessions.some((s) => s.dayKey === prev && s.status !== "orphan_out" && sessionMinutes(s, now) > 0);
      const prevLeave = leaveOn(prev, leaves);
      eligibleForHolidayPay = worked || (prevLeave !== null && prevLeave.paid);
      break;
    }
  }

  let flag: DayFlag;
  if (missedPunch) flag = "missed_punch";
  else if (absent >= 1) flag = "absent";
  else if (leave && workedMinutes === 0) flag = "on_leave";
  else if (isWorkingHoliday && workedMinutes === 0) flag = "holiday";
  else if (dayClass === "rest_day" && workedMinutes === 0) flag = "rest_day";
  else if (!hasSchedule) flag = "unscheduled";
  else if (lateMinutes > 0) flag = "late";
  else if (undertimeMinutes > 0) flag = "early_out";
  else flag = "on_time";

  return {
    day,
    dayClass,
    scheduled,
    holiday,
    premium,
    workedMinutes,
    paidMinutes,
    regularMinutes,
    overtimeMinutes,
    nightMinutes: nightTotal,
    nightOvertimeMinutes,
    lateMinutes,
    undertimeMinutes,
    leave,
    absent,
    missedPunch,
    eligibleForHolidayPay,
    flag,
  };
}

export interface PremiumBucket {
  /** Regular (non-overtime) paid minutes in this class. */
  minutes: number;
  overtimeMinutes: number;
  nightMinutes: number;
  nightOvertimeMinutes: number;
  /** Days with any work in this class. */
  days: number;
}

export interface PeriodAttendance {
  from: string;
  to: string;
  days: DayAttendance[];
  totals: {
    scheduledDays: number;
    /** Workdays with any work (rest days and holidays worked are in byPremium). */
    daysWorked: number;
    absences: number;
    lateMinutes: number;
    undertimeMinutes: number;
    paidLeaveDays: number;
    unpaidLeaveDays: number;
    /** Regular holidays not worked where holiday pay is due to a daily-paid employee. */
    regularHolidaysUnworked: number;
    missedPunches: number;
    byPremium: Record<PremiumClass, PremiumBucket>;
  };
}

export function emptyBuckets(): Record<PremiumClass, PremiumBucket> {
  const out = {} as Record<PremiumClass, PremiumBucket>;
  for (const c of PREMIUM_CLASSES) out[c] = { minutes: 0, overtimeMinutes: 0, nightMinutes: 0, nightOvertimeMinutes: 0, days: 0 };
  return out;
}

export function periodAttendance(input: Omit<DayAttendanceInput, "day"> & { from: string; to: string }): PeriodAttendance {
  const days: DayAttendance[] = [];
  for (let d = input.from; d <= input.to; d = addDays(d, 1)) days.push(dayAttendance({ ...input, day: d }));
  const totals: PeriodAttendance["totals"] = {
    scheduledDays: 0,
    daysWorked: 0,
    absences: 0,
    lateMinutes: 0,
    undertimeMinutes: 0,
    paidLeaveDays: 0,
    unpaidLeaveDays: 0,
    regularHolidaysUnworked: 0,
    missedPunches: 0,
    byPremium: emptyBuckets(),
  };
  for (const d of days) {
    const isWorkingHoliday = d.holiday === "regular" || d.holiday === "special_non_working";
    if (d.dayClass === "workday" && d.scheduled && !isWorkingHoliday) totals.scheduledDays++;
    if (d.workedMinutes > 0 && d.premium === "ordinary") totals.daysWorked++;
    totals.absences += d.absent;
    totals.lateMinutes += d.lateMinutes;
    totals.undertimeMinutes += d.undertimeMinutes;
    if (d.leave && d.workedMinutes === 0) {
      if (d.leave.paid) totals.paidLeaveDays += d.leave.fraction;
      else totals.unpaidLeaveDays += d.leave.fraction;
    }
    if (d.holiday === "regular" && d.workedMinutes === 0 && d.eligibleForHolidayPay) totals.regularHolidaysUnworked++;
    if (d.missedPunch) totals.missedPunches++;
    const b = totals.byPremium[d.premium];
    b.minutes += d.regularMinutes;
    b.overtimeMinutes += d.overtimeMinutes;
    b.nightMinutes += d.nightMinutes - d.nightOvertimeMinutes;
    b.nightOvertimeMinutes += d.nightOvertimeMinutes;
    if (d.workedMinutes > 0) b.days++;
  }
  return { from: input.from, to: input.to, days, totals };
}

/** What /staff/timesheets shows for a day, instead of ops.time_entries.flag. */
export function entryFlag(d: DayAttendance): DayFlag {
  return d.flag;
}
