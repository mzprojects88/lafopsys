// Report graphs (0152): the sample graphs pass the rules and draw, every type draws, the print route keeps them,
// a totals section's own graph is the scorecard, and a profile's graphs land where they're placed.
import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { operationsReport } from "../lib/utils/operations-report.ts";
import { GRAPH_TYPES, graphProblem, graphRules, resolveGraph, sampleFigure } from "../lib/utils/report-graphs.ts";
import { chartSvg } from "../lib/pdf/charts.ts";
import { cleanSpec } from "../lib/pdf/clean-spec.ts";
import { buildReportPdf } from "../lib/pdf/report-doc.ts";

const sql = readFileSync(new URL("../supabase/migrations/0152_report_graphs.sql", import.meta.url), "utf8");
const seed = sql.slice(sql.indexOf("graphs-seed: begin"), sql.indexOf("graphs-seed: end"));
const seeded = [...seed.matchAll(/\('([a-z ]+)', '(\[[\s\S]*?\])'::jsonb\)/g)].map((m) => ({ profile: m[1], graphs: JSON.parse(m[2]) }));

const ctxWith = (ids) => ({
  figures: new Map(ids.map((id) => [id, sampleFigure(id, 5, 11)])),
  sets: new Map([["expenses.by_account", [{ label: "5100 Food", amount: 900 }, { label: "5210 Utilities", amount: 300 }]]]),
  period: "Nov 2026", previousPeriod: "Oct 2026", ytdLabel: "YTD 2026", goalYear: 2026,
  bucketLabels: ["W1", "W2", "W3", "W4", "W5"], monthLabels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov"],
  perYear: 52, comparisons: new Set(["previous", "ytd", "goal"]), pace: 0.87,
});

it("every built-in profile gets 2-3 sample graphs, each within the rules and drawn without gaps", () => {
  assert.equal(seeded.length, 5);
  for (const { profile, graphs } of seeded) {
    assert.ok(graphs.length >= 2 && graphs.length <= 3, profile);
    for (const g of graphs) {
      assert.equal(graphProblem(g), null, `${profile}: ${g.title}`);
      const chart = resolveGraph(g, ctxWith(g.measures));
      assert.equal(chart.note, undefined, `${profile}: ${g.title}: ${chart.note}`);
      assert.ok(!chartSvg(chart).includes("NaN"), `${profile}: ${g.title}`);
    }
  }
});

it("every graph type draws (no NaN), and the print route's check keeps it, negatives only for the variance", () => {
  const ids = ["donations.cash", "donations.gik_food", "donations.gik_nonfood"];
  for (const { type } of GRAPH_TYPES) {
    const showBy = graphRules(type).showBy[0];
    const chart = resolveGraph({ id: "t", title: type, type, measures: ids, showBy, place: "top", goalLine: true }, ctxWith(ids));
    assert.ok(!chartSvg(chart).includes("NaN"), type);
    const kept = cleanSpec({ title: "T", period: "Nov", sections: [{ heading: "A", graphs: [chart] }] }).sections[0].graphs[0];
    assert.equal(kept.kind, type);
  }
  const v = cleanSpec({ title: "T", period: "Nov", sections: [{ heading: "A", chart: { kind: "variance", labels: [], series: [], rows: [{ label: "x", value: -12 }] } }, { heading: "B", chart: { kind: "bar", labels: ["a"], series: [{ label: "s", values: [-5] }] } }, { heading: "C", chart: { kind: "script", labels: [], series: [] } }] });
  assert.equal(v.sections[0].chart.rows[0].value, -12);
  assert.equal(v.sections[1].chart.series[0].values[0], 0);
  assert.equal(v.sections[2].chart, undefined);
  assert.ok(buildReportPdf(v, { generatedAt: "now", generatedBy: "test" }).length > 1000);
});

it("the rules: one scale unless the rows carry their own; a list goes alone as a breakdown; months only where dated", () => {
  const g = (o) => ({ id: "x", title: "x", place: "top", showBy: "comparisons", ...o });
  assert.match(graphProblem(g({ type: "bar", measures: ["donations.cash", "donations.cash_count"] })), /different units/);
  assert.equal(graphProblem(g({ type: "scorecard", measures: ["donations.cash", "donations.cash_count"] })), null);
  assert.match(graphProblem(g({ type: "pie", measures: ["expenses.by_account", "expenses.paid"], showBy: "breakdown" })), /alone/);
  assert.match(graphProblem(g({ type: "line", measures: ["expenses.paid"], showBy: "months" })), /month-by-month/);
  assert.match(graphProblem(g({ type: "line", measures: ["caf.billed"], showBy: "over_time" })), /day, week or month/);
  assert.equal(graphProblem(g({ type: "line", measures: ["housing.housing"], showBy: "over_time" })), null);
  assert.match(graphProblem(g({ type: "pie", measures: ["donations.cash"], showBy: "comparisons" })), /breakdown/);
});

const base = {
  rows: [], previous: [], buckets: [{ key: "2026-10-27", label: "Nov 1-2" }, { key: "2026-11-03", label: "Nov 3-9" }], period: "Nov 2026", previousPeriod: "Oct 2026", ytdLabel: "YTD 2026", goalYear: 2026,
  ytdEnd: "2026-11-13", windowFrom: "2026-11-01", grain: "week",
};
const donations = { figures: [{ id: "donations.cash", label: "Cash gifts", value: 120, previous: 100, ytd: 900, unit: "PHP" }, { id: "donations.cash_count", label: "Cash gifts (count)", value: 4, previous: 5, ytd: 40 }], rows: [{ label: "Nov 1-2", cash: 20, food: 0, nonFood: 0 }, { label: "Nov 3-9", cash: 100, food: 0, nonFood: 0 }] };

it("a totals section's own graph is the scorecard (variance coloured), 'bars' brings back the two bars", () => {
  const s = operationsReport({ ...base, sections: ["donations"], extras: { donations }, totalsOnly: true }).spec.sections[0];
  assert.equal(s.chart.kind, "scorecard");
  assert.equal(s.chart.rows[0].good, true);
  assert.equal(s.chart.rows[1].good, false);
  assert.match(s.chart.rows[0].text, /\+20% vs Oct/);
  const b = operationsReport({ ...base, sections: ["donations"], extras: { donations }, totalsOnly: true, styles: { donations: "bars" } }).spec.sections[0];
  assert.equal(b.chart.kind, "bar");
});

it("a profile's graphs: in their section, at the top, hidden ones left out; a week before the period counts in its month", () => {
  const rows = [{ line: "housing", bucket: "2026-10-27", native: 7, fromSheet: 0 }, { line: "housing", bucket: "2026-11-03", native: 10, fromSheet: 0 }];
  const ytdRows = [{ line: "housing", bucket: "2026-10-01", native: 30, fromSheet: 0 }];
  const graphs = [
    { id: "a", title: "Cash over the period", type: "bar", measures: ["donations.cash"], showBy: "over_time", place: "donations" },
    { id: "b", title: "Housed by month", type: "line", measures: ["housing.housing"], showBy: "months", place: "top" },
    { id: "c", title: "Hidden", type: "kpi", measures: ["donations.cash"], showBy: "comparisons", place: "top", hidden: true },
  ];
  const spec = operationsReport({ ...base, rows, ytdRows, sections: ["donations", "housing"], extras: { donations }, totalsOnly: true, graphs }).spec;
  assert.equal(spec.sections[0].heading, "At a glance");
  assert.deepEqual(spec.sections[0].graphs.map((g) => g.title), ["Housed by month"]);
  const months = spec.sections[0].graphs[0].series[0].values;
  assert.equal(months.length, 11);
  assert.equal(months[9], 30);
  assert.equal(months[10], 17);
  const don = spec.sections.find((s) => s.heading === "Donations");
  assert.deepEqual(don.graphs[0].series[0].values, [20, 100]);
});
