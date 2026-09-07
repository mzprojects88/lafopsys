// Unit tests for lib/utils/statutory.ts -- SSS, PhilHealth, Pag-IBIG and
// withholding-tax lookups against the 2025/2026 tables, with the worked
// examples the circulars themselves give.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildSssBrackets2025,
  minimumWageAt,
  pagibigContribution,
  parseRateTable,
  philhealthPremium,
  selectTable,
  splitDeMinimis,
  sssContribution,
  TAX_BRACKETS_2023,
  withholdingTax,
} from "../lib/utils/statutory.ts";

const sss = { kind: "sss", brackets: buildSssBrackets2025() };
const philhealth = { kind: "philhealth", rate: 0.05, floor: 10000, ceiling: 100000 };
const pagibig = { kind: "pagibig", eeRateLow: 0.01, lowThreshold: 1500, eeRate: 0.02, erRate: 0.02, maxFundSalary: 10000 };
const semi = { kind: "tax_semi_monthly", brackets: TAX_BRACKETS_2023.tax_semi_monthly };
const annual = { kind: "tax_annual", brackets: TAX_BRACKETS_2023.tax_annual };

describe("SSS (Circular 2024-006)", () => {
  it("generates 61 joined brackets from 5,000 to 35,000", () => {
    assert.equal(sss.brackets.length, 61);
    assert.equal(sss.brackets[0].from, 0);
    assert.equal(sss.brackets[0].to, 5250);
    assert.equal(sss.brackets.at(-1).from, 34750);
    assert.equal(sss.brackets.at(-1).to, null);
    assert.doesNotThrow(() => parseRateTable({ kind: "sss", params: {}, rows: sss.brackets, effectiveFrom: "2025-01-01", status: "in_force" }));
  });

  it("MSC 20,000 -> EE 1,000 / ER 2,000 / EC 30, no MPF", () => {
    const c = sssContribution(20000, sss);
    assert.deepEqual(c, { msc: 20000, ee: 1000, er: 2000, ec: 30, mpfEe: 0, mpfEr: 0, employeeTotal: 1000, employerTotal: 2030 });
  });

  it("MSC 35,000 adds MPF 750 / 1,500 above the regular cap", () => {
    const c = sssContribution(40000, sss);
    assert.equal(c.msc, 35000);
    assert.equal(c.ee, 1000);
    assert.equal(c.mpfEe, 750);
    assert.equal(c.mpfEr, 1500);
    assert.equal(c.employeeTotal, 1750);
    assert.equal(c.employerTotal, 3530);
  });

  it("low compensation lands on the first bracket, EC 10", () => {
    const c = sssContribution(4000, sss);
    assert.equal(c.msc, 5000);
    assert.equal(c.ee, 250);
    assert.equal(c.er, 500);
    assert.equal(c.ec, 10);
    // 9,000 is in the 8,750-9,249.99 range -> MSC 9,000
    assert.equal(sssContribution(9000, sss).msc, 9000);
    assert.equal(sssContribution(9249.99, sss).msc, 9000);
    assert.equal(sssContribution(9250, sss).msc, 9500);
  });
});

describe("PhilHealth (RA 11223, 5%)", () => {
  it("applies the floor, the rate and the ceiling", () => {
    assert.deepEqual(philhealthPremium(9000, philhealth), { base: 10000, ee: 250, er: 250, total: 500 });
    assert.deepEqual(philhealthPremium(25000, philhealth), { base: 25000, ee: 625, er: 625, total: 1250 });
    assert.deepEqual(philhealthPremium(120000, philhealth), { base: 100000, ee: 2500, er: 2500, total: 5000 });
  });

  it("gives the employer the odd centavo", () => {
    const p = philhealthPremium(10010, philhealth);
    assert.equal(p.total, 500.5);
    assert.equal(p.ee + p.er, p.total);
  });
});

describe("Pag-IBIG (HDMF Circular 460)", () => {
  it("1% up to 1,500, 2% above, capped at the 10,000 fund salary", () => {
    assert.deepEqual(pagibigContribution(1500, pagibig), { base: 1500, ee: 15, er: 30 });
    assert.deepEqual(pagibigContribution(9000, pagibig), { base: 9000, ee: 180, er: 180 });
    assert.deepEqual(pagibigContribution(25000, pagibig), { base: 10000, ee: 200, er: 200 });
  });
});

describe("Withholding tax (RR 11-2018 Annex E, 2023+)", () => {
  it("semi-monthly brackets at their edges", () => {
    assert.equal(withholdingTax(10000, semi), 0);
    assert.equal(withholdingTax(10417, semi), 0);
    assert.equal(withholdingTax(12500, semi), 312.45);
    assert.equal(withholdingTax(16667, semi), 937.5);
    assert.equal(withholdingTax(20000, semi), 1604.1);
    assert.equal(withholdingTax(33333, semi), 4270.7);
    assert.equal(withholdingTax(83333, semi), 16770.7);
    assert.equal(withholdingTax(400000, semi), 91770.7 + (400000 - 333333) * 0.35);
  });

  it("annual table: 250,000 exempt, then 15%", () => {
    assert.equal(withholdingTax(250000, annual), 0);
    assert.equal(withholdingTax(300000, annual), 7500);
    assert.equal(withholdingTax(400000, annual), 22500);
    assert.equal(withholdingTax(1000000, annual), 152500);
  });

  it("negative or zero taxable income is never taxed", () => {
    assert.equal(withholdingTax(0, semi), 0);
    assert.equal(withholdingTax(-500, semi), 0);
  });
});

describe("parseRateTable", () => {
  it("refuses brackets that do not join, and a closed last bracket", () => {
    const rows = buildSssBrackets2025();
    rows[5] = { ...rows[5], from: rows[5].from + 1 };
    assert.throws(() => parseRateTable({ kind: "sss", params: {}, rows, effectiveFrom: "2025-01-01", status: "in_force" }), /do not join/);
    const closed = buildSssBrackets2025().map((b, i, a) => (i === a.length - 1 ? { ...b, to: 99999 } : b));
    assert.throws(() => parseRateTable({ kind: "sss", params: {}, rows: closed, effectiveFrom: "2025-01-01", status: "in_force" }), /open-ended/);
  });

  it("refuses a rate written as a percentage", () => {
    assert.throws(
      () => parseRateTable({ kind: "philhealth", params: { rate: 5, floor: 10000, ceiling: 100000 }, rows: [], effectiveFrom: "2026-01-01", status: "in_force" }),
      /fraction/
    );
    assert.throws(
      () => parseRateTable({ kind: "tax_monthly", params: {}, rows: [{ over: 0, base: 0, rate: 0 }, { over: 20833, base: 0, rate: 15 }], effectiveFrom: "2023-01-01", status: "in_force" }),
      /fraction/
    );
  });

  it("refuses a tax table that does not start at 0 or is out of order", () => {
    assert.throws(
      () => parseRateTable({ kind: "tax_annual", params: {}, rows: [{ over: 250000, base: 0, rate: 0.15 }], effectiveFrom: "2023-01-01", status: "in_force" }),
      /start at 0/
    );
    assert.throws(
      () => parseRateTable({ kind: "tax_annual", params: {}, rows: [{ over: 0, base: 0, rate: 0 }, { over: 800000, base: 1, rate: 0.2 }, { over: 400000, base: 1, rate: 0.2 }], effectiveFrom: "2023-01-01", status: "in_force" }),
      /ascending/
    );
  });
});

const tables = [
  { id: "a", kind: "philhealth", effectiveFrom: "2024-01-01", effectiveTo: null, status: "in_force", source: "RA 11223", params: { rate: 0.05, floor: 10000, ceiling: 100000 }, rows: [] },
  // An old version stays in_force with an effective_to; "superseded" is for
  // a version that never priced anything again.
  { id: "b", kind: "philhealth", effectiveFrom: "2023-01-01", effectiveTo: "2024-01-01", status: "in_force", source: "RA 11223", params: { rate: 0.04, floor: 10000, ceiling: 80000 }, rows: [] },
  { id: "b2", kind: "philhealth", effectiveFrom: "2022-01-01", effectiveTo: null, status: "superseded", source: "old", params: { rate: 0.03, floor: 10000, ceiling: 60000 }, rows: [] },
  { id: "c", kind: "minimum_wage", effectiveFrom: "2025-07-18", effectiveTo: null, status: "in_force", source: "WO NCR-26", params: {}, rows: [{ region: "NCR", sector: "non_agri", rate: 695, wageOrder: "NCR-26" }] },
  { id: "d", kind: "minimum_wage", effectiveFrom: "2026-07-25", effectiveTo: null, status: "enjoined", source: "WO NCR-27", params: {}, rows: [{ region: "NCR", sector: "non_agri", rate: 755, wageOrder: "NCR-27" }] },
];

describe("selectTable", () => {
  it("picks the latest in-force version on or before the date", () => {
    assert.equal(selectTable("philhealth", "2026-09-08", tables).ceiling, 100000);
    assert.equal(selectTable("philhealth", "2023-12-31", tables).ceiling, 80000);
    assert.throws(() => selectTable("philhealth", "2022-06-01", tables), /No philhealth table/);
  });

  it("never picks an enjoined or superseded version", () => {
    assert.throws(() => selectTable("minimum_wage", "2025-01-01", tables), /No minimum_wage table/);
    assert.equal(selectTable("minimum_wage", "2026-09-08", tables).rows[0].rate, 695);
  });
});

describe("minimumWageAt", () => {
  it("NCR on 2026-09-08 is 695 under NCR-26, with NCR-27 (755) pending under injunction", () => {
    const mw = minimumWageAt("NCR", "2026-09-08", tables);
    assert.equal(mw.rate, 695);
    assert.equal(mw.wageOrder, "NCR-26");
    assert.deepEqual(mw.pending, { rate: 755, wageOrder: "NCR-27", effectiveFrom: "2026-07-25", status: "enjoined" });
  });

  it("nothing pending before the later order's date", () => {
    assert.equal(minimumWageAt("NCR", "2026-07-01", tables).pending, null);
  });
});

describe("splitDeMinimis", () => {
  it("rice subsidy is exempt up to 2,000 a month, the rest taxable", () => {
    assert.deepEqual(splitDeMinimis("rice", 1500), { exempt: 1500, taxable: 0 });
    assert.deepEqual(splitDeMinimis("rice", 2500), { exempt: 2000, taxable: 500 });
  });

  it("an unknown kind is fully taxable", () => {
    assert.deepEqual(splitDeMinimis(undefined, 1000), { exempt: 0, taxable: 1000 });
    assert.deepEqual(splitDeMinimis("communication", 1000), { exempt: 0, taxable: 1000 });
  });
});
