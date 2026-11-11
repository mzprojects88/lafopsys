import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ledgerDay, ledgerTotals, stageOf } from "../lib/utils/voucher-ledger.ts";

describe("voucher ledger", () => {
  it("names the stage, with Paid on its own and drafts left out", () => {
    assert.equal(stageOf("returned"), "payment_request");
    assert.equal(stageOf("endorsed"), "approved_request");
    assert.equal(stageOf("reviewed"), "payment_voucher");
    assert.equal(stageOf("payment_approved"), "approved_voucher");
    assert.equal(stageOf("released"), "paid");
    assert.equal(stageOf("cancelled"), "stopped");
    assert.equal(stageOf("draft"), null);
  });
  it("counts each request on the chosen date, in Manila", () => {
    const v = { status: "prepared", submittedAt: "2026-11-30T17:00:00Z", createdAt: "2026-11-29T00:00:00Z", releasedAt: null };
    const ev = [{ action: "prepare", at: "2026-12-02T03:00:00Z" }];
    assert.equal(ledgerDay("requested", v, ev), "2026-12-01");
    assert.equal(ledgerDay("voucher", v, ev), "2026-12-02");
    // Not prepared yet: the voucher date is the day it was sent; not approved or paid: no day.
    assert.equal(ledgerDay("voucher", v, []), "2026-12-01");
    assert.equal(ledgerDay("approved", v, ev), null);
    assert.equal(ledgerDay("paid", v, ev), null);
    assert.equal(ledgerDay("paid", { ...v, releasedAt: "2026-12-05T01:00:00Z" }, ev), "2026-12-05");
    // From the registers: sent on the register date; a correction made today moves nothing.
    const hist = { status: "approved", submittedAt: "2025-08-14T16:00:00Z", createdAt: "2025-08-14T16:00:00Z", releasedAt: null };
    const fixedToday = [{ action: "history", at: "2026-11-12T02:00:00Z" }];
    assert.equal(ledgerDay("voucher", hist, fixedToday), "2025-08-15");
    assert.equal(ledgerDay("approved", hist, fixedToday), "2025-08-15");
    assert.equal(ledgerDay("approved", { ...hist, status: "prepared" }, fixedToday), null);
  });
  it("adds gross, withheld and net to the centavo", () => {
    assert.deepEqual(ledgerTotals([{ amount: 1000.1, ewtAmount: 10.01 }, { amount: 0.2, ewtAmount: 0 }]), { gross: 1000.3, ewt: 10.01, net: 990.29 });
  });
});
