// lib/utils/booking.ts: the words and small sums of LAF Activity Center Bookings (0172).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bookingMonths, bookingTotals, byNeedsAnswer, durationLabel, flowProblems, lastDayOf, minutesOf, monthCover, monthName, monthWeeks, participantsLabel, sameWeekdayIn, shiftMonth, slotsLine } from "../lib/utils/booking.ts";

describe("a program flow", () => {
  const slot = ["10:00", "12:00"];
  it("the owner's example fits: drawing 10 to 11, book reading 11 to 11:30, music jam 11:30 to 12", () => {
    const flow = [
      { activity: "Drawing", start: "10:00", end: "11:00" },
      { activity: "Book Reading", start: "11:00", end: "11:30" },
      { activity: "Music jam", start: "11:30", end: "12:00" },
    ];
    assert.deepEqual(flowProblems(flow, ...slot), []);
    assert.deepEqual(flow.map((f) => durationLabel(f.start, f.end)), ["1 h", "30 min", "30 min"]);
  });
  it("needs 1 to 3 activities", () => {
    assert.deepEqual(flowProblems([], ...slot), ["The program flow needs 1 to 3 activities."]);
    assert.equal(flowProblems(Array(4).fill({ activity: "Drawing", start: "10:00", end: "10:30" }), ...slot).length, 1);
  });
  it("names each problem by its activity", () => {
    assert.deepEqual(flowProblems([{ activity: "Drawing", start: "09:30", end: "10:30" }], ...slot), ["Activity 1: it must fit inside the slot."]);
    assert.deepEqual(flowProblems([{ activity: "Drawing", start: "11:00", end: "10:00" }], ...slot), ["Activity 1: the end time must be after the start time."]);
    assert.deepEqual(flowProblems([{ activity: "Drawing", start: "10:00", end: "11:00" }, { activity: "Reading", start: "10:30", end: "11:30" }], ...slot), ["Activity 2: it starts before the one before it has ended."]);
    assert.deepEqual(flowProblems([{ activity: " ", start: "10:00", end: "", }], ...slot), ["Activity 1: please name the activity.", "Activity 1: please give its start and end time."]);
  });
  it("a gap between activities is allowed", () => {
    assert.deepEqual(flowProblems([{ activity: "Drawing", start: "10:00", end: "10:45" }, { activity: "Reading", start: "11:00", end: "12:00" }], ...slot), []);
  });
});

describe("small sums", () => {
  it("reads a time and tells a duration", () => {
    assert.equal(minutesOf("10:30"), 630);
    assert.ok(Number.isNaN(minutesOf("25:00")));
    assert.equal(durationLabel("10:00", "11:30"), "1 h 30 min");
    assert.equal(durationLabel("11:00", "10:00"), "");
  });
  it("says who an activity is for", () => {
    assert.equal(participantsLabel({ who: "patients", ages: "4 to 12", gender: "girls", note: "" }), "Patients only · ages 4 to 12 · girls");
    assert.equal(participantsLabel({ who: "both", ages: "", gender: "all", note: "ward 3" }), "Patients and carers · ward 3");
  });
  it("puts the requests that wait first, soonest day first; the rest newest first", () => {
    const rows = [
      { status: "approved", date: "2026-12-10", start: "10:00" },
      { status: "pending", date: "2026-12-18", start: "10:00" },
      { status: "completed", date: "2026-12-01", start: "10:00" },
      { status: "pending", date: "2026-12-11", start: "10:00" },
    ];
    assert.deepEqual([...rows].sort(byNeedsAnswer).map((r) => `${r.status} ${r.date.slice(8)}`), ["pending 11", "pending 18", "approved 10", "completed 01"]);
  });
  it("lays a month out in weeks, Sunday first", () => {
    const weeks = monthWeeks("2026-11"); // 1 November 2026 is a Sunday; 30 days
    assert.equal(weeks.length, 5);
    assert.deepEqual(weeks[0], ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"]);
    assert.deepEqual(weeks[4].slice(0, 3), ["2026-11-29", "2026-11-30", null]);
    assert.equal(monthWeeks("2026-12")[0][0], null); // 1 December is a Tuesday
    assert.equal(monthWeeks("2026-12")[0][2], "2026-12-01");
  });
  it("names a month and what a plan covers: the 1st to the last day", () => {
    assert.equal(monthName("2026-12"), "December 2026");
    assert.equal(monthCover("2026-12"), "December 1 to 31, 2026");
    assert.equal(monthCover("2027-02"), "February 1 to 28, 2027");
  });
  it("says the weekly slots in a sentence", () => {
    const def = [1, 2, 4, 5].map((weekday) => ({ weekday, start: "10:00", end: "12:00" }));
    assert.equal(slotsLine(def), "Monday, Tuesday, Thursday and Friday, 10:00 AM to 12:00 PM");
    assert.equal(slotsLine([...def, { weekday: 3, start: "14:00", end: "15:00" }]), "Monday, Tuesday, Thursday and Friday, 10:00 AM to 12:00 PM; Wednesday, 2:00 PM to 3:00 PM");
    assert.equal(slotsLine([]), "");
  });
  it("carries a plan's day to the same weekday of the same week in another month", () => {
    assert.equal(sameWeekdayIn("2026-11-12", "2026-12"), "2026-12-10"); // 2nd Thursday -> 2nd Thursday
    assert.equal(sameWeekdayIn("2026-12-01", "2027-01"), "2027-01-05"); // 1st Tuesday -> 1st Tuesday
    assert.equal(sameWeekdayIn("2026-11-30", "2026-12"), null); // a 5th Monday: December 2026 has only four
    assert.equal(sameWeekdayIn("2026-12-31", "2027-01"), null); // a 5th Thursday: January 2027 has only four
    assert.equal(sameWeekdayIn("2026-10-29", "2026-12"), "2026-12-31"); // a 5th Thursday that does exist
  });
  it("steps between months and finds a month's last day", () => {
    assert.equal(shiftMonth("2026-12", 1), "2027-01");
    assert.equal(shiftMonth("2027-01", -1), "2026-12");
    assert.equal(lastDayOf("2027-02"), "2027-02-28");
  });
});

describe("the bookings report", () => {
  const r = (date, status, c = null, v = null, h = null) => ({ date, status, attendedChildren: c, attendedVolunteers: v, attendedHours: h });
  const rows = [
    r("2026-12-10", "completed", 12, 5, 2),
    r("2026-12-11", "completed", 8, 4, 1.5),
    r("2026-12-14", "no_show"),
    r("2026-12-15", "approved"),
    r("2026-12-17", "pending"),
    r("2026-12-18", "declined"),
    r("2026-11-30", "cancelled"),
    r("2027-01-05", "approved"),
  ];
  it("counts by the month of the visit, and takes children, volunteers and hours only from recorded visits", () => {
    const months = bookingMonths(rows, 2026);
    assert.equal(months.length, 12);
    assert.deepEqual(months[11], { month: "2026-12", requests: 6, pending: 1, upcoming: 1, visits: 2, noShow: 1, declined: 1, cancelled: 0, children: 20, volunteers: 9, hours: 3.5 });
    assert.equal(months[10].cancelled, 1);
    assert.equal(months[0].requests, 0);
  });
  it("leaves another year out and adds the year up", () => {
    const totals = bookingTotals(bookingMonths(rows, 2026));
    assert.deepEqual(totals, { requests: 7, pending: 1, upcoming: 1, visits: 2, noShow: 1, declined: 1, cancelled: 1, children: 20, volunteers: 9, hours: 3.5 });
    assert.equal(bookingTotals(bookingMonths(rows, 2027)).requests, 1);
  });
});
