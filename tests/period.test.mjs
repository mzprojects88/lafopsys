// Unit tests for lib/utils/period.ts -- the calendar's Today / Week / Month /
// Quarter / Year windows. Pure string arithmetic on day keys, so these pass
// the same on a Manila laptop and a UTC build server.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  inWindow,
  monthEnd,
  monthGridDays,
  monthStart,
  periodLabel,
  periodWindow,
  quarterKey,
  shiftAnchor,
} from "../lib/utils/period.ts";

describe("periodWindow", () => {
  it("today is a single day", () => {
    assert.deepEqual(periodWindow("today", "2026-09-07"), { from: "2026-09-07", to: "2026-09-07" });
  });

  it("weeks run Monday to Sunday, like payroll", () => {
    // 2026-09-07 is a Monday; 2026-09-13 is the Sunday of that week.
    assert.deepEqual(periodWindow("week", "2026-09-07"), { from: "2026-09-07", to: "2026-09-13" });
    assert.deepEqual(periodWindow("week", "2026-09-13"), { from: "2026-09-07", to: "2026-09-13" });
    assert.deepEqual(periodWindow("week", "2026-09-14"), { from: "2026-09-14", to: "2026-09-20" });
  });

  it("months end on the right day, February included", () => {
    assert.deepEqual(periodWindow("month", "2026-09-07"), { from: "2026-09-01", to: "2026-09-30" });
    assert.deepEqual(periodWindow("month", "2028-02-10"), { from: "2028-02-01", to: "2028-02-29" });
    assert.deepEqual(periodWindow("month", "2027-02-10"), { from: "2027-02-01", to: "2027-02-28" });
  });

  it("quarters floor to Jan / Apr / Jul / Oct", () => {
    assert.deepEqual(periodWindow("quarter", "2026-09-07"), { from: "2026-07-01", to: "2026-09-30" });
    assert.deepEqual(periodWindow("quarter", "2026-01-31"), { from: "2026-01-01", to: "2026-03-31" });
    assert.deepEqual(periodWindow("quarter", "2026-12-25"), { from: "2026-10-01", to: "2026-12-31" });
    assert.equal(quarterKey("2026-09-07"), "2026-Q3");
  });

  it("a year is the calendar year", () => {
    assert.deepEqual(periodWindow("year", "2026-09-07"), { from: "2026-01-01", to: "2026-12-31" });
  });
});

describe("inWindow", () => {
  it("is inclusive at both ends", () => {
    const w = periodWindow("week", "2026-09-07");
    assert.equal(inWindow("2026-09-07", w), true);
    assert.equal(inWindow("2026-09-13", w), true);
    assert.equal(inWindow("2026-09-14", w), false);
    assert.equal(inWindow("2026-09-06", w), false);
  });
});

describe("shiftAnchor", () => {
  it("moves by one period", () => {
    assert.equal(shiftAnchor("today", "2026-09-07", 1), "2026-09-08");
    assert.equal(shiftAnchor("week", "2026-09-07", -1), "2026-08-31");
    assert.equal(shiftAnchor("quarter", "2026-09-07", 1), "2026-12-07");
    assert.equal(shiftAnchor("year", "2026-09-07", -1), "2025-09-07");
  });

  it("does not invent 31 February", () => {
    assert.equal(shiftAnchor("month", "2026-01-31", 1), "2026-02-28");
    assert.equal(shiftAnchor("month", "2026-12-15", 1), "2027-01-15");
    assert.equal(shiftAnchor("month", "2026-01-15", -1), "2025-12-15");
  });
});

describe("monthGridDays", () => {
  it("is six full Monday-first weeks", () => {
    const days = monthGridDays("2026-09");
    assert.equal(days.length, 42);
    // 1 Sep 2026 is a Tuesday, so the grid opens on Monday 31 Aug.
    assert.equal(days[0], "2026-08-31");
    assert.equal(days[1], "2026-09-01");
    assert.equal(days[41], "2026-10-11");
  });

  it("opens on the 1st itself when that is a Monday", () => {
    // 1 Jun 2026 is a Monday.
    assert.equal(monthGridDays("2026-06")[0], "2026-06-01");
  });
});

describe("labels and bounds", () => {
  it("formats each kind", () => {
    assert.equal(periodLabel("today", periodWindow("today", "2026-09-07")), "Sep 7, 2026");
    assert.equal(periodLabel("week", periodWindow("week", "2026-09-07")), "Sep 7 – Sep 13, 2026");
    assert.equal(periodLabel("week", periodWindow("week", "2026-12-30")), "Dec 28, 2026 – Jan 3, 2027");
    assert.equal(periodLabel("month", periodWindow("month", "2026-09-07")), "Sep 2026");
    assert.equal(periodLabel("quarter", periodWindow("quarter", "2026-09-07")), "Q3 2026");
    assert.equal(periodLabel("year", periodWindow("year", "2026-09-07")), "2026");
  });

  it("monthStart / monthEnd", () => {
    assert.equal(monthStart("2026-09-17"), "2026-09-01");
    assert.equal(monthEnd("2026-09-17"), "2026-09-30");
  });
});
