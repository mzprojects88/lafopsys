// Unit tests for lib/utils/vehicle-expenses.ts -- the fuel and expense log's rules (0077).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { changeRule, pricePerLitre } from "../lib/utils/vehicle-expenses.ts";

describe("pricePerLitre", () => {
  it("divides to the centavo", () => {
    assert.equal(pricePerLitre(2345.5, 38.4), 61.08);
  });
  it("is empty without litres", () => {
    assert.equal(pricePerLitre(500, null), null);
    assert.equal(pricePerLitre(500, 0), null);
  });
});

describe("changeRule", () => {
  // 10:00 Manila on 2 Oct is 02:00 UTC; 23:30 Manila on 1 Oct is 15:30 UTC.
  const now = new Date("2026-10-02T02:00:00Z");
  const today = { loggedBy: "jeff", loggedAt: "2026-10-01T23:00:00Z", voidedAt: null }; // 07:00 Manila, 2 Oct
  const yesterday = { loggedBy: "jeff", loggedAt: "2026-10-01T15:30:00Z", voidedAt: null };

  it("lets whoever logged it change it the same Manila day", () => {
    assert.equal(changeRule(today, "jeff", false, now), "free");
  });
  it("not the next day, nor someone else", () => {
    assert.equal(changeRule(yesterday, "jeff", false, now), "no");
    assert.equal(changeRule(today, "chris", false, now), "no");
  });
  it("after that the Super Admin, with a reason", () => {
    assert.equal(changeRule(yesterday, "admin-1", true, now), "reason");
  });
  it("a posted entry stays as it is too", () => {
    assert.equal(changeRule({ ...today, posting: { cashEntryId: "c" } }, "jeff", true, now), "no");
  });
  it("a voided entry stays as it is, for everyone", () => {
    assert.equal(changeRule({ ...today, voidedAt: "2026-10-02T01:00:00Z" }, "jeff", true, now), "no");
  });
});
