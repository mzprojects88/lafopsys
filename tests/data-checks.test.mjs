// lib/utils/data-checks.ts (0122): the findings Accounting confirms.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkCashTab, checkStatement } from "../lib/utils/data-checks.ts";

const line = (row, date, amount, invoice) => ({ sheet_row: row, date, amount, invoice_number: invoice });

describe("data checks", () => {
  it("reads unreadable rows without the donor's name, and skips other years' history", () => {
    const out = checkCashTab("CASH", [], ["Row 24: the date \"1O/2/2026\" can't be read (Some Donor, 5,528.30).", "Row 9: the date 1/15/2025 is not in 2026 (Another Donor, 20,000.00)."]);
    assert.equal(out.length, 1);
    assert.equal(out[0].key, "cash.unreadable:24");
    assert.ok(!out[0].title.includes("Donor"));
    assert.equal(out[0].severity, "error");
  });
  it("finds missing, non-numeric, reused and skipped paper numbers", () => {
    const out = checkCashTab("CASH", [line(2, "2026-10-01", 100, "0101"), line(3, "2026-10-02", 200, "0101"), line(4, "2026-10-03", 300, null), line(5, "2026-10-04", 400, "PV"), line(6, "2026-10-05", 500, "0104")], []);
    const kinds = out.map((f) => f.kind).sort();
    assert.deepEqual(kinds, ["paper_missing", "paper_nonnumeric", "paper_reused", "paper_skipped"]);
    const reused = out.find((f) => f.kind === "paper_reused");
    assert.equal(reused.key, "cash.paper_reused:101");
    assert.equal(reused.details.rows.length, 2);
    const skipped = out.find((f) => f.kind === "paper_skipped");
    assert.equal(skipped.key, "cash.paper_skipped:0102-0103");
    assert.equal(skipped.severity, "info");
  });
  it("keys stay the same across reads so a decision sticks", () => {
    const a = checkCashTab("CASH", [line(2, "2026-10-01", 100, "0101"), line(3, "2026-10-02", 200, "0101")], []);
    const b = checkCashTab("CASH", [line(5, "2026-10-01", 100, "0101"), line(9, "2026-10-02", 200, "0101")], []);
    assert.equal(a[0].key, b[0].key);
  });
  it("flags a statement that stops before the last month's end", () => {
    assert.equal(checkStatement("BDO", "2026-07-31", "2026-10-30")[0].key, "bank.statement_behind:BDO");
    assert.deepEqual(checkStatement("BDO", "2026-09-30", "2026-10-30"), []);
    assert.equal(checkStatement("BPI", null, "2026-10-30")[0].title, "BPI: no bank statement lines yet");
  });
});
