// lib/utils/tracker-cash.ts (0110): the Donation Tracker's CASH and BDO tabs -> lines. Invented names only.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cashLinesFromTab, depositsFromTab } from "../lib/utils/tracker-cash.ts";

const TODAY = "2026-10-25";

describe("cashLinesFromTab", () => {
  it("reads date, donor, payment type, amount, invoice and notes; skips titles, totals and bad dates", () => {
    const rows = [
      ["Column 1", "TIME", "DONOR'S FULL NAME", "CONTACT NUMBER", "EMAIL", "ADDRESS", "Donor Type", "TYPE", "AMOUNT", "INVOICE NUMBER", "RECEIVED BY", "NOTES"],
      ["1/5/2026", "10:00", "Test Donor One", "0917", "a@b.c", "QC", "", "BANK TRANSFER", "1,500.00", "SI-0001", "", "for the house"],
      ["7/30/3036", "", "Test Donor Two", "", "", "", "", "CASH", "500", "SI-0002", "", ""],
      ["TOTAL", "", "", "", "", "", "", "", "2,000.00", "", "", ""],
      ["12/1/2026", "", "Test Donor Three", "", "", "", "", "GCASH", "250", "", "", ""],
    ];
    const r = cashLinesFromTab(rows, TODAY);
    assert.deepEqual(r.lines, [{ sheet_row: 2, date: "2026-01-05", donor_name: "Test Donor One", kind: "cash", payment_method: "bank_transfer", amount: 1500, invoice_number: "SI-0001", notes: "for the house" }]);
    assert.equal(r.problems.length, 2); // the 3036 date and the gift that hasn't come yet
    assert.ok(!r.lines.some((l) => "contact" in l || "email" in l));
  });
});

describe("depositsFromTab", () => {
  it("keeps this year's deposits with their slip links; older years are history", () => {
    const rows = [
      ["Date", "Amount", "Donor's Name", "Service Invoice No. ", "Links for Deposit Slips with Donor's Name", "Links for Deposit Slips without Donor's Name", "", "NOTES"],
      ["6/2/2025", "1,000.00", "Test Donor Old", "SI-0900", "https://x/old", "", "", ""],
      ["3/3/2026", "2,500.00", "Test Donor One", "SI-0001", "https://x/named", "", "", "deposited by staff"],
      ["3/4/2026", "300", "", "", "", "https://x/anon", "", ""],
    ];
    const r = depositsFromTab(rows, TODAY);
    assert.deepEqual(
      r.lines.map((l) => [l.sheet_row, l.date, l.amount, l.invoice_number, l.slip_named, l.slip_anonymous, l.donor_name]),
      [
        [3, "2026-03-03", 2500, "SI-0001", "https://x/named", null, "Test Donor One"],
        [4, "2026-03-04", 300, null, null, "https://x/anon", "Anonymous"],
      ]
    );
    assert.equal(r.problems.length, 0);
  });
});
