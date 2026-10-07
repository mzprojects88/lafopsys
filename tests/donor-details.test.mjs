// Unit tests for lib/utils/donor-details.ts: the add/edit donor checks and the duplicate warning.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkDonorInput, likelyDuplicates, normalizeDonorName } from "../lib/utils/donor-details.ts";

const base = { name: "Maria Santos", type: "individual", taxJurisdiction: "PH", email: "", phone: "", tin: "" };
const donor = (id, name, email) => ({ id, name, email, type: "individual", taxJurisdiction: "PH", firstGiftDate: "", lastGiftDate: "", lifetimeValue: 0, giftCount: 0 });

describe("donor details", () => {
  it("names match across titles, case, accents and punctuation", () => {
    assert.equal(normalizeDonorName("Ms. María  Santos-Cruz"), "maria santos cruz");
    assert.equal(normalizeDonorName("DR. JOSE RIZAL"), normalizeDonorName("jose rizal"));
  });

  it("flags a same-name or same-email donor, but not the donor being edited", () => {
    const all = [donor("1", "Maria Santos", "maria@example.org"), donor("2", "Juan Cruz", undefined)];
    assert.deepEqual(likelyDuplicates(all, { name: "ms. maria santos", email: "" }).map((d) => d.id), ["1"]);
    assert.deepEqual(likelyDuplicates(all, { name: "Someone Else", email: "MARIA@example.org " }).map((d) => d.id), ["1"]);
    assert.deepEqual(likelyDuplicates(all, { name: "Maria Santos", email: "" }, "1"), []);
    assert.deepEqual(likelyDuplicates(all, { name: "", email: "" }), []);
  });

  it("trims input and rejects what can't be right", () => {
    assert.deepEqual(checkDonorInput({ ...base, name: "  Maria   Santos ", email: " m@x.org " }), { ok: true, value: { ...base, email: "m@x.org" } });
    assert.equal(checkDonorInput({ ...base, name: "M" }).ok, false);
    assert.equal(checkDonorInput({ ...base, email: "not-an-email" }).ok, false);
    assert.equal(checkDonorInput({ ...base, phone: "call me" }).ok, false);
    assert.equal(checkDonorInput({ ...base, tin: "12" }).ok, false);
    assert.equal(checkDonorInput({ ...base, tin: "123-456-789-000", phone: "+63 917 000 0000" }).ok, true);
  });
});
