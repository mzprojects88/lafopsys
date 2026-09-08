// DSWD Annex E / Annex G figures: bank totals, receipt-based donor split, expenditure lines, accomplishment counts.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { annexEFinancial, annexGAccomplishment, donorIndex, expenseSourceLabel, incomeBucketFor } from "../lib/utils/dswd-annex.ts";

const txn = (postingDate, rowSeq, debit, credit, runningBalance, category = null) => ({ postingDate, rowSeq, debit, credit, runningBalance, category });
const entry = (patch) => ({ id: patch.id ?? `${patch.date}-${patch.donorName ?? patch.source}`, date: null, amount: 0, direction: "inflow", donorName: null, sourceSheet: null, approvalStatus: "approved", duplicateOfId: null, source: "cash_donation", currency: "PHP", ...patch });
const DONORS = [
  { name: "Manny Chan", type: "individual", taxJurisdiction: "PH" },
  { name: "Acme US Foundation", type: "foundation", taxJurisdiction: "US" },
  { name: "DSWD NCR", type: "government", taxJurisdiction: "PH" },
];

describe("incomeBucketFor", () => {
  const idx = donorIndex(DONORS);
  it("government by donor type, foreign by tax jurisdiction, local otherwise, interest to others", () => {
    assert.equal(incomeBucketFor({ donorName: "DSWD NCR", source: "cash_donation" }, idx), "government");
    assert.equal(incomeBucketFor({ donorName: "acme us foundation", source: "cash_donation" }, idx), "foreign");
    assert.equal(incomeBucketFor({ donorName: "Manny  Chan", source: "cash_donation" }, idx), "local");
    assert.equal(incomeBucketFor({ donorName: "Nobody Known", source: "cash_donation" }, idx), "local");
    assert.equal(incomeBucketFor({ donorName: null, source: "interest" }, idx), "others");
  });
});

describe("annexEFinancial", () => {
  const TXNS = [
    txn("2025-12-31", 9, 0, 0, 100000),
    txn("2026-01-05", 1, 0, 30000, 130000),
    txn("2026-01-20", 2, 12000, 0, 118000),
    txn("2026-02-03", 1, 0, 50000, 168000),
    txn("2026-02-28", 2, 0, 20, 168020, "interest"),
    txn("2026-02-28", 3, 8000, 0, 160020),
  ];
  const ENTRIES = [
    entry({ date: "2026-01-05", amount: 30000, donorName: "Manny Chan", sourceSheet: "CASH" }),
    entry({ id: "dup", date: "2026-01-06", amount: 30000, donorName: "Manny Chan", sourceSheet: "BDO_CASH DONATIONS" }),
    entry({ date: "2026-02-03", amount: 40000, donorName: "Acme US Foundation", sourceSheet: "CASH" }),
    entry({ date: "2026-01-20", amount: 12000, direction: "outflow", source: "rent_utilities", sourceSheet: "Bank Statement" }),
    entry({ date: "2026-02-28", amount: 5000, direction: "outflow", source: "vehicle_fuel", sourceSheet: "Bank Statement" }),
    entry({ date: "2026-02-10", amount: 3000, direction: "outflow", source: "admin_ops", sourceSheet: "Butch reimburments" }),
    entry({ date: "2026-02-11", amount: 500, direction: "inflow", donorName: "US Donor", currency: "USD", sourceSheet: "CASH" }),
  ];
  const e = annexEFinancial(TXNS, ENTRIES, DONORS, 2026);
  it("income and expense totals come from the bank; interest sits under others", () => {
    assert.equal(e.totalDonations, 80000);
    assert.equal(e.interest, 20);
    assert.equal(e.totalIncome, 80020);
    assert.equal(e.totalExpenses, 20000);
    assert.equal(e.buckets.others.total, 20);
  });
  it("the donor list folds re-records and splits local from foreign; the bank remainder is one reconciling line", () => {
    assert.deepEqual(e.buckets.local.donors, [{ donorName: "Manny Chan", amount: 30000, gifts: 1 }]);
    assert.deepEqual(e.buckets.foreign.donors, [{ donorName: "Acme US Foundation", amount: 40000, gifts: 1 }]);
    assert.equal(e.buckets.government.total, 0);
    assert.equal(e.unattributed, 10000);
    assert.equal(e.receiptsExceedBank, false);
  });
  it("USD receipts are left out of a peso report", () => {
    assert.ok(!e.buckets.local.donors.some((d) => d.donorName === "US Donor"));
  });
  it("expenditure lines skip the reimbursement tab and reconcile to the bank with an unclassified remainder", () => {
    assert.deepEqual(
      e.expenseLines.map((l) => [l.source, l.amount, Math.round(l.pct * 100)]),
      [
        ["rent_utilities", 12000, 60],
        ["vehicle_fuel", 5000, 25],
      ]
    );
    assert.equal(e.unclassifiedExpenses, 3000);
  });
  it("balances: previous from the prior year's last line, ending both computed and as the bank says", () => {
    assert.equal(e.previousBalance, 100000);
    assert.equal(e.computedEndingBalance, 160020);
    assert.equal(e.bankEndingBalance, 160020);
    assert.equal(e.bankEndingAsOf, "2026-02-28");
    assert.deepEqual(e.monthsWithoutStatements, [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
  it("no prior statement -> previous balance null; receipts above the bank are flagged", () => {
    const f = annexEFinancial(TXNS.slice(1), [entry({ date: "2026-01-05", amount: 90000, donorName: "Manny Chan" })], DONORS, 2026);
    assert.equal(f.previousBalance, null);
    assert.equal(f.computedEndingBalance, null);
    assert.equal(f.unattributed, 0);
    assert.equal(f.receiptsExceedBank, true);
  });
  it("with no bank data at all the receipts are not called duplicates", () => {
    const f = annexEFinancial([], [entry({ date: "2026-01-05", amount: 90000, donorName: "Manny Chan" })], DONORS, 2026);
    assert.equal(f.totalDonations, 0);
    assert.equal(f.receiptsExceedBank, false);
    assert.equal(f.monthsWithoutStatements.length, 12);
  });
});

describe("annexGAccomplishment", () => {
  it("counts the year's admissions by sex, bed nights from the census, meals and care cart", () => {
    const g = annexGAccomplishment(
      [
        { admittedAt: "2026-02-01T03:00:00Z", sex: "M" },
        { admittedAt: "2026-05-09", sex: "F" },
        { admittedAt: "2026-06-01", sex: null },
        { admittedAt: "2025-12-30", sex: "M" },
        { admittedAt: null, sex: "F" },
      ],
      [
        { date: "2025-12-31", inHouse: 9 },
        { date: "2026-01-23", inHouse: 4 },
        { date: "2026-01-24", inHouse: 5 },
      ],
      [
        { date: "2026-01-23", headcount: 12 },
        { date: "2025-01-23", headcount: 99 },
      ],
      [{ date: "2026-03-01", headcount: 40 }],
      2026
    );
    assert.deepEqual(g.beneficiaries, { male: 1, female: 1, unknown: 1, total: 3 });
    assert.equal(g.bedNights, 9);
    assert.equal(g.censusFrom, "2026-01-23");
    assert.equal(g.censusDays, 2);
    assert.equal(g.meals, 12);
    assert.equal(g.careCartServed, 40);
  });
  it("labels the expense sources for the form", () => {
    assert.equal(expenseSourceLabel("rent_utilities"), "Rent and utilities");
    assert.equal(expenseSourceLabel("something_else"), "something else");
  });
});
