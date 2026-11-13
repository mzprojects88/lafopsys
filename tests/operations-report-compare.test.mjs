// lib/utils/operations-report.ts (Reports release 1): totals with variance, year to date and the year's goal.
import { it } from "node:test";
import assert from "node:assert/strict";
import { operationsReport } from "../lib/utils/operations-report.ts";
import { periodGrain } from "../lib/utils/program-impact.ts";

const row = (bucket, native) => ({ line: "housing", bucket, native, fromSheet: 0 });
const base = {
  sections: ["housing"], buckets: [{ key: "2026-10-01", label: "Oct" }], extras: {}, period: "Oct 2026", previousPeriod: "Sep 2026",
  rows: [row("2026-10-01", 788)], previous: [row("2026-09-01", 628)], ytdRows: [row("2026-01-01", 5000)], ytdLabel: "YTD 2026", goalYear: 2026,
};

it("totals only: the period, the one before, the variance, the year to date", () => {
  const s = operationsReport({ ...base, totalsOnly: true }).spec.sections[0];
  assert.deepEqual(s.table.columns, ["Figure", "Oct 2026", "Sep 2026", "Variance", "YTD 2026"]);
  assert.deepEqual(s.table.rows[0].slice(1), [788, 628, "+160 (+25%)", 5788]);
  assert.equal(s.kpis[0].change, "+25%");
  assert.deepEqual(s.chart.labels, ["Sep 2026", "Oct 2026"]);
});

it("a goal adds its row and columns, set against the year to date", () => {
  const s = operationsReport({ ...base, totalsOnly: true, goals: { Housing: { label: "House more families", lines: ["housing"], target: 7000 } } }).spec.sections[0];
  assert.equal(s.table.columns.at(-1), "Goal 2026");
  assert.deepEqual(s.table.rows.at(-1).slice(-2), [5788, "7,000 (83%)"]);
  assert.equal(s.kpis.length, 1);
});

it("by columns keeps the buckets and adds the year to date; the grain follows the dashboard", () => {
  const s = operationsReport({ ...base, totalsOnly: false }).spec.sections[0];
  assert.deepEqual(s.table.columns, ["Line", "Oct", "Total", "YTD 2026"]);
  assert.equal(periodGrain({ from: "2026-10-01", to: "2026-10-31" }), "week");
  assert.equal(periodGrain({ from: "2026-11-09", to: "2026-11-15" }), "day");
  assert.equal(periodGrain({ from: "2026-01-01", to: "2026-12-31" }), "month");
});

it("a profile's comparisons choose the columns; its drawing drops the chart or the table", () => {
  const s = operationsReport({ ...base, totalsOnly: true, comparisons: ["ytd"], styles: { housing: "table" } }).spec.sections[0];
  assert.deepEqual(s.table.columns, ["Figure", "Oct 2026", "YTD 2026"]);
  assert.equal(s.chart, undefined);
  const f = operationsReport({ ...base, totalsOnly: true, styles: { housing: "figures" } }).spec.sections[0];
  assert.equal(f.table, undefined);
  assert.ok(f.kpis.length > 0);
});

it("a part (gifts in kind: food) is in the boxes and the table but not the chart", () => {
  const donations = { figures: [
    { label: "Gifts in kind", value: 100, previous: 80, ytd: 900, unit: "PHP" },
    { label: "Gifts in kind: food", value: 60, previous: 50, ytd: 500, unit: "PHP", part: true },
    { label: "Gifts in kind: non-food", value: 40, previous: 30, ytd: 400, unit: "PHP", part: true },
  ], rows: [] };
  const s = operationsReport({ ...base, sections: ["donations"], extras: { donations }, totalsOnly: true }).spec.sections[0];
  assert.equal(s.kpis.length, 3);
  assert.equal(s.table.rows.length, 3);
  assert.deepEqual(s.chart.series.map((x) => x.label), ["Gifts in kind"]);
});

it("the expenses section: by account and by fund, in the profile's order, with its title", () => {
  const expenses = {
    figures: [{ label: "Paid", value: 1000, previous: 500, ytd: 4000, unit: "PHP" }],
    byAccount: [{ label: "5932 Travels and meals", amount: 600 }, { label: "5100 Supplies", amount: 400 }],
    byFund: [{ label: "One Child (OC)", amount: 700 }, { label: "Unrestricted (UNR)", amount: 300 }],
    note: "Paid vouchers.",
  };
  const spec = operationsReport({ ...base, sections: ["expenses", "housing"], extras: { expenses }, totalsOnly: false, title: "Financial report" }).spec;
  assert.equal(spec.title, "Financial report");
  assert.deepEqual(spec.sections.map((x) => x.heading), ["Expenses", "Expenses by account", "Expenses by fund", "Housing"]);
  assert.equal(spec.sections[0].table.columns[0], "Figure");
  assert.deepEqual(spec.sections[1].table.rows, [["5932 Travels and meals", 600], ["5100 Supplies", 400]]);
  assert.equal(spec.sections[1].chart.kind, "rank");
  // Sideways bars draw one series: a chart of several keeps its kind; the YTD column follows the profile.
  const r = operationsReport({ ...base, totalsOnly: true, styles: { housing: "rank" }, comparisons: ["previous"] }).spec.sections[0];
  assert.equal(r.chart.kind, "rank");
  const c = operationsReport({ ...base, totalsOnly: false, comparisons: ["previous"] }).spec.sections[0];
  assert.deepEqual(c.table.columns, ["Line", "Oct", "Total"]);
});
