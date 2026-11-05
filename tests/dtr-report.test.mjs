// The DTR report (Nov 2026): totals, CSV and the document; the AI gets totals only, never a name.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dtrReport, dtrReportCsv, dtrTotals } from "../lib/utils/dtr-report.ts";

const row = (name, over = {}) => ({ employeeId: name, staffId: name, name, position: "Staff", scheduledDays: 20, daysWorked: 19, punchesIn: 19, punchesOut: 18, workedMinutes: 9120, lateDays: 2, lateMinutes: 25, undertimeMinutes: 10, overtimeMinutes: 60, missedPunches: 1, absences: 1, leaveDays: 0, ...over });
const rows = [row("Sample One"), row("Sample Two", { lateDays: 0, lateMinutes: 0, missedPunches: 0 })];

describe("dtr report", () => {
  it("totals the rows and counts who was late or missed a clock-out", () => {
    const t = dtrTotals(rows);
    assert.equal(t.workedMinutes, 18240);
    assert.equal(t.withLates, 1);
    assert.equal(t.withMissed, 1);
  });
  it("writes the CSV with a total line", () => {
    const csv = dtrReportCsv(rows);
    assert.match(csv, /^"Employee","Position","Sched. days"/);
    assert.match(csv, /"Sample One","Staff",20,19,19,18,152,2,25,10,60,1,1,0/);
    assert.match(csv, /"Total","2 employees",40,38/);
  });
  it("builds the document with names, and the AI figures without them", () => {
    const { spec, input } = dtrReport({ rows, previous: [row("Sample One", { workedMinutes: 6000 })], period: "Oct 2026", previousPeriod: "Sep 2026" });
    assert.equal(spec.sections[0].table.rows.length, 2);
    assert.deepEqual(spec.sections[0].kpis[0], { label: "Hours worked", value: "304", previous: "100", change: "+204%" });
    assert.equal(spec.sections[0].chart.labels[0], "Sample One");
    assert.doesNotMatch(JSON.stringify(input), /Sample (One|Two)/);
    assert.match(input.sections[0].description, /2 employees with a login \(1 in the previous range\)/);
  });
});
