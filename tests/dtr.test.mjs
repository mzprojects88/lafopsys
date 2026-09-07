// Unit tests for lib/utils/dtr.ts -- the one place sessions and hours are computed.
// Run with `npm test` (node --test; Node strips the .ts types natively).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  dayKey,
  entryTotals,
  effectiveStatus,
  formatMinutes,
  pairSessions,
  sessionMinutes,
  splitOvertime,
  timeLabel,
  totalsFor,
  weekKey,
  zonedDayStart,
  MAX_SESSION_MINUTES,
} from "../lib/utils/dtr.ts";

/** Manila wall-clock -> ISO instant (Manila is UTC+8, no DST). */
function manila(dateTime) {
  return new Date(`${dateTime}+08:00`).toISOString();
}

let seq = 0;
function punch(staffId, punchType, at, extra = {}) {
  seq += 1;
  return { id: `p${String(seq).padStart(3, "0")}`, staffId, punchType, punchedAt: manila(at), ...extra };
}

describe("timezone helpers", () => {
  it("dayKey/timeLabel use Manila, not UTC", () => {
    // 23:30 UTC on the 3rd is 07:30 on the 4th in Manila.
    const at = "2026-09-03T23:30:00Z";
    assert.equal(dayKey(at), "2026-09-04");
    assert.equal(timeLabel(at), "07:30");
    assert.equal(timeLabel("2026-09-03T16:00:00Z"), "00:00");
  });

  it("zonedDayStart is Manila midnight and round-trips through dayKey", () => {
    const start = zonedDayStart("2026-09-04");
    assert.equal(start.toISOString(), "2026-09-03T16:00:00.000Z");
    assert.equal(dayKey(start), "2026-09-04");
    assert.equal(dayKey(new Date(start.getTime() - 1)), "2026-09-03");
  });

  it("addDays and weekKey (Monday start) cross month boundaries", () => {
    assert.equal(addDays("2026-08-31", 1), "2026-09-01");
    assert.equal(addDays("2026-09-01", -1), "2026-08-31");
    // 2026-09-02 is a Wednesday; its week starts Monday 2026-08-31.
    assert.equal(weekKey("2026-09-02"), "2026-08-31");
    assert.equal(weekKey("2026-08-31"), "2026-08-31");
    // Sunday belongs to the week that started the previous Monday.
    assert.equal(weekKey("2026-09-06"), "2026-08-31");
  });
});

describe("pairSessions", () => {
  it("pairs a single in/out", () => {
    const s = pairSessions([punch("a", "clock_in", "2026-09-04T08:00:00"), punch("a", "clock_out", "2026-09-04T12:00:00")]);
    assert.equal(s.length, 1);
    assert.equal(s[0].status, "closed");
    assert.equal(s[0].dayKey, "2026-09-04");
    assert.equal(sessionMinutes(s[0], new Date()), 240);
  });

  it("keeps every session of a day and accepts newest-first input", () => {
    const punches = [
      punch("a", "clock_in", "2026-09-04T08:00:00"),
      punch("a", "clock_out", "2026-09-04T12:00:00"),
      punch("a", "clock_in", "2026-09-04T13:00:00"),
      punch("a", "clock_out", "2026-09-04T17:30:00"),
    ].reverse();
    const s = pairSessions(punches);
    assert.equal(s.length, 2);
    assert.deepEqual(
      s.map((x) => sessionMinutes(x, 0)),
      [240, 270]
    );
    assert.deepEqual(entryTotals(s, "2026-09-04", "a"), { totalMinutes: 510, sessionCount: 2 });
  });

  it("an open session ticks with now and stops past the cap", () => {
    const s = pairSessions([punch("a", "clock_in", "2026-09-04T08:00:00")]);
    assert.equal(s[0].status, "open");
    assert.equal(sessionMinutes(s[0], manila("2026-09-04T09:15:00")), 75);
    assert.equal(effectiveStatus(s[0], manila("2026-09-04T09:15:00")), "open");
    const late = new Date(new Date(manila("2026-09-04T08:00:00")).getTime() + (MAX_SESSION_MINUTES + 1) * 60_000);
    assert.equal(sessionMinutes(s[0], late), 0);
    assert.equal(effectiveStatus(s[0], late), "missed_out");
    // Open sessions are counted, not summed, on the persisted row.
    assert.deepEqual(entryTotals(s, "2026-09-04", "a"), { totalMinutes: 0, sessionCount: 1 });
  });

  it("an overnight session belongs to the day it was clocked in", () => {
    const s = pairSessions([punch("a", "clock_in", "2026-09-04T22:00:00"), punch("a", "clock_out", "2026-09-05T02:00:00")]);
    assert.equal(s[0].dayKey, "2026-09-04");
    assert.equal(sessionMinutes(s[0], 0), 240);
    const totals = totalsFor(s, { now: manila("2026-09-05T03:00:00") });
    assert.equal(totals.today, 0);
    assert.equal(totals.week, 240);
    assert.equal(totals.month, 240);
  });

  it("a second clock-in on the same day while open is a duplicate", () => {
    const s = pairSessions([
      punch("a", "clock_in", "2026-09-04T08:00:00"),
      punch("a", "clock_in", "2026-09-04T08:00:03"),
      punch("a", "clock_out", "2026-09-04T12:00:00"),
    ]);
    assert.equal(s.length, 1);
    assert.equal(sessionMinutes(s[0], 0), 240);
  });

  it("a clock-in on a later day closes a forgotten session as missed_out", () => {
    const s = pairSessions([punch("a", "clock_in", "2026-09-03T08:00:00"), punch("a", "clock_in", "2026-09-04T08:00:00")]);
    assert.equal(s.length, 2);
    assert.equal(s[0].status, "missed_out");
    assert.equal(sessionMinutes(s[0], 0), 0);
    assert.equal(s[1].status, "open");
    assert.deepEqual(entryTotals(s, "2026-09-03", "a"), { totalMinutes: 0, sessionCount: 1 });
  });

  it("a clock-out with nothing open is an orphan worth nothing", () => {
    const s = pairSessions([punch("a", "clock_out", "2026-09-04T12:00:00")]);
    assert.equal(s[0].status, "orphan_out");
    assert.equal(sessionMinutes(s[0], 0), 0);
    assert.deepEqual(entryTotals(s, "2026-09-04", "a"), { totalMinutes: 0, sessionCount: 0 });
  });

  it("keeps staff members apart", () => {
    const s = pairSessions([
      punch("a", "clock_in", "2026-09-04T08:00:00"),
      punch("b", "clock_in", "2026-09-04T08:05:00"),
      punch("a", "clock_out", "2026-09-04T12:00:00"),
    ]);
    assert.equal(s.length, 2);
    assert.equal(s.find((x) => x.staffId === "a").status, "closed");
    assert.equal(s.find((x) => x.staffId === "b").status, "open");
  });
});

describe("totalsFor", () => {
  it("buckets by Manila day, Monday week and month, and filters by staff", () => {
    const s = pairSessions([
      punch("a", "clock_in", "2026-08-31T08:00:00"), // Monday, previous month, same week as the 2nd
      punch("a", "clock_out", "2026-08-31T10:00:00"),
      punch("a", "clock_in", "2026-09-02T08:00:00"),
      punch("a", "clock_out", "2026-09-02T09:00:00"),
      punch("b", "clock_in", "2026-09-02T08:00:00"),
      punch("b", "clock_out", "2026-09-02T08:30:00"),
      punch("a", "clock_in", "2026-09-02T14:00:00"),
    ]);
    const now = manila("2026-09-02T15:00:00");
    assert.deepEqual(totalsFor(s, { now, staffIds: ["a"] }), { today: 120, week: 240, month: 120, openCount: 1 });
    assert.deepEqual(totalsFor(s, { now }), { today: 150, week: 270, month: 150, openCount: 1 });
    assert.deepEqual(totalsFor(s, { now, staffIds: ["nobody"] }), { today: 0, week: 0, month: 0, openCount: 0 });
  });
});

describe("formatMinutes", () => {
  it("renders hours and minutes", () => {
    assert.equal(formatMinutes(0), "0h 0m");
    assert.equal(formatMinutes(75), "1h 15m");
    assert.equal(formatMinutes(510), "8h 30m");
  });
});

describe("splitOvertime", () => {
  it("leaves a normal day entirely regular", () => {
    assert.deepEqual(splitOvertime(480), { regular: 480, overtime: 0 });
    assert.deepEqual(splitOvertime(300), { regular: 300, overtime: 0 });
  });

  it("counts minutes past the threshold as overtime", () => {
    assert.deepEqual(splitOvertime(570), { regular: 480, overtime: 90 });
  });

  it("measures the day as a whole, not each session", () => {
    // Two five-hour sessions is a ten-hour day: eight regular, two over --
    // not two short days that each fall under the threshold.
    assert.deepEqual(splitOvertime(300 + 300), { regular: 480, overtime: 120 });
  });

  it("follows a threshold the admin changed", () => {
    assert.deepEqual(splitOvertime(570, 600), { regular: 570, overtime: 0 });
    assert.deepEqual(splitOvertime(570, 360), { regular: 360, overtime: 210 });
  });

  it("has nothing to split on an empty day", () => {
    assert.deepEqual(splitOvertime(0), { regular: 0, overtime: 0 });
    assert.deepEqual(splitOvertime(-5), { regular: 0, overtime: 0 });
  });
});

describe("a supplied clock-out on consecutive forgotten days", () => {
  // Production had four days in a row clocked into and never out of. When an
  // admin supplies the missing time, the danger is that a clock-out timed
  // after the NEXT day's clock-in closes that day's session instead --
  // silently crediting the hours to the wrong day. app/api/dtr/adjust checks
  // exactly this before it writes anything; these pin the behaviour it checks.
  const day1In = punch("s1", "clock_in", "2026-08-27T06:00");
  const day2In = punch("s1", "clock_in", "2026-08-28T05:06");

  it("closes the intended day when the time is before the next clock-in", () => {
    const supplied = punch("s1", "clock_out", "2026-08-27T17:00");
    const sessions = pairSessions([day1In, day2In, supplied]);
    const closed = sessions.find((s) => s.clockOutAt === supplied.punchedAt);
    assert.equal(closed.dayKey, "2026-08-27");
    assert.equal(closed.status, "closed");
    assert.equal(entryTotals(sessions, "2026-08-27", "s1").totalMinutes, 11 * 60);
  });

  it("closes the FOLLOWING day when the time falls after its clock-in", () => {
    // 08-28 08:00 is after 08-28's own 05:06 clock-in, so pairing attaches it
    // there and 08-27 stays a missed clock-out worth nothing. The route
    // refuses this rather than writing it.
    const supplied = punch("s1", "clock_out", "2026-08-28T08:00");
    const sessions = pairSessions([day1In, day2In, supplied]);
    const closed = sessions.find((s) => s.clockOutAt === supplied.punchedAt);
    assert.equal(closed.dayKey, "2026-08-28");
    assert.equal(entryTotals(sessions, "2026-08-27", "s1").totalMinutes, 0);
  });

  it("still allows a genuine overnight clock-out before the next shift", () => {
    const lateIn = punch("s1", "clock_in", "2026-08-30T22:00");
    const supplied = punch("s1", "clock_out", "2026-08-31T02:00");
    const sessions = pairSessions([lateIn, supplied]);
    const closed = sessions.find((s) => s.clockOutAt === supplied.punchedAt);
    assert.equal(closed.dayKey, "2026-08-30");
    assert.equal(entryTotals(sessions, "2026-08-30", "s1").totalMinutes, 4 * 60);
  });
});
