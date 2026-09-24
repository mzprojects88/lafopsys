// Unit tests for lib/utils/site.ts -- on-site / off-site for a punch (DTR phase 4).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { distanceMeters, formatDistance, siteOf } from "../lib/utils/site.ts";

const house = { lat: 14.6275, lng: 121.0262, radiusM: 20 };

describe("distanceMeters", () => {
  it("about 111 m per 0.001 degree of latitude", () => {
    const d = distanceMeters({ lat: 14.6275, lng: 121.0262 }, { lat: 14.6285, lng: 121.0262 });
    assert.ok(d > 110 && d < 112, String(d));
  });
});

describe("siteOf", () => {
  it("within 20 m is on-site", () => {
    assert.deepEqual(siteOf({ lat: 14.62765, lng: 121.0262 }, house), { status: "on_site", distanceM: 17 });
  });
  it("beyond it is off-site, with the distance", () => {
    const r = siteOf({ lat: 14.6285, lng: 121.0262 }, house);
    assert.equal(r.status, "off_site");
    assert.equal(r.distanceM, 111);
  });
  it("no position, or no pin yet, is unknown", () => {
    assert.deepEqual(siteOf({ lat: null, lng: null }, house), { status: "unknown", distanceM: null });
    assert.deepEqual(siteOf({ lat: 14.6, lng: 121 }, { lat: null, lng: null, radiusM: 20 }), { status: "unknown", distanceM: null });
  });
});

describe("formatDistance", () => {
  it("metres, then kilometres", () => {
    assert.deepEqual([18, 999, 1234, 25_400].map(formatDistance), ["18 m", "999 m", "1.2 km", "25 km"]);
  });
});
