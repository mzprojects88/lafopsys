import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PLAN_H,
  PLAN_W,
  clampCentre,
  nextBedCode,
  normalizeRotation,
  pointInPolygon,
  roomAtPoint,
  roomCentroid,
  snapPx,
  toNorm,
  toPx,
} from "../lib/utils/floor-plan-geometry.ts";

// Room 2 as seeded by 0047: a rectangle with the T&B2 notch cut out of its
// bottom-right corner.
const ROOM_2 = [
  [0.529, 0.477],
  [0.906, 0.477],
  [0.906, 0.674],
  [0.681, 0.674],
  [0.681, 0.743],
  [0.529, 0.743],
];

describe("pointInPolygon", () => {
  it("knows inside from outside", () => {
    assert.equal(pointInPolygon({ x: 0.6, y: 0.6 }, ROOM_2), true);
    assert.equal(pointInPolygon({ x: 0.3, y: 0.6 }, ROOM_2), false);
    assert.equal(pointInPolygon({ x: 0.6, y: 0.9 }, ROOM_2), false);
  });
  it("treats the L-notch (the toilet) as outside", () => {
    assert.equal(pointInPolygon({ x: 0.8, y: 0.71 }, ROOM_2), false);
    assert.equal(pointInPolygon({ x: 0.6, y: 0.71 }, ROOM_2), true);
  });
});

describe("roomAtPoint", () => {
  const rooms = [
    { id: "room-2", bounds: ROOM_2 },
    { id: "room-9", bounds: null },
  ];
  it("names the room under a point, null elsewhere", () => {
    assert.equal(roomAtPoint(rooms, { x: 0.6, y: 0.6 }), "room-2");
    assert.equal(roomAtPoint(rooms, { x: 0.1, y: 0.1 }), null);
  });
  it("centroid lands inside a convex room", () => {
    const c = roomCentroid([
      [0.184, 0.3],
      [0.704, 0.3],
      [0.704, 0.47],
      [0.184, 0.47],
    ]);
    assert.ok(Math.abs(c.x - 0.444) < 0.001);
    assert.ok(Math.abs(c.y - 0.385) < 0.001);
  });
});

describe("rotation and snapping", () => {
  it("normalises to 0..359", () => {
    assert.equal(normalizeRotation(-90), 270);
    assert.equal(normalizeRotation(450), 90);
    assert.equal(normalizeRotation(360), 0);
    assert.equal(normalizeRotation(89.6), 90);
  });
  it("snaps to the grid", () => {
    assert.equal(snapPx(13), 16);
    assert.equal(snapPx(11), 8);
    assert.equal(snapPx(100, 25), 100);
  });
  it("round-trips normalised and pixel space", () => {
    const px = toPx({ x: 0.5, y: 0.25 });
    assert.deepEqual(px, { x: PLAN_W / 2, y: PLAN_H / 4 });
    const n = toNorm(px);
    assert.ok(Math.abs(n.x - 0.5) < 1e-9 && Math.abs(n.y - 0.25) < 1e-9);
  });
});

describe("clampCentre", () => {
  it("keeps an upright bed's box inside the plan", () => {
    const c = clampCentre({ x: 0, y: 0 }, 0.08, 0.12, 0);
    assert.ok(Math.abs(c.x - 0.04) < 1e-9);
    assert.ok(Math.abs(c.y - 0.06) < 1e-9);
    const far = clampCentre({ x: 1, y: 1 }, 0.08, 0.12, 0);
    assert.ok(Math.abs(far.x - 0.96) < 1e-9);
    assert.ok(Math.abs(far.y - 0.94) < 1e-9);
  });
  it("swaps the extents for a bed on its side", () => {
    const c = clampCentre({ x: 0, y: 0 }, 0.08, 0.12, 90);
    // rotated 90°: the bed's height (0.12 * PLAN_H px) now spans x
    const halfW = (0.12 * PLAN_H) / 2 / PLAN_W;
    const halfH = (0.08 * PLAN_W) / 2 / PLAN_H;
    assert.ok(Math.abs(c.x - halfW) < 1e-6);
    assert.ok(Math.abs(c.y - halfH) < 1e-6);
  });
  it("leaves a bed already inside alone", () => {
    const c = clampCentre({ x: 0.5, y: 0.5 }, 0.08, 0.12, 45);
    assert.deepEqual(c, { x: 0.5, y: 0.5 });
  });
});

describe("nextBedCode", () => {
  it("counts past the highest code", () => {
    assert.equal(nextBedCode(["B1", "B13", "B2"]), "B14");
    assert.equal(nextBedCode([]), "B1");
    assert.equal(nextBedCode(["B7", "B99"]), "B100");
  });
});
