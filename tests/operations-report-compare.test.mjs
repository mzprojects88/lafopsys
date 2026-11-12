// lib/utils/operations-report.ts (Reports release 1): totals with variance, year to date and the year's goal.
import { it } from "node:test";
import assert from "node:assert/strict";
import { operationsReport } from "../lib/utils/operations-report.ts";
import { periodGrain } from "../lib/utils/program-impact.ts";

const row = (bucket, native) => ({ line: "housing", bucket, native, fromSheet: 0 });
const base = {
  sections: ["housing"], buckets: [{ key: "2026-10-01", label: "Oct" }], extras: {}, period: "Oct 2026", previousPeriod: "Sep 2026",
  rows: [row("2026-10-01", 788)], previous: [row("2026-09-01", 628)], ytdRows: [row("2026-01-01", 5000), row("2026-10-01", 788)], ytdLabel: "YTD 2026", goalYear: 2026,
};

it("totals only: the period, the one before, the variance, the year to date", () => {
  const s = operationsReport({ ...base, totalsOnly: true }).spec.sections[0];
  assert.deepEqual(s.table.columns, ["Figure", "Oct 2026", "Sep 2026", "Variance", "%", "YTD 2026"]);
  assert.deepEqual(s.table.rows[0].slice(1), [788, 628, 160, "+25%", 5788]);
  assert.equal(s.kpis[0].change, "+160 (+25%)");
  assert.deepEqual(s.chart.labels, ["Sep 2026", "Oct 2026"]);
});

it("a goal adds its row and columns, set against the year to date", () => {
  const s = operationsReport({ ...base, totalsOnly: true, goals: { Housing: { label: "House more families", lines: ["housing"], target: 7000 } } }).spec.sections[0];
  assert.deepEqual(s.table.columns.slice(-2), ["Goal 2026", "% of goal"]);
  assert.deepEqual(s.table.rows.at(-1).slice(-3), [5788, 7000, "83%"]);
});

it("by columns keeps the buckets and adds the year to date; the grain follows the dashboard", () => {
  const s = operationsReport({ ...base, totalsOnly: false }).spec.sections[0];
  assert.deepEqual(s.table.columns, ["Line", "Oct", "Total", "YTD 2026"]);
  assert.equal(periodGrain({ from: "2026-10-01", to: "2026-10-31" }), "week");
  assert.equal(periodGrain({ from: "2026-11-09", to: "2026-11-15" }), "day");
  assert.equal(periodGrain({ from: "2026-01-01", to: "2026-12-31" }), "month");
});
