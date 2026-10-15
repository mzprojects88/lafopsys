// lib/utils/caf.ts (0098): the NCH Cancer Assistance Fund bill against the user's September 2026
// package. Every row of the package matches; its printed totals do not: the rows add up to 236
// billable stays, P236,000 gross and P188,800 due, but the package footed 235 / P235,000 / P188,000
// (one night, P800, left out of the totals -- found 2026-10-15).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ageOn, cafAmounts, cafDay, cafMonthLabel, cafPeriod, cafTotals, pesosInWords } from "../lib/utils/caf.ts";

const TERMS = { rate: 1000, cap: 15, discountPct: 20 };
// "# of Stays" per child, in the Billing Statement's order.
const SEPTEMBER = [8, 4, 2, 3, 9, 12, 18, 1, 26, 11, 5, 3, 1, 8, 16, 10, 9, 1, 17, 15, 1, 10, 11, 1, 4, 20, 10, 1, 2, 3, 17, 1];
const nightsOf = (n) => Array.from({ length: n }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`);

describe("NCH CAF billing", () => {
  it("reproduces every row of the September 2026 package, and its rows' true totals", () => {
    // Each child's billable stays and amount due, as the package prints them.
    const BILLABLE = [8, 4, 2, 3, 9, 12, 15, 1, 15, 11, 5, 3, 1, 8, 15, 10, 9, 1, 15, 15, 1, 10, 11, 1, 4, 15, 10, 1, 2, 3, 15, 1];
    const lines = SEPTEMBER.map((n) => cafAmounts({ nights: nightsOf(n), pwd: true }, TERMS));
    assert.deepEqual(lines.map((a) => a.billable), BILLABLE);
    assert.deepEqual(lines.map((a) => a.net), BILLABLE.map((b) => b * 800));
    const t = cafTotals(SEPTEMBER.map((n) => ({ nights: nightsOf(n), pwd: true })), TERMS);
    assert.deepEqual(t, { children: 32, stays: 260, billable: 236, gross: 236000, net: 188800 });
    assert.equal(pesosInWords(t.net), "ONE HUNDRED EIGHTY EIGHT THOUSAND EIGHT HUNDRED PESOS ONLY");
    assert.equal(pesosInWords(188000), "ONE HUNDRED EIGHTY EIGHT THOUSAND PESOS ONLY");
  });
  it("bills the first 15 nights of the month, as the package lists them", () => {
    // Botona: 18 stays; the Statement lists Sep 2-9 and Sep 17-23.
    const nights = [...["02", "03", "04", "05", "06", "07", "08", "09"], ...["17", "18", "19", "20", "21", "22", "23", "24", "25", "26"]].map((d) => `2026-09-${d}`);
    const a = cafAmounts({ nights, pwd: true }, TERMS);
    assert.equal(a.stays, 18);
    assert.equal(a.billable, 15);
    assert.deepEqual(a.billableNights.slice(-1), ["2026-09-23"]);
    assert.deepEqual([a.gross, a.net], [15000, 12000]);
  });
  it("no discount without PWD; a night counted once", () => {
    const a = cafAmounts({ nights: ["2026-09-01", "2026-09-01", "2026-09-02"], pwd: false }, TERMS);
    assert.deepEqual([a.stays, a.gross, a.discountPct, a.net], [2, 2000, 0, 2000]);
  });
  it("words and labels", () => {
    assert.equal(pesosInWords(800), "EIGHT HUNDRED PESOS ONLY");
    assert.equal(pesosInWords(1), "ONE PESO ONLY");
    assert.equal(pesosInWords(1250.5), "ONE THOUSAND TWO HUNDRED FIFTY PESOS AND 50/100 ONLY");
    assert.equal(cafMonthLabel("2026-09-01"), "Sep 2026");
    assert.equal(cafPeriod("2026-09-01"), "Sep 1-30");
    assert.equal(cafPeriod("2028-02-01"), "Feb 1-29");
    assert.equal(cafDay("2026-09-02"), "Sep 2");
    assert.equal(ageOn("2022-10-06", "2026-10-05"), 3);
    assert.equal(ageOn("2022-10-05", "2026-10-05"), 4);
  });
});
