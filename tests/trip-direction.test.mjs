// lib/utils/trip-direction.ts (0096): how a trip's direction reads on cards, prints and the report.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { directionLabel, leaveBefore, tripWords } from "../lib/utils/trip-direction.ts";

describe("trip direction", () => {
  it("a pick-up goes to LAF House, a delivery to the hospital", () => {
    assert.equal(tripWords("from_hospital").long, "Pick-up · to LAF House");
    assert.equal(tripWords("to_hospital").long, "Delivery · to the hospital");
    assert.equal(tripWords("to_hospital").arrived, "Arrived at the hospital");
  });
  it("the report tells a delivery from a hospital run without passengers", () => {
    assert.equal(directionLabel("to_hospital", true), "Delivery · to the hospital");
    assert.equal(directionLabel("to_hospital", false), "Hospital run");
    assert.equal(directionLabel("errand", false), "Errand");
    assert.equal(directionLabel("other", false), "Other");
  });
  it("a delivery leaves an hour before the earliest check-up, never before 5:00 AM", () => {
    assert.equal(leaveBefore(["09:30", "08:15"]), "07:15");
    assert.equal(leaveBefore(["05:30"]), "05:00");
    assert.equal(leaveBefore(["after lunch"]), "07:00");
  });
});
