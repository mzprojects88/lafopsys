// Unit tests for lib/utils/finance-summary.ts -- the CEO's monthly summary
// and donor breakdown. The January figures here are the real ones: the bank
// tab's January debits are 227,320.86 and the sheet's Expenses cell agrees.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { availableYears, cashInBank, donorBreakdown, monthlySummary, maskNames, monthsCovered, monthsWithReceipts, noteStatus, sharesPhrase, tidyName } from "../lib/utils/finance-summary.ts";

describe("noteStatus (0113)", () => {
  const note = (o) => ({ month: "2026-01", drivers: "", draft: null, draftAt: null, confirmedBy: null, confirmedAt: null, ...o });
  it("tells a confirmed month from a pending draft", () => {
    assert.equal(noteStatus(undefined), "none");
    assert.equal(noteStatus(note({})), "none");
    assert.equal(noteStatus(note({ draft: "Steady.", draftAt: "2026-02-01T00:00:00Z" })), "needs_confirmation");
    assert.equal(noteStatus(note({ drivers: "Steady.", confirmedAt: "2026-02-02T00:00:00Z" })), "confirmed");
    // The confirmed text came from the draft: nothing pending.
    assert.equal(noteStatus(note({ drivers: "Steady.", draft: "Steady.", draftAt: "2026-02-01T00:00:00Z", confirmedAt: "2026-02-02T00:00:00Z" })), "confirmed");
    // A later, different draft is a new suggestion.
    assert.equal(noteStatus(note({ drivers: "Steady.", draft: "Up 10%.", draftAt: "2026-02-03T00:00:00Z", confirmedAt: "2026-02-02T00:00:00Z" })), "new_suggestion");
    // An older draft than the confirmation was already judged.
    assert.equal(noteStatus(note({ drivers: "Steady.", draft: "Up 10%.", draftAt: "2026-02-01T00:00:00Z", confirmedAt: "2026-02-02T00:00:00Z" })), "confirmed");
  });
  it("writes capitalised donor names the way the note does", () => {
    assert.equal(tidyName("MAKATI LADY EAGLES CLUB"), "Makati Lady Eagles Club");
    assert.equal(tidyName("WORKERS OF CHRIST"), "Workers of Christ");
    assert.equal(tidyName("NCH"), "NCH");
    assert.equal(tidyName("ELCEE DUQUE & FRIENDS"), "Elcee Duque & Friends");
    assert.equal(tidyName("JUAN DELA CRUZ"), "Juan dela Cruz");
    assert.equal(tidyName("Makati Lady Eagles Club"), "Makati Lady Eagles Club");
    assert.equal(tidyName("an individual donor"), "an individual donor");
  });
  it("masks staff names in bank text", () => {
    const staff = ["Desiree", "Loquinario", "Cathlyn", "Jeffrey", "Olfato"];
    assert.equal(maskNames("BOB IBFT OPR-0719 · Des Salary", staff), "BOB IBFT OPR-0719 · staff Salary");
    assert.equal(maskNames("ONLINE TRANSFER BOB TO 4709 · Cath Salary", staff), "ONLINE TRANSFER BOB TO 4709 · staff Salary");
    assert.equal(maskNames("ONLINE TRANSFER · Jeff", staff), "ONLINE TRANSFER · staff");
    assert.equal(maskNames("BOB IBFT · Marge Cash Advance", staff), "BOB IBFT · staff Cash Advance");
    assert.equal(maskNames("ONLINE PAYMENT BOB TO MERALCO · repair of office sliding door", staff), "ONLINE PAYMENT BOB TO MERALCO · repair of office sliding door");
  });
  it("spots a draft that copied an earlier note", () => {
    const april = "Expenses rose with payroll and utilities, while some permit, facility, patient-support, software, and transport costs were advanced and settled in June.";
    assert.equal(sharesPhrase("Expenses rose with payroll and utilities, while some permit costs were settled.", april), true);
    assert.equal(sharesPhrase("Expenses were led by reimbursements of advances and payroll.", april), false);
  });
  it("lists the months a statement covers, capped", () => {
    assert.deepEqual(monthsCovered("2026-07-01", "2026-07-31"), ["2026-07"]);
    assert.deepEqual(monthsCovered("2026-11-15", "2027-01-05"), ["2026-11", "2026-12", "2027-01"]);
    assert.deepEqual(monthsCovered("2026-01-01", "2026-12-31"), ["2026-01", "2026-02", "2026-03"]);
  });
});

let seq = 0;
const txn = (postingDate, debit, credit, runningBalance, category = null) => ({ postingDate, rowSeq: ++seq, debit, credit, runningBalance, category });

describe("monthlySummary", () => {
  it("expenses are all debits, donation is credits minus the bank's interest", () => {
    const txns = [
      txn("2026-01-05", 0, 217600, 545480.08),
      txn("2026-01-10", 227317.21, 0, 318162.87),
      txn("2026-01-30", 0, 18.25, 318181.12, "interest"), // INTEREST PAYMENT -- not a donation
      txn("2026-01-30", 3.65, 0, 318177.47, "interest"), // INTEREST WITHHELD -- still money out
    ];
    const { rows, total } = monthlySummary(txns, 2026, {});
    const jan = rows[0];
    assert.equal(jan.month, "2026-01");
    assert.equal(jan.hasData, true);
    assert.equal(jan.expenses, 227320.86);
    assert.equal(jan.donation, 217600);
    assert.equal(jan.net, -9720.86);
    assert.ok(Math.abs(jan.pctSpent - 1.04467) < 0.00001);
    assert.equal(total.monthsWithData, 1);
  });

  it("a month with no statement shows nothing, not zero", () => {
    const { rows, total } = monthlySummary([txn("2026-01-05", 0, 100, 100)], 2026, {});
    assert.equal(rows[7].month, "2026-08");
    assert.equal(rows[7].hasData, false);
    assert.equal(rows[7].expenses, null);
    assert.equal(rows[7].donation, null);
    assert.equal(rows[7].pctSpent, null);
    assert.equal(total.monthsWithData, 1);
  });

  it("percent is null, not infinite, when nothing came in", () => {
    const { rows } = monthlySummary([txn("2026-02-01", 500, 0, 100)], 2026, {});
    assert.equal(rows[1].expenses, 500);
    assert.equal(rows[1].donation, 0);
    assert.equal(rows[1].pctSpent, null);
  });

  it("the total percent is the ratio of the totals, not the average of the months", () => {
    const txns = [txn("2026-01-05", 100, 100, 0), txn("2026-02-05", 100, 300, 0)];
    const { total } = monthlySummary(txns, 2026, {});
    assert.equal(total.expenses, 200);
    assert.equal(total.donation, 400);
    assert.equal(total.pctSpent, 0.5); // averaging 100% and 33% would say 66.7%
  });

  it("attaches each month's written drivers", () => {
    const { rows } = monthlySummary([], 2026, { "2026-03": "March was quiet." });
    assert.equal(rows[2].drivers, "March was quiet.");
    assert.equal(rows[3].drivers, "");
  });

  it("ignores other years", () => {
    const { total } = monthlySummary([txn("2025-12-31", 50, 0, 0), txn("2026-01-02", 0, 10, 10)], 2026, {});
    assert.equal(total.expenses, 0);
    assert.equal(total.donation, 10);
  });
});

describe("cashInBank / availableYears", () => {
  it("is the balance on the latest line, by date then statement order", () => {
    const txns = [txn("2026-07-31", 0, 5, 2437537.26), txn("2026-07-31", 19.1, 0, 2437518.16), txn("2026-06-30", 0, 1, 1)];
    assert.deepEqual(cashInBank(txns), { amount: 2437518.16, asOf: "2026-07-31" });
    assert.equal(cashInBank([]), null);
  });

  it("lists years with data plus the current one, newest first", () => {
    assert.deepEqual(availableYears([txn("2025-03-01", 0, 1, 1)], 2026), [2026, 2025]);
    assert.deepEqual(availableYears([], 2026), [2026]);
  });
});

describe("donorBreakdown", () => {
  let id = 0;
  const receipt = (date, amount, donorName, sourceSheet, extra = {}) => ({
    id: `r${++id}`, date, amount, direction: "inflow", donorName, sourceSheet, approvalStatus: "approved", duplicateOfId: null, ...extra,
  });

  it("folds the same gift recorded on two tabs a day apart, keeping the BDO line", () => {
    const rows = [receipt("2026-07-03", 30000, "Manny Chan", "CASH"), receipt("2026-07-02", 30000, "Manny Chan", "BDO_CASH DONATIONS")];
    const lines = donorBreakdown(rows, "2026-07");
    assert.equal(lines.length, 1);
    assert.equal(lines[0].date, "2026-07-02");
    assert.equal(lines[0].duplicates, 1);
  });

  it("keeps two genuinely separate gifts from the same donor", () => {
    const rows = [receipt("2026-07-01", 5000, "Annie Ching", "CASH"), receipt("2026-07-15", 5000, "Annie Ching", "CASH")];
    assert.equal(donorBreakdown(rows, "2026-07").length, 2);
  });

  it("treats spacing and case in a name as the same donor", () => {
    const rows = [receipt("2026-07-02", 10000, "San Beda College of Law", "BDO_CASH DONATIONS"), receipt("2026-07-03", 10000, "san beda  college of law", "CASH")];
    assert.equal(donorBreakdown(rows, "2026-07").length, 1);
  });

  it("folds a row the importer already marked as a duplicate, whatever its date", () => {
    const kept = receipt("2026-07-02", 1000, "Cora Reyes", "BDO_CASH DONATIONS");
    const dup = receipt("2026-07-20", 1000, "Cora Reyes", "CASH", { duplicateOfId: kept.id });
    const lines = donorBreakdown([kept, dup], "2026-07");
    assert.equal(lines.length, 1);
    assert.equal(lines[0].duplicates, 1);
  });

  it("never lists the bank tab, reimbursements, outflows, unnamed or undated rows", () => {
    const rows = [
      receipt("2026-07-02", 100, "Bank Statement row", "Bank Statement"),
      receipt("2026-07-02", 100, "Butch", "Butch reimburments"),
      receipt("2026-07-02", 100, "Someone", "CASH", { direction: "outflow" }),
      receipt("2026-07-02", 100, null, "CASH"),
      receipt(null, 100, "Nobody Knows When", "CASH"),
      receipt("2026-07-02", 100, "Keyed in the app", null),
    ];
    const lines = donorBreakdown(rows, "2026-07");
    assert.deepEqual(lines.map((l) => l.donorName), ["Keyed in the app"]);
  });

  it("sorts by amount, largest first", () => {
    const rows = [receipt("2026-07-02", 500, "A", "CASH"), receipt("2026-07-03", 50000, "B", "CASH"), receipt("2026-07-04", 5000, "C", "CASH")];
    assert.deepEqual(donorBreakdown(rows, "2026-07").map((l) => l.donorName), ["B", "C", "A"]);
  });

  it("knows which months have receipts", () => {
    const rows = [receipt("2026-05-02", 1, "A", "CASH"), receipt("2026-07-02", 1, "B", "BDO_CASH DONATIONS"), receipt("2026-06-02", 1, "x", "Bank Statement")];
    assert.deepEqual(monthsWithReceipts(rows), ["2026-07", "2026-05"]);
  });
});
