// The report ranges (Nov 2026): the previous range every report compares itself with, custom
// windows and the grain a window is naturally broken into.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { naturalGrain, periodLabel, previousWindow, resolveRange, windowDays } from "../lib/utils/period.ts";

describe("previousWindow", () => {
  it("steps calendar periods back by one", () => {
    assert.deepEqual(previousWindow("month", { from: "2026-11-01", to: "2026-11-30" }), { from: "2026-10-01", to: "2026-10-31" });
    assert.deepEqual(previousWindow("week", { from: "2026-11-02", to: "2026-11-08" }), { from: "2026-10-26", to: "2026-11-01" });
    assert.deepEqual(previousWindow("year", { from: "2026-01-01", to: "2026-12-31" }), { from: "2025-01-01", to: "2025-12-31" });
    assert.deepEqual(previousWindow("quarter", { from: "2026-01-01", to: "2026-03-31" }), { from: "2025-10-01", to: "2025-12-31" });
  });
  it("uses the same number of days just before a day or custom range", () => {
    assert.deepEqual(previousWindow("today", { from: "2026-11-05", to: "2026-11-05" }), { from: "2026-11-04", to: "2026-11-04" });
    assert.deepEqual(previousWindow("custom", { from: "2026-11-01", to: "2026-11-10" }), { from: "2026-10-22", to: "2026-10-31" });
  });
});

describe("resolveRange and labels", () => {
  it("builds the window from the anchor, or the custom days when they make sense", () => {
    assert.deepEqual(resolveRange("month", "2026-11-05"), { from: "2026-11-01", to: "2026-11-30" });
    assert.deepEqual(resolveRange("custom", "2026-11-05", "2026-10-20", "2026-11-02"), { from: "2026-10-20", to: "2026-11-02" });
    assert.deepEqual(resolveRange("custom", "2026-11-05", "2026-11-09", "2026-11-02"), { from: "2026-11-01", to: "2026-11-30" });
  });
  it("labels a custom range like a week, and a one-day range as a day", () => {
    assert.equal(periodLabel("custom", { from: "2026-10-20", to: "2026-11-02" }), "Oct 20 – Nov 2, 2026");
    assert.equal(periodLabel("custom", { from: "2026-11-05", to: "2026-11-05" }), "Nov 5, 2026");
  });
  it("counts days and picks a grain", () => {
    assert.equal(windowDays({ from: "2026-11-01", to: "2026-11-30" }), 30);
    assert.equal(naturalGrain({ from: "2026-11-01", to: "2026-11-30" }), "day");
    assert.equal(naturalGrain({ from: "2026-01-01", to: "2026-12-31" }), "week");
    assert.equal(naturalGrain({ from: "2025-01-01", to: "2026-12-31" }), "month");
  });
});
