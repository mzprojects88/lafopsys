import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { copyPlan, dayState, fillPlan, monthCsv, monthsShown, needsNote } from "../lib/utils/history.ts";

const day = (over) => ({ day: "2026-11-10", app_children: 0, sheet_children: 0, app_meals: 0, sheet_meals: 0, app_rides: 0, sheet_rides: 0, completed: false, ...over });
const row = (over) => ({ patientId: "p1", name: "Ana", stayed: true, nightBefore: false, night: { stayId: "s", unitId: "u1", unitCode: "B1", carerId: "c1", carerName: "M", people: 1, open: false, fromHistory: true }, meals: [], rides: {}, carers: [], ...over });
const person = (over) => ({ nameKey: "k1", name: "Ana", carer: "M", slept: true, patientId: "p1", matchStatus: "confirmed", meals: ["lunch"], suggestedUnitId: "u1", suggestedCarerId: "c1", ...over });

describe("Patients > History (0167)", () => {
  it("a day's state follows what the app has against the sheet", () => {
    const today = "2026-11-19";
    assert.equal(dayState(day({ day: today }), today), "future");
    assert.equal(dayState(day({ completed: true, app_children: 1, sheet_children: 9 }), today), "complete");
    assert.equal(dayState(day({ sheet_children: 12 }), today), "sheet_only");
    assert.equal(dayState(day({ app_children: 5, sheet_children: 12 }), today), "partial");
    assert.equal(dayState(day({ app_children: 12, sheet_children: 12 }), today), "entered");
    assert.equal(dayState(day({ app_meals: 2 }), today), "partial");
    assert.equal(dayState(day({}), today), "empty");
  });

  it("one month, or the month before it too; the range ends on the chosen month's last day", () => {
    assert.deepEqual(monthsShown("2026-11", 1), { months: ["2026-11"], from: "2026-11-01", to: "2026-11-30" });
    assert.deepEqual(monthsShown("2026-03", 2), { months: ["2026-02", "2026-03"], from: "2026-02-01", to: "2026-03-31" });
    assert.deepEqual(monthsShown("2026-01", 2).months, ["2025-12", "2026-01"]);
  });

  it("a note is needed for days further back than the Settings figure", () => {
    assert.equal(needsNote("2026-11-12", "2026-11-19", 7), false);
    assert.equal(needsNote("2026-11-11", "2026-11-19", 7), true);
  });

  it("fill from the sheet: matched children without a night, once each; unmatched names apart; missing meals for those already in", () => {
    const plan = fillPlan({
      rows: [row({ patientId: "p2", meals: ["breakfast"] })],
      sheet: [
        person({}),
        person({ nameKey: "k1b", patientId: "p1" }),
        person({ nameKey: "k2", name: "Ben", patientId: "p2", meals: ["breakfast", "dinner"] }),
        person({ nameKey: "k3", name: "Cy", patientId: null, matchStatus: "unmatched" }),
        person({ nameKey: "k4", name: "Dee", patientId: null, matchStatus: "dismissed" }),
        person({ nameKey: "k5", name: "Eve", patientId: "p5", slept: false, meals: ["breakfast"] }),
      ],
    });
    assert.deepEqual(plan.nights.map((n) => [n.patientId, n.unitId, n.meals.join("+"), n.mealsOnly]), [["p1", "u1", "lunch", false], ["p2", "u1", "dinner", true]]);
    assert.deepEqual(plan.unmatched.map((p) => p.name), ["Cy"]);
  });

  it("copy the day before: last night's children not yet here, same bed, carer and people", () => {
    const before = { rows: [row({}), row({ patientId: "p2", night: null, stayed: false }), row({ patientId: "p3", night: { stayId: "s3", unitId: "u3", unitCode: "B3", carerId: null, carerName: null, people: 2, open: false, fromHistory: false } })] };
    const plan = copyPlan(before, { rows: [row({})] });
    assert.deepEqual(plan.map((p) => [p.patientId, p.unitId, p.people]), [["p3", "u3", 2]]);
  });

  it("the month CSV has one line per day with the status in words", () => {
    const csv = monthCsv([day({ app_children: 3, sheet_children: 3 })], "2026-11-19");
    assert.equal(csv.rows[0].at(-1), "Entered, not marked complete");
    assert.equal(csv.header.length, csv.rows[0].length);
  });
});
