// Unit tests for lib/utils/leave.ts -- accrual, balances, request length and
// statutory eligibility.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { accruedDays, leaveBalance, requestDays, silApplies, silDischarged, statutoryEligibility } from "../lib/utils/leave.ts";

const SHIFT = { start: "08:00", end: "17:00" };
const SCHEDULE = { pattern: { mon: SHIFT, tue: SHIFT, wed: SHIFT, thu: SHIFT, fri: SHIFT, sat: null, sun: null }, breakMinutes: 60, hoursPerDay: 8 };
const HOLIDAYS = [{ date: "2026-08-31", kind: "regular" }, { date: "2026-08-21", kind: "special_non_working" }];

describe("accruedDays", () => {
  it("5 VL: hired 2024-07-05, as of 2026-09-08 -> 8 completed months -> 3.33", () => {
    assert.equal(accruedDays({ entitlementPerYear: 5, hireDate: "2024-07-05", year: 2026, asOf: "2026-09-08" }), 3.33);
  });
  it("hired 2026-05-26: May pro-rated by days plus Jun-Aug -> 1.33", () => {
    assert.equal(accruedDays({ entitlementPerYear: 5, hireDate: "2026-05-26", year: 2026, asOf: "2026-09-08" }), 1.33);
  });
  it("caps at the entitlement by year end and at separation", () => {
    assert.equal(accruedDays({ entitlementPerYear: 5, hireDate: "2024-07-05", year: 2026, asOf: "2027-02-01" }), 5);
    assert.equal(accruedDays({ entitlementPerYear: 12, hireDate: "2024-07-05", year: 2026, asOf: "2026-09-08", separationDate: "2026-03-31" }), 3);
  });
  it("nothing before hiring or with no entitlement", () => {
    assert.equal(accruedDays({ entitlementPerYear: 5, hireDate: "2026-10-01", year: 2026, asOf: "2026-09-08" }), 0);
    assert.equal(accruedDays({ entitlementPerYear: 0, hireDate: "2024-07-05", year: 2026, asOf: "2026-09-08" }), 0);
  });
});

describe("leaveBalance", () => {
  it("adds carry-in, subtracts approved use and conversions; pending shown separately", () => {
    const b = leaveBalance({
      typeId: "vl",
      year: 2026,
      entitlementPerYear: 5,
      hireDate: "2024-07-05",
      asOf: "2026-09-08",
      adjustments: [
        { leaveTypeId: "vl", year: 2026, kind: "carry_in", days: 2 },
        { leaveTypeId: "vl", year: 2026, kind: "conversion", days: 1 },
        { leaveTypeId: "sl", year: 2026, kind: "carry_in", days: 9 },
        { leaveTypeId: "vl", year: 2025, kind: "carry_in", days: 9 },
      ],
      requests: [
        { leaveTypeId: "vl", status: "approved", days: 1.5, startsOn: "2026-03-02" },
        { leaveTypeId: "vl", status: "pending", days: 1, startsOn: "2026-10-05" },
        { leaveTypeId: "vl", status: "rejected", days: 3, startsOn: "2026-04-01" },
        { leaveTypeId: "vl", status: "approved", days: 2, startsOn: "2025-12-29" },
      ],
    });
    assert.equal(b.entitled, 5);
    assert.equal(b.accrued, 3.33);
    assert.equal(b.carriedIn, 2);
    assert.equal(b.used, 1.5);
    assert.equal(b.pending, 1);
    assert.equal(b.converted, 1);
    assert.equal(b.available, 2.83);
  });
  it("pro-rates the year's entitlement for a mid-year hire", () => {
    const b = leaveBalance({ typeId: "sl", year: 2026, entitlementPerYear: 5, hireDate: "2026-07-01", asOf: "2026-09-08", adjustments: [], requests: [] });
    assert.equal(b.entitled, 2.52); // 184/365 * 5
  });
});

describe("requestDays", () => {
  it("counts scheduled workdays only, skipping holidays and rest days", () => {
    // Fri Aug 28 - Tue Sep 1 2026: Fri, (Sat, Sun off), Mon Aug 31 regular holiday, Tue -> 2
    assert.equal(requestDays({ from: "2026-08-28", to: "2026-09-01", startHalf: false, endHalf: false, schedule: SCHEDULE, overrides: [], holidays: HOLIDAYS }), 2);
  });
  it("half days on either end", () => {
    assert.equal(requestDays({ from: "2026-09-07", to: "2026-09-09", startHalf: true, endHalf: true, schedule: SCHEDULE, overrides: [], holidays: [] }), 2);
    assert.equal(requestDays({ from: "2026-09-07", to: "2026-09-07", startHalf: true, endHalf: false, schedule: SCHEDULE, overrides: [], holidays: [] }), 0.5);
  });
  it("an override makes a rest day count and a workday not", () => {
    const overrides = [
      { date: "2026-09-05", start: "08:00", end: "12:00", isRestDay: false },
      { date: "2026-09-07", start: null, end: null, isRestDay: true },
    ];
    assert.equal(requestDays({ from: "2026-09-05", to: "2026-09-07", startHalf: false, endHalf: false, schedule: SCHEDULE, overrides, holidays: [] }), 1);
  });
  it("with no schedule every calendar day counts", () => {
    assert.equal(requestDays({ from: "2026-09-05", to: "2026-09-07", startHalf: false, endHalf: false, schedule: null, overrides: [], holidays: [] }), 3);
  });
});

describe("statutoryEligibility", () => {
  it("solo parent needs six months of service", () => {
    const r = statutoryEligibility({ rules: { minServiceMonths: 6 }, hireDate: "2026-05-26", asOf: "2026-09-08", priorOccurrences: 0 });
    assert.equal(r.eligible, false);
    assert.match(r.reason, /2026-11-26/);
    assert.equal(statutoryEligibility({ rules: { minServiceMonths: 6 }, hireDate: "2026-02-01", asOf: "2026-09-08", priorOccurrences: 0 }).eligible, true);
  });
  it("paternity: male, married, up to four", () => {
    const rules = { sex: "male", civilStatus: "married", maxOccurrences: 4, perEvent: true };
    assert.equal(statutoryEligibility({ rules, hireDate: "2020-01-01", asOf: "2026-09-08", sex: "female", civilStatus: "Married", priorOccurrences: 0 }).eligible, false);
    assert.equal(statutoryEligibility({ rules, hireDate: "2020-01-01", asOf: "2026-09-08", sex: "male", civilStatus: "Single", priorOccurrences: 0 }).eligible, false);
    assert.equal(statutoryEligibility({ rules, hireDate: "2020-01-01", asOf: "2026-09-08", sex: "male", civilStatus: "Married", priorOccurrences: 4 }).eligible, false);
    assert.equal(statutoryEligibility({ rules, hireDate: "2020-01-01", asOf: "2026-09-08", sex: "male", civilStatus: "Married", priorOccurrences: 3 }).eligible, true);
  });
});

describe("SIL thresholds", () => {
  it("five VL days discharges it; ten employees bring it in", () => {
    assert.equal(silDischarged(5), true);
    assert.equal(silDischarged(4), false);
    assert.equal(silApplies(9), false);
    assert.equal(silApplies(10), true);
  });
});
