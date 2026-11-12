// The Programs report for any range (0128): buckets match the database's date_trunc, totals and
// status over a range, and the printed document / AI figures come from one builder.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bucketsFor, changeLabel, impactCsv, lineStatus, programReport, total } from "../lib/utils/program-impact.ts";

const rows = [
  { line: "housing", bucket: "2026-11-02", native: 10, fromSheet: 0 },
  { line: "housing", bucket: "2026-11-09", native: 0, fromSheet: 12 },
  { line: "meals_lunch", bucket: "2026-11-02", native: 5, fromSheet: 5 },
];

describe("bucketsFor", () => {
  it("gives days, Monday weeks and first-of-month keys with short labels", () => {
    assert.deepEqual(bucketsFor({ from: "2026-11-05", to: "2026-11-06" }, "day"), [{ key: "2026-11-05", label: "Nov 5" }, { key: "2026-11-06", label: "Nov 6" }]);
    assert.deepEqual(bucketsFor({ from: "2026-11-01", to: "2026-11-15" }, "week").map((b) => b.key), ["2026-10-26", "2026-11-02", "2026-11-09"]);
    // Labels are clipped to the window: a month starts on day 1 and ends on its last day.
    assert.equal(bucketsFor({ from: "2026-11-01", to: "2026-11-15" }, "week")[0].label, "Nov 1");
    assert.deepEqual(bucketsFor({ from: "2026-10-01", to: "2026-10-31" }, "week").map((b) => b.label), ["Oct 1–4", "Oct 5–11", "Oct 12–18", "Oct 19–25", "Oct 26–31"]);
    assert.deepEqual(bucketsFor({ from: "2026-01-01", to: "2026-03-31" }, "month").map((b) => b.label), ["Jan", "Feb", "Mar"]);
    assert.equal(bucketsFor({ from: "2025-12-01", to: "2026-01-31" }, "month")[1].label, "Jan 2026");
  });
});

describe("totals, status, change", () => {
  it("adds the larger of app and sheet per bucket and judges status on the last bucket", () => {
    assert.equal(total(rows, "housing"), 22);
    assert.equal(total(rows, "housing", (r) => r.native), 10);
    assert.equal(lineStatus(rows, "housing", "2026-11-09"), "catching_up");
    assert.equal(lineStatus(rows, "meals_lunch", "2026-11-02"), "live");
    assert.equal(lineStatus(rows, "caf_nights", "2026-11-02"), "sheet_only");
  });
  it("labels a change", () => {
    assert.equal(changeLabel(12, 10), "+20%");
    assert.equal(changeLabel(8, 10), "-20%");
    assert.equal(changeLabel(3, 0), "new");
    assert.equal(changeLabel(0, 0), "");
  });
});

describe("programReport and CSV", () => {
  it("builds the document and the AI figures from the same rows", () => {
    const buckets = bucketsFor({ from: "2026-11-01", to: "2026-11-15" }, "week");
    const { spec, input } = programReport({ rows, previous: [{ line: "housing", bucket: "2026-10-01", native: 20, fromSheet: 0 }], buckets, period: "Nov 1 – Nov 15, 2026", previousPeriod: "Oct 17 – Oct 31, 2026" });
    assert.equal(spec.sections.length, 7);
    const housing = spec.sections[0];
    assert.deepEqual(housing.kpis[0], { label: "People housed (child + companions, per night) (people-nights)", value: "22", previous: "20", change: "+10%" });
    assert.deepEqual(housing.table.rows[0], ["People housed (child + companions, per night)", 0, 10, 12, 22]);
    assert.equal(housing.chart.kind, "bar");
    assert.deepEqual(input.sections[0].kpis[0], { label: "People housed (child + companions, per night) (people-nights)", value: 22, previous: 20 });
    assert.equal(spec.sections[1].chart.kind, "stacked");
    assert.ok(spec.sections[1].table.totals);
    assert.match(impactCsv(rows, buckets), /"Housing","People housed[^"]*","people-nights",0,0,10,0,0,12,22/);
  });
});
