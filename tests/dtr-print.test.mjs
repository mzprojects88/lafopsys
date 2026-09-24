// Unit tests for lib/utils/dtr-print.ts -- the printed DTR's lines (DTR phase 5).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dtrPrintRows } from "../lib/utils/dtr-print.ts";

// Manila = UTC+8: 08:00 Manila is 00:00Z.
const p = (id, type, iso, extra = {}) => ({ id, staffId: "s", punchType: type, punchedAt: iso, source: "device", siteStatus: "on_site", ...extra });
const punches = [
  p("a", "clock_in", "2026-09-16T00:00:00.000Z"),
  p("b", "clock_out", "2026-09-16T09:00:00.000Z"),
  p("c", "clock_in", "2026-09-17T00:30:00.000Z", { siteStatus: "off_site" }),
  p("d", "clock_out", "2026-09-17T08:30:00.000Z", { source: "adjustment", siteStatus: "unknown" }),
  p("e", "clock_in", "2026-09-18T00:00:00.000Z"),
  p("x", "clock_in", "2026-09-16T01:00:00.000Z", { staffId: "other" }),
];

describe("dtrPrintRows", () => {
  const { rows, totalMinutes, daysPresent } = dtrPrintRows(punches, "s", "2026-09-16", "2026-09-19", "2026-09-24");
  it("one line per day of the period, with the weekday", () => {
    assert.deepEqual(rows.map((r) => `${r.weekday} ${r.day}`), ["Wed 2026-09-16", "Thu 2026-09-17", "Fri 2026-09-18", "Sat 2026-09-19"]);
  });
  it("arrival, departure and hours in Manila time", () => {
    assert.deepEqual(rows[0].sessions, [{ in: "08:00", out: "17:00" }]);
    assert.equal(rows[0].minutes, 540);
    assert.deepEqual(rows[0].remarks, []);
  });
  it("says what was corrected, what was off-site, and what was never closed", () => {
    assert.deepEqual(rows[1].remarks, ["Time corrected (approved)", "Off-site"]);
    assert.deepEqual(rows[2].remarks, ["No clock-out"]);
    assert.equal(rows[2].minutes, 0);
    assert.deepEqual(rows[3].sessions, []);
  });
  it("totals count only closed sessions; days present count any", () => {
    assert.equal(totalMinutes, 540 + 480);
    assert.equal(daysPresent, 3);
  });
});
