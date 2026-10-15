// lib/utils/gift-totals.ts (0095): food / non-food / cash totals for Donors > Totals.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { giftTotals } from "../lib/utils/gift-totals.ts";

const batch = (id, date, donorId, food, nonFood, arNumber = null, bookletArNumber = null) => ({ receiptId: id, date, donorId, arNumber, bookletArNumber, lines: 2, food, nonFood });
const gift = (id, date, donorId, amount, reference = null, currency = "PHP") => ({ id, date, donorId, reference, amount, currency });

const batches = [batch("r1", "2026-10-05", "d1", 8000.5, 732, "LAF-GIK-2026-0006"), batch("r2", "2026-10-02", "d2", 0, 1500, null, "0283"), batch("r3", "2026-09-30", null, 100, 0)];
const cash = [gift("c1", "2026-10-03", "d1", 5000, "INV-12"), gift("c2", "2026-10-04", "d2", 100, "INV-13", "USD")];

describe("donation totals", () => {
  it("adds food, non-food and peso cash; another currency is listed, not added", () => {
    const t = giftTotals(batches, cash);
    assert.deepEqual([t.food, t.nonFood, t.cash, t.total, t.otherCurrency], [8100.5, 2232, 5000, 15332.5, 1]);
    assert.deepEqual(t.rows.map((r) => r.key), ["gik:r1", "cash:c2", "cash:c1", "gik:r2", "gik:r3"]);
  });
  it("filters by donor", () => {
    const t = giftTotals(batches, cash, { donorId: "d1" });
    assert.deepEqual([t.food, t.nonFood, t.cash, t.rows.length], [8000.5, 732, 5000, 2]);
  });
  it("finds an AR, a booklet AR or a cash reference", () => {
    assert.deepEqual(giftTotals(batches, cash, { query: "gik-2026-0006" }).rows.map((r) => r.key), ["gik:r1"]);
    assert.deepEqual(giftTotals(batches, cash, { query: "0283" }).rows.map((r) => r.reference), ["Booklet 0283"]);
    assert.deepEqual(giftTotals(batches, cash, { query: "inv-12" }).rows.map((r) => r.key), ["cash:c1"]);
  });
  it("a batch with no AR yet says so", () => {
    assert.equal(giftTotals(batches, []).rows.find((r) => r.key === "gik:r3").reference, "No AR yet");
  });
});
