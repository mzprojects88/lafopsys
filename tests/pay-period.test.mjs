// Unit tests for lib/utils/pay-period.ts -- the semi-monthly calendar and
// the pay-date rules (Labor Code Art. 103).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isNonWorkingDay, payDateFor, payPeriodKey, payPeriodLabel, periodFor, semiMonthlyPeriods } from "../lib/utils/pay-period.ts";

const HOLIDAYS = [
  { date: "2026-11-01", kind: "special_non_working" },
  { date: "2026-11-02", kind: "special_non_working" },
  { date: "2026-11-30", kind: "regular" },
  { date: "2026-02-25", kind: "special_working" },
];

describe("semiMonthlyPeriods", () => {
  it("makes 24 periods, 1-15 and 16-end", () => {
    const p = semiMonthlyPeriods(2026);
    assert.equal(p.length, 24);
    assert.deepEqual(p[0], { year: 2026, seq: 1, from: "2026-01-01", to: "2026-01-15", isSecondCutoff: false });
    assert.deepEqual(p[3], { year: 2026, seq: 4, from: "2026-02-16", to: "2026-02-28", isSecondCutoff: true });
    assert.equal(p[23].to, "2026-12-31");
    assert.equal(semiMonthlyPeriods(2028)[3].to, "2028-02-29");
  });

  it("periodFor finds the right one", () => {
    assert.equal(periodFor("2026-09-08").seq, 17);
    assert.equal(periodFor("2026-09-16").seq, 18);
    assert.equal(periodFor("2026-09-15").seq, 17);
    assert.equal(periodFor("2026-12-31").seq, 24);
  });
});

describe("payDateFor", () => {
  it("offset 5 after the cutoff", () => {
    assert.equal(payDateFor(periodFor("2026-09-01"), { kind: "offset", days: 5 }), "2026-09-18");
    // Sep 30 + 5 = Oct 5 (Mon)
    assert.equal(payDateFor(periodFor("2026-09-16"), { kind: "offset", days: 5 }), "2026-10-05");
  });

  it("rolls back off a weekend or holiday, never forward", () => {
    // Oct 15 + 5 = Oct 20 (Tue) fine; Oct 31 + 5 = Nov 5 (Thu) fine
    // Nov 15 + 5 = Nov 20 (Fri) fine; Nov 30 (Mon, regular holiday) + 0 -> Nov 27 (Fri)
    assert.equal(payDateFor(periodFor("2026-11-16"), { kind: "offset", days: 0 }, HOLIDAYS), "2026-11-27");
    // Oct 31 + 1 = Nov 1 (Sun, special) -> Oct 30 (Fri)
    assert.equal(payDateFor(periodFor("2026-10-16"), { kind: "offset", days: 1 }, HOLIDAYS), "2026-10-30");
  });

  it("fixed 20 / 5: the 1-15 cutoff on the 20th, the 16-end on the 5th of next month", () => {
    assert.equal(payDateFor(periodFor("2026-09-01"), { kind: "fixed", first: 20, second: 5 }), "2026-09-18"); // 20th is a Sunday -> Fri 18
    assert.equal(payDateFor(periodFor("2026-09-16"), { kind: "fixed", first: 20, second: 5 }), "2026-10-05");
    assert.equal(payDateFor(periodFor("2026-12-16"), { kind: "fixed", first: 20, second: 5 }), "2027-01-05");
  });

  it("fixed day clamps to the month's length and never pays before the cutoff ends", () => {
    assert.equal(payDateFor(periodFor("2026-01-16"), { kind: "fixed", first: 20, second: 31 }), "2026-02-27"); // Feb 28 is a Saturday -> Fri 27
    assert.equal(payDateFor(periodFor("2026-09-01"), { kind: "fixed", first: 10, second: 25 }), "2026-10-09"); // 10th < 15th -> next month, Oct 10 is Sat -> Fri 9
  });
});

describe("isNonWorkingDay", () => {
  it("weekends and non-working holidays only", () => {
    assert.equal(isNonWorkingDay("2026-09-05", HOLIDAYS), true); // Sat
    assert.equal(isNonWorkingDay("2026-09-08", HOLIDAYS), false); // Tue
    assert.equal(isNonWorkingDay("2026-11-30", HOLIDAYS), true);
    assert.equal(isNonWorkingDay("2026-02-25", HOLIDAYS), false); // special working
  });
});

describe("labels", () => {
  it("reads like the payslip header", () => {
    assert.equal(payPeriodLabel(periodFor("2026-09-16")), "Sep 16–30, 2026");
    assert.equal(payPeriodKey(periodFor("2026-09-16")), "2026-18");
  });
});
