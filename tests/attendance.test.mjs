// Unit tests for lib/utils/attendance.ts -- a day of DTR sessions held
// against the schedule, the holidays and approved leave. Times are Manila
// (+08:00) throughout.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dayAttendance, nightMinutes, periodAttendance, scheduledShift } from "../lib/utils/attendance.ts";

const SHIFT = { start: "08:00", end: "17:00" };
const SCHEDULE = { pattern: { mon: SHIFT, tue: SHIFT, wed: SHIFT, thu: SHIFT, fri: SHIFT, sat: null, sun: null }, breakMinutes: 60, hoursPerDay: 8 };
const NOW = "2026-12-31T23:59:00+08:00";
const HOLIDAYS = [
  { date: "2026-12-25", kind: "regular" },
  { date: "2026-11-01", kind: "special_non_working" },
  { date: "2026-02-25", kind: "special_working" },
  { date: "2026-06-24", kind: "special_non_working", scopeCity: "Manila" },
];

let n = 0;
const session = (day, inTime, outTime, status = "closed") => ({
  id: `s${++n}`,
  staffId: "A",
  dayKey: day,
  clockInAt: `${day}T${inTime}:00+08:00`,
  clockOutAt: outTime ? `${outTime.includes("T") ? outTime : `${day}T${outTime}`}:00+08:00` : undefined,
  status,
});
const base = (day, sessions = [], extra = {}) =>
  dayAttendance({ day, schedule: SCHEDULE, overrides: [], sessions, holidays: HOLIDAYS, leaves: [], overtimeThresholdMinutes: 480, graceMinutes: 0, now: NOW, ...extra });

describe("scheduledShift", () => {
  it("weekly pattern, then overrides", () => {
    assert.deepEqual(scheduledShift("2026-09-08", SCHEDULE, []), SHIFT); // Tue
    assert.equal(scheduledShift("2026-09-06", SCHEDULE, []), null); // Sun
    assert.deepEqual(scheduledShift("2026-09-06", SCHEDULE, [{ date: "2026-09-06", start: "09:00", end: "18:00", isRestDay: false }]), { start: "09:00", end: "18:00" });
    assert.equal(scheduledShift("2026-09-08", SCHEDULE, [{ date: "2026-09-08", start: null, end: null, isRestDay: true }]), null);
  });
});

describe("dayAttendance on an ordinary workday", () => {
  it("08:00-17:00 with the hour's break is eight paid hours, on time", () => {
    const d = base("2026-09-08", [session("2026-09-08", "08:00", "17:00")]);
    assert.equal(d.workedMinutes, 540);
    assert.equal(d.paidMinutes, 480);
    assert.equal(d.regularMinutes, 480);
    assert.equal(d.overtimeMinutes, 0);
    assert.equal(d.lateMinutes, 0);
    assert.equal(d.undertimeMinutes, 0);
    assert.equal(d.premium, "ordinary");
    assert.equal(d.flag, "on_time");
  });

  it("late 12 minutes with no grace; 0 with a 15-minute grace", () => {
    assert.equal(base("2026-09-08", [session("2026-09-08", "08:12", "17:00")]).lateMinutes, 12);
    assert.equal(base("2026-09-08", [session("2026-09-08", "08:12", "17:00")]).flag, "late");
    assert.equal(base("2026-09-08", [session("2026-09-08", "08:12", "17:00")], { graceMinutes: 15 }).lateMinutes, 0);
    // past the grace, only the excess is deducted
    assert.equal(base("2026-09-08", [session("2026-09-08", "08:20", "17:00")], { graceMinutes: 15 }).lateMinutes, 5);
  });

  it("undertime is never netted against overtime (Art. 88)", () => {
    // in at 07:00 (an hour early), out at 16:30: 9.5 h gross -> 8.5 h paid -> 30 min OT, AND 30 min undertime
    const d = base("2026-09-08", [session("2026-09-08", "07:00", "16:30")]);
    assert.equal(d.undertimeMinutes, 30);
    assert.equal(d.overtimeMinutes, 30);
    assert.equal(d.flag, "early_out");
  });

  it("no session, no leave -> absent", () => {
    const d = base("2026-09-09", []);
    assert.equal(d.absent, 1);
    assert.equal(d.flag, "absent");
  });

  it("no session with approved leave -> on leave, no absence; half-day leave is half an absence", () => {
    const leave = [{ from: "2026-09-09", to: "2026-09-09", startHalf: false, endHalf: false, paid: true, typeId: "vl" }];
    const d = base("2026-09-09", [], { leaves: leave });
    assert.equal(d.absent, 0);
    assert.equal(d.flag, "on_leave");
    const half = [{ from: "2026-09-09", to: "2026-09-09", startHalf: true, endHalf: false, paid: true, typeId: "vl" }];
    assert.equal(base("2026-09-09", [], { leaves: half }).absent, 0.5);
  });

  it("a short day keeps its gross minutes (no meal break deducted under five hours)", () => {
    const d = base("2026-09-08", [session("2026-09-08", "08:00", "12:00")]);
    assert.equal(d.paidMinutes, 240);
  });

  it("a session still open past 25 hours is a missed punch", () => {
    const d = base("2026-09-08", [session("2026-09-08", "08:00", null, "open")]);
    assert.equal(d.missedPunch, true);
    assert.equal(d.flag, "missed_punch");
  });

  it("a session still running earns no minutes yet (the DTR page's rule), and is not a missed punch", () => {
    const d = base("2026-09-08", [session("2026-09-08", "08:00", null, "open")], { now: "2026-09-08T10:00:00+08:00" });
    assert.equal(d.workedMinutes, 0);
    assert.equal(d.missedPunch, false);
  });

  it("two sessions in a day are summed, late from the first, undertime from the last", () => {
    const d = base("2026-09-08", [session("2026-09-08", "08:05", "12:00"), session("2026-09-08", "13:00", "16:45")]);
    assert.equal(d.workedMinutes, 460);
    assert.equal(d.paidMinutes, 400); // 460 >= 300 -> break deducted
    assert.equal(d.lateMinutes, 5);
    assert.equal(d.undertimeMinutes, 15);
  });
});

describe("rest days and holidays", () => {
  it("Sunday worked is a rest day premium, no late or absence", () => {
    const d = base("2026-09-06", [session("2026-09-06", "09:00", "14:00")]);
    assert.equal(d.dayClass, "rest_day");
    assert.equal(d.premium, "rest_day");
    assert.equal(d.lateMinutes, 0);
    assert.equal(d.absent, 0);
    assert.equal(base("2026-09-06", []).flag, "rest_day");
  });

  it("Dec 25 (Fri) worked is a regular holiday; unworked is not an absence", () => {
    assert.equal(base("2026-12-25", [session("2026-12-25", "08:00", "17:00")]).premium, "regular_holiday");
    const off = base("2026-12-25", [session("2026-12-24", "08:00", "17:00")]);
    assert.equal(off.absent, 0);
    assert.equal(off.flag, "holiday");
    assert.equal(off.eligibleForHolidayPay, true);
  });

  it("holiday pay eligibility needs presence (or paid leave) on the workday before", () => {
    assert.equal(base("2026-12-25", []).eligibleForHolidayPay, false);
    const leave = [{ from: "2026-12-24", to: "2026-12-24", startHalf: false, endHalf: false, paid: true, typeId: "sl" }];
    assert.equal(base("2026-12-25", [], { leaves: leave }).eligibleForHolidayPay, true);
  });

  it("Nov 1 (Sunday) worked is special on a rest day", () => {
    assert.equal(base("2026-11-01", [session("2026-11-01", "08:00", "12:00")]).premium, "special_on_rest_day");
  });

  it("a special WORKING day is an ordinary day", () => {
    const d = base("2026-02-25", [session("2026-02-25", "08:30", "17:00")]);
    assert.equal(d.premium, "ordinary");
    assert.equal(d.lateMinutes, 30);
  });

  it("a local holiday applies only in its city", () => {
    assert.equal(base("2026-06-24", [session("2026-06-24", "08:00", "17:00")]).premium, "ordinary");
    assert.equal(base("2026-06-24", [session("2026-06-24", "08:00", "17:00")], { city: "Manila" }).premium, "special_non_working");
  });
});

describe("night shift differential", () => {
  it("22:00-06:00 is 480 night minutes on the clock-in day", () => {
    const s = session("2026-09-08", "22:00", "2026-09-09T06:00");
    assert.equal(nightMinutes(s, NOW), 480);
  });

  it("night overtime is the night part of the last minutes worked", () => {
    // Scheduled 08:00-17:00 but worked 14:00 to 01:00 next day: 11 h gross, 10 h paid -> 2 h OT (23:00-01:00) all at night; night total 3 h (22:00-01:00)
    const d = base("2026-09-08", [session("2026-09-08", "14:00", "2026-09-09T01:00")]);
    assert.equal(d.overtimeMinutes, 120);
    assert.equal(d.nightMinutes, 180);
    assert.equal(d.nightOvertimeMinutes, 120);
  });

  it("an overnight override shift is judged against its own times", () => {
    const overrides = [{ date: "2026-09-08", start: "22:00", end: "06:00", isRestDay: false }];
    const d = base("2026-09-08", [session("2026-09-08", "22:10", "2026-09-09T06:00")], { overrides });
    assert.equal(d.lateMinutes, 10);
    assert.equal(d.undertimeMinutes, 0);
  });
});

describe("periodAttendance", () => {
  it("adds up a fortnight", () => {
    const sessions = [];
    for (const day of ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-14"]) {
      sessions.push(session(day, day === "2026-09-08" ? "08:15" : "08:00", "17:00"));
    }
    sessions.push(session("2026-09-05", "09:00", "13:00")); // Saturday
    const leaves = [{ from: "2026-09-15", to: "2026-09-15", startHalf: false, endHalf: false, paid: true, typeId: "vl" }];
    const p = periodAttendance({ from: "2026-09-01", to: "2026-09-15", schedule: SCHEDULE, overrides: [], sessions, holidays: HOLIDAYS, leaves, overtimeThresholdMinutes: 480, graceMinutes: 0, now: NOW });
    assert.equal(p.days.length, 15);
    assert.equal(p.totals.scheduledDays, 11); // Sep 1-4, 7-11, 14-15
    assert.equal(p.totals.daysWorked, 10);
    assert.equal(p.totals.absences, 0);
    assert.equal(p.totals.paidLeaveDays, 1);
    assert.equal(p.totals.lateMinutes, 15);
    assert.equal(p.totals.byPremium.ordinary.minutes, 480 * 10 - 15); // the late day is 8h45m gross -> 7h45m paid
    assert.equal(p.totals.byPremium.rest_day.minutes, 240);
    assert.equal(p.totals.byPremium.rest_day.days, 1);
  });

  it("no schedule at all: minutes count, nothing is late or absent", () => {
    const p = periodAttendance({ from: "2026-09-07", to: "2026-09-08", schedule: null, overrides: [], sessions: [session("2026-09-07", "09:00", "15:00")], holidays: [], leaves: [], overtimeThresholdMinutes: 480, graceMinutes: 0, now: NOW });
    assert.equal(p.totals.absences, 0);
    assert.equal(p.days[0].flag, "unscheduled");
    assert.equal(p.days[0].paidMinutes, 360);
  });
});
