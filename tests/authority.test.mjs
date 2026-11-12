import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { whoSigns } from "../lib/utils/authority.ts";

const rows = [
  { step: "endorse", requester_role: "driver", staff_id: "office" },
  { step: "endorse", requester_role: "admin", staff_id: null },
  { step: "validate", staff_id: "finance" },
  { step: "review", staff_id: "office", alternate_staff_id: "finance2" },
  { step: "approve", max_amount: 5000, staff_id: "ceo" },
  { step: "approve", min_amount: 5000, staff_id: "board" },
  { step: "approve", urgent: true, staff_id: "urgent" },
  { step: "approve_payment", staff_id: "ceo" },
];

describe("who signs a request", () => {
  it("picks each step's signers for the role and amount", () => {
    const s = Object.fromEntries(whoSigns(rows, "driver", 3000).map((x) => [x.step, x.signers]));
    assert.deepEqual(s, { endorse: ["office"], validate: ["finance"], review: ["office", "finance2"], approve: ["ceo"], approve_payment: ["ceo"], release: [] });
  });
  it("from 5,000 the other approver; the urgent one only for urgent requests", () => {
    assert.deepEqual(whoSigns(rows, "driver", 5000).find((x) => x.step === "approve").signers, ["board"]);
    assert.deepEqual(whoSigns(rows, "driver", 3000, true).find((x) => x.step === "approve").signers, ["ceo", "urgent"]);
  });
  it("says when a role needs no endorsement, and when a role has no endorser at all", () => {
    assert.equal(whoSigns(rows, "admin", 100)[0].notNeeded, true);
    const chef = whoSigns(rows, "chef", 100)[0];
    assert.deepEqual([chef.notNeeded, chef.signers.length], [false, 0]);
  });
});
