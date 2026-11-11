import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { budgetDue, budgetReminder, measureTotal, spreadYear } from "../lib/utils/budgets.ts";

describe("budgets", () => {
  it("adds up a measure's Program Impact lines, the app's figure first", () => {
    const rows = [
      { line: "meals_breakfast", bucket: "2027-01-01", native: 100, fromSheet: 0 },
      { line: "meals_lunch", bucket: "2027-01-01", native: 0, fromSheet: 90 },
      { line: "housing", bucket: "2027-01-01", native: 300, fromSheet: 0 },
      { line: "meals_dinner", bucket: "2027-02-01", native: 50, fromSheet: 0 },
    ];
    assert.equal(measureTotal(rows, "meals"), 240);
    assert.equal(measureTotal(rows, "meals", "2027-01-01"), 190);
    assert.equal(measureTotal(rows, "housing"), 300);
  });
  it("spreads a year over 12 months to the centavo", () => {
    const m = spreadYear(1000);
    assert.equal(m.length, 12);
    assert.equal(Math.round(m.reduce((s, x) => s + x, 0) * 100) / 100, 1000);
    assert.equal(m[0], 83.33);
    assert.equal(m[11], 83.37);
  });
  it("next year's budget is due on the set day of the year before", () => {
    assert.equal(budgetDue(2027, 12, 31), "2026-12-31");
    assert.equal(budgetDue(2027, 2, 31), "2026-02-28");
  });
  it("the bell reminds from the notice period until approval, and says when it is late", () => {
    const s = { month: 12, day: 31, remindDays: 30 };
    assert.equal(budgetReminder("2026-11-30", s, [], null), null);
    assert.deepEqual(budgetReminder("2026-12-01", s, [], 2027), { year: 2027, due: "2026-12-31", overdue: false });
    assert.equal(budgetReminder("2026-12-15", s, [2027], 2027), null);
    assert.equal(budgetReminder("2026-12-31", s, [], 2027)?.overdue, false);
    // A running year with no approved budget stays late, past January 1.
    assert.deepEqual(budgetReminder("2027-01-05", s, [], 2027), { year: 2027, due: "2026-12-31", overdue: true });
    // Before LAF budgets at all, a year without one is not late.
    assert.equal(budgetReminder("2027-01-05", s, [], null), null);
  });
});
