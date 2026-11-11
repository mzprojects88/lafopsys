import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readHistory } from "../lib/utils/voucher-history.ts";
import { parseAmount as parseMoney, parseDate as parseDay } from "../lib/utils/bank-statement.ts";

const ctx = {
  accountsByCode: new Map([
    ["5303", [{ id: "a5303", name: "Gasoline - Patient" }]],
    ["5204", [{ id: "a5204r", name: "Repairs and Maintenance" }, { id: "a5204h", name: "House Parent Housing and Expenses" }]],
    ["5934", [{ id: "a5934", name: "Vehicle Fuel & Gas" }]],
  ]),
  classOf: (code) => (code.startsWith("53") ? { t1: "PRG", t3: "TRN" } : code.startsWith("52") ? { t1: "PRG", t3: "HSG" } : { t1: "ADM", t3: null }),
  fundOf: (label) => ({ "one child": "OC", unrestricted: "UNR", laf: "UNR", life: "LIFE" })[label.trim().toLowerCase()] ?? null,
  staffOf: (name) => (name === "Prepared Person" ? "s1" : null),
};
const PV_HEAD = ["Seq", "Cash Voucher No.", "Date", "Payee / Recipient", "Purpose / Payment For", "COA #", "Account", "Type of Funding", "Prepared By", "Reviewed / Checked By", "Approved By", "Supporting Documents Attachment / Link", "Status", "Date Paid", "Total Amount", "Remarks"];
const DET_HEAD = ["Cash Voucher No.", "Particulars", "COA Code", "Account Name", "Reference / OR / Invoice", "Qty", "Unit Cost", "Amount"];
const pv = (no, extra = {}) => {
  const r = Object.fromEntries(PV_HEAD.map((h) => [h, ""]));
  Object.assign(r, { "Cash Voucher No.": no, Date: "2026-08-03", "Payee / Recipient": "A shop", "Purpose / Payment For": "Fuel", "COA #": "5303", Account: "Gasoline - Patient", "Type of Funding": "One Child", "Total Amount": "1,500.00" }, extra);
  return PV_HEAD.map((h) => r[h]);
};

describe("voucher history: reading the registers", () => {
  it("reads dates and money as the sheet writes them", () => {
    assert.equal(parseDay("2026-08-02"), "2026-08-02");
    assert.equal(parseDay("8/2/2026"), "2026-08-02");
    assert.equal(parseDay("Aug 2, 2026"), "2026-08-02");
    assert.equal(parseDay("soon"), null);
    assert.equal(parseDay("2/30/2026"), null);
    assert.equal(parseDay("25/8/2026"), null);
    assert.equal(parseMoney("₱1,234.50"), 1234.5);
    assert.equal(parseMoney("(250)"), -250);
    assert.equal(parseMoney(""), null);
  });

  it("a clean PV: its lines, coding, fund, signers and status", () => {
    const { vouchers, skipped } = readHistory("PV", [PV_HEAD, pv("LAF-080326-1", { "Prepared By": "Prepared Person", "Approved By": "Someone" })], [DET_HEAD, ["LAF-080326-1", "Diesel", "5303", "Gasoline - Patient", "OR-9", "2", "750", "1,500.00"]], ctx);
    assert.equal(skipped, 0);
    const v = vouchers[0];
    assert.equal(v.key, "PV:LAF-080326-1:1");
    assert.equal(v.fundId, "OC");
    assert.equal(v.status, "approved");
    assert.deepEqual(v.reasons, []);
    assert.deepEqual(v.lines.map((l) => [l.accountId, l.t1Id, l.t3Id, l.amount, l.orNumber]), [["a5303", "PRG", "TRN", 1500, "OR-9"]]);
    assert.deepEqual(v.signers.map((s) => [s.action, s.staffId]), [["prepare", "s1"], ["approve", null]]);
  });

  it("flags what Finance must clean up, and keeps every row of a repeated number", () => {
    const { vouchers, skipped } = readHistory(
      "PV",
      [PV_HEAD, pv("N-1", { "Type of Funding": "", "COA #": "59521", Account: "Something" }), pv("N-1"), pv(""), pv("N-2", { Status: "Phone", "Total Amount": "900" })],
      [DET_HEAD, ["N-2", "Fuel", "5303", "Vehicle Fuel", "", "1", "800", "800"]],
      ctx
    );
    assert.equal(skipped, 1);
    assert.deepEqual(vouchers.map((v) => v.key), ["PV:N-1:1", "PV:N-1:2", "PV:N-2:1"]);
    assert.deepEqual(new Set(vouchers[0].reasons), new Set(["duplicate_number", "no_fund", "unknown_code"]));
    assert.deepEqual(new Set(vouchers[2].reasons), new Set(["unknown_status", "name_differs", "total_differs"]));
    assert.equal(vouchers[2].status, "prepared");
    assert.equal(vouchers[2].total, 800);
  });

  it("a negative register total is kept at zero and flagged", () => {
    const { vouchers } = readHistory("PV", [PV_HEAD, pv("R-1", { "Total Amount": "(250)" })], [DET_HEAD], ctx);
    assert.equal(vouchers[0].total, 0);
    assert.ok(vouchers[0].reasons.includes("negative_amount"));
  });

  it("5204 picks the account by the name the register gives; a voucher without details gets one line", () => {
    const { vouchers } = readHistory("PV", [PV_HEAD, pv("H-1", { "COA #": "5204", Account: "House Parent Housing and Expenses", "Total Amount": "300", Status: "Paid", "Date Paid": "8/10/2026" })], [DET_HEAD], ctx);
    assert.equal(vouchers[0].lines.length, 1);
    assert.equal(vouchers[0].lines[0].accountId, "a5204h");
    assert.equal(vouchers[0].paidOn, "2026-08-10");
    assert.equal(vouchers[0].status, "approved");
  });
});
