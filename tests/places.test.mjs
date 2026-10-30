// lib/utils/places.ts (0123): saved transport places, distance and the directions link.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { directionsUrl, estimateRoadKm, findPlace, parseCoords, placesFromSettings, straightKm } from "../lib/utils/places.ts";

describe("transport places", () => {
  it("reads coordinates as Google Maps copies them, and from a Maps link", () => {
    assert.deepEqual(parseCoords("14.627712, 121.026051"), { lat: 14.627712, lng: 121.026051 });
    assert.deepEqual(parseCoords("14.6 121.03"), { lat: 14.6, lng: 121.03 });
    assert.deepEqual(parseCoords("https://www.google.com/maps/place/X/@14.6234567,121.0212345,17z"), { lat: 14.623457, lng: 121.021235 });
    assert.deepEqual(parseCoords("https://maps.google.com/?q=14.61,121.02"), { lat: 14.61, lng: 121.02 });
    assert.equal(parseCoords("National Children's Hospital"), null);
    assert.equal(parseCoords("95, 121"), null);
  });
  it("matches a destination to a saved place by name", () => {
    const places = [{ name: "National Children's Hospital", lat: 14.6, lng: 121 }, { name: "PGH", lat: 14.57, lng: 120.98 }];
    assert.equal(findPlace(places, "national childrens hospital")?.name, "National Children's Hospital");
    assert.equal(findPlace(places, "PGH Taft")?.name, "PGH");
    assert.equal(findPlace(places, "Puregold Cubao"), null);
    assert.equal(findPlace(places, null), null);
  });
  it("estimates road km from the straight line", () => {
    const a = { lat: 14.6277, lng: 121.026 };
    const b = { lat: 14.6177, lng: 121.026 };
    assert.ok(Math.abs(straightKm(a, b) - 1.112) < 0.01);
    assert.equal(estimateRoadKm(a, b), 1);
    assert.equal(estimateRoadKm(a, { lat: 14.55, lng: 120.99 }), Math.round(straightKm(a, { lat: 14.55, lng: 120.99 }) * 1.3));
  });
  it("builds a keyless Google Maps directions link", () => {
    const url = directionsUrl({ lat: 14.6, lng: 121 }, { lat: 14.62, lng: 121.02 });
    assert.ok(url.startsWith("https://www.google.com/maps/dir/?api=1&"));
    assert.ok(url.includes("destination=14.6%2C121"));
    assert.ok(url.includes("origin=14.62%2C121.02"));
  });
  it("keeps only well-formed saved places", () => {
    assert.deepEqual(placesFromSettings([{ name: " NCH ", lat: "14.6", lng: 121 }, { name: "", lat: 1, lng: 1 }, { name: "Bad", lat: 200, lng: 1 }, null]), [{ name: "NCH", lat: 14.6, lng: 121 }]);
    assert.deepEqual(placesFromSettings("x"), []);
  });
});
