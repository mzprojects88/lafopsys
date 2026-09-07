// Unit tests for lib/utils/employment.ts -- probation, service and document
// validity arithmetic over day keys.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { addMonths, daysBetween, documentValidity, probationMilestones, serviceMonths, serviceYears } from "../lib/utils/employment.ts";

describe("addMonths", () => {
  it("clamps to the last day of a shorter month", () => {
    assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
    assert.equal(addMonths("2028-01-31", 1), "2028-02-29");
    assert.equal(addMonths("2026-08-31", 6), "2027-02-28");
  });

  it("crosses years", () => {
    assert.equal(addMonths("2026-11-15", 3), "2027-02-15");
  });
});

describe("serviceMonths", () => {
  it("counts completed months, anniversary day inclusive", () => {
    assert.equal(serviceMonths("2024-07-05", "2026-09-08"), 26);
    assert.equal(serviceMonths("2026-05-26", "2026-09-08"), 3);
    assert.equal(serviceMonths("2026-05-26", "2026-09-26"), 4);
    assert.equal(serviceMonths("2026-05-26", "2026-09-25"), 3);
    assert.equal(serviceMonths("2026-09-10", "2026-09-08"), 0);
  });

  it("serviceYears floors", () => {
    assert.equal(serviceYears("2024-07-05", "2026-09-08"), 2);
    assert.equal(serviceYears("2025-10-01", "2026-09-08"), 0);
  });
});

describe("probationMilestones", () => {
  it("evaluation at day 150, probation ends six months from hiring (Art. 296)", () => {
    assert.deepEqual(probationMilestones("2026-05-26"), { evaluateBy: "2026-10-23", endsOn: "2026-11-26" });
  });
});

describe("daysBetween", () => {
  it("is signed", () => {
    assert.equal(daysBetween("2026-09-08", "2026-09-30"), 22);
    assert.equal(daysBetween("2026-09-30", "2026-09-08"), -22);
  });
});

describe("documentValidity", () => {
  const today = "2026-09-08";
  it("uses an explicit expiry first", () => {
    assert.deepEqual(documentValidity({ issuedOn: "2026-01-01", expiresOn: "2026-09-20" }, 12, today), { state: "expiring", expiresOn: "2026-09-20" });
  });
  it("derives expiry from issue date and validity", () => {
    assert.deepEqual(documentValidity({ issuedOn: "2025-08-01", expiresOn: null }, 12, today), { state: "expired", expiresOn: "2026-08-01" });
    assert.deepEqual(documentValidity({ issuedOn: "2026-06-01", expiresOn: null }, 12, today), { state: "valid", expiresOn: "2027-06-01" });
  });
  it("is unknown without dates or validity", () => {
    assert.deepEqual(documentValidity({ issuedOn: "2026-06-01", expiresOn: null }, null, today), { state: "unknown", expiresOn: null });
    assert.deepEqual(documentValidity({ issuedOn: null, expiresOn: null }, 12, today), { state: "unknown", expiresOn: null });
  });
});
