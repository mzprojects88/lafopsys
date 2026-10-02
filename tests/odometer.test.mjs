// Unit tests for lib/utils/odometer.ts -- the odometer drums (Fuel Monitoring, 0076).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isUnusualTrip, odometerDigits, parseOdometer, readingProblem, routeKey } from "../lib/utils/odometer.ts";

describe("odometerDigits", () => {
  it("pads a reading to six drums", () => {
    assert.deepEqual(odometerDigits(160648), ["1", "6", "0", "6", "4", "8"]);
    assert.deepEqual(odometerDigits(42), ["0", "0", "0", "0", "4", "2"]);
  });
  it("adds a drum when the reading outgrows six", () => {
    assert.equal(odometerDigits(1000000).length, 7);
  });
  it("shows zeros for no reading", () => {
    assert.deepEqual(odometerDigits(null), ["0", "0", "0", "0", "0", "0"]);
  });
});

describe("parseOdometer", () => {
  it("reads what a driver types, commas and all", () => {
    assert.equal(parseOdometer("160,648 km"), 160648);
    assert.equal(parseOdometer("  000123"), 123);
  });
  it("is empty when nothing was typed", () => {
    assert.equal(parseOdometer(""), null);
    assert.equal(parseOdometer("km"), null);
  });
  it("keeps at most seven digits", () => {
    assert.equal(parseOdometer("123456789"), 1234567);
  });
});

describe("readingProblem", () => {
  it("needs a reading", () => {
    assert.match(readingProblem(null, 100), /Enter/);
  });
  it("refuses one below the last reading, allows equal or more", () => {
    assert.match(readingProblem(99, 100), /can't go back/);
    assert.equal(readingProblem(100, 100), null);
    assert.equal(readingProblem(150, 100), null);
    assert.equal(readingProblem(5, null), null);
  });
});

describe("routeKey", () => {
  it("names an NCH pick-up by itself", () => {
    assert.equal(routeKey("from_hospital", null), "pickup");
    assert.equal(routeKey("from_hospital", "  "), "pickup");
  });
  it("keys an errand by purpose and tidy destination", () => {
    assert.equal(routeKey("errand", "  Puregold   Cubao "), "errand:puregold cubao");
    assert.equal(routeKey("to_hospital", "PGH"), "to_hospital:pgh");
  });
});

describe("isUnusualTrip", () => {
  const usual = { medianKm: 24, trips: 9 };
  it("accepts a trip near the usual", () => {
    assert.equal(isUnusualTrip(30, usual), false);
  });
  it("questions one far from it", () => {
    assert.equal(isUnusualTrip(240, usual), true);
    assert.equal(isUnusualTrip(2, usual), true);
  });
  it("allows at least 10 km either way on short routes", () => {
    assert.equal(isUnusualTrip(14, { medianKm: 5, trips: 5 }), false);
    assert.equal(isUnusualTrip(16, { medianKm: 5, trips: 5 }), true);
  });
  it("says nothing until the route has three trips", () => {
    assert.equal(isUnusualTrip(500, { medianKm: 24, trips: 2 }), false);
    assert.equal(isUnusualTrip(500, null), false);
  });
});
