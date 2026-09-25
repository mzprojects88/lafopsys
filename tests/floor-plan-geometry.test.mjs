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

// ---- increment 2: bed size, custom labels ----
import {
  BED_MAX_SIZE,
  BED_MIN_SIZE,
  clampSize,
  diffLabels,
  mergeLabels,
  resizeFromPointer,
  resizeHandleLocal,
} from "../lib/utils/floor-plan-geometry.ts";

describe("resizeFromPointer", () => {
  const centre = { x: 0.5, y: 0.5 };
  const c = toPx(centre);
  it("reads the corner in the bed's own frame at rotation 0", () => {
    const s = resizeFromPointer(centre, 0, { x: c.x + 44, y: c.y + 88 });
    assert.ok(Math.abs(s.w - 88 / PLAN_W) < 1e-5);
    assert.ok(Math.abs(s.h - 176 / PLAN_H) < 1e-5);
  });
  it("gives the same size at 90 degrees from the rotated corner", () => {
    // at 90°, the bed's local +x points down the page and local +y points left
    const s = resizeFromPointer(centre, 90, { x: c.x - 88, y: c.y + 44 });
    assert.ok(Math.abs(s.w - 88 / PLAN_W) < 1e-5);
    assert.ok(Math.abs(s.h - 176 / PLAN_H) < 1e-5);
  });
  it("is symmetric: dragging past the centre never goes negative", () => {
    const a = resizeFromPointer(centre, 0, { x: c.x + 44, y: c.y + 88 });
    const b = resizeFromPointer(centre, 180, { x: c.x + 44, y: c.y + 88 });
    assert.deepEqual(a, b);
  });
  it("clamps to the minimum near the centre and the maximum far away", () => {
    assert.deepEqual(resizeFromPointer(centre, 0, { x: c.x + 1, y: c.y + 1 }), { w: BED_MIN_SIZE, h: BED_MIN_SIZE });
    assert.deepEqual(resizeFromPointer(centre, 0, { x: c.x + 5000, y: c.y + 5000 }), { w: BED_MAX_SIZE, h: BED_MAX_SIZE });
    // at 45° a pointer on the diagonal has no local y; one off the diagonal fills both axes
    const s45 = resizeFromPointer(centre, 45, { x: c.x + 5000, y: c.y + 500 });
    assert.deepEqual(s45, { w: BED_MAX_SIZE, h: BED_MAX_SIZE });
  });
  it("rounds to five decimals", () => {
    const s = resizeFromPointer(centre, 0, { x: c.x + 50, y: c.y + 100 });
    assert.equal(s.w, Math.round(s.w * 1e5) / 1e5);
    assert.equal(s.h, Math.round(s.h * 1e5) / 1e5);
  });
  it("places the handle at the bottom-right corner", () => {
    const p = resizeHandleLocal(0.08, 0.12);
    assert.ok(Math.abs(p.x - (0.08 * PLAN_W) / 2) < 0.01 && Math.abs(p.y - (0.12 * PLAN_H) / 2) < 0.01);
    assert.equal(clampSize(0.001), BED_MIN_SIZE);
    assert.equal(clampSize(0.9), BED_MAX_SIZE);
  });
  it("a resized bed near the corner is pulled back inside by clampCentre", () => {
    const c2 = clampCentre({ x: 0.95, y: 0.95 }, 0.4, 0.4, 0);
    assert.ok(c2.x < 0.95 && c2.y < 0.95);
    assert.ok(Math.abs(c2.x - 0.8) < 1e-9 && Math.abs(c2.y - 0.8) < 1e-9);
  });
});

describe("labels draft", () => {
  const l = (id, over = {}) => ({ id, text: "Nurse", x: 0.5, y: 0.5, rotationDeg: 0, fontSize: 16, ...over });
  const live = [l("a"), l("b"), l("c")];
  it("diffs inserts, updates and deletes", () => {
    const draft = new Map([
      ["tmp-1", l("tmp-1", { text: "Exit" })],
      ["a", l("a", { x: 0.1 })],
      ["b", l("b")],
      ["gone", l("gone")],
      ["tmp-2", l("tmp-2")],
    ]);
    const deleted = new Set(["c", "tmp-2", "never"]);
    const d = diffLabels(live, draft, deleted);
    assert.deepEqual(d.insertTmpIds, ["tmp-1"]);
    assert.deepEqual(d.inserts, [{ text: "Exit", x: 0.5, y: 0.5, rotationDeg: 0, fontSize: 16 }]);
    assert.deepEqual(d.updates.map((u) => u.id), ["a"]);
    assert.deepEqual(d.deletes, ["c"]);
  });
  it("merges for drawing: deleted hidden, edits overlaid, tmp appended, orphans dropped", () => {
    const draft = new Map([
      ["a", l("a", { x: 0.1 })],
      ["gone", l("gone")],
      ["tmp-1", l("tmp-1", { text: "Exit" })],
      ["tmp-2", l("tmp-2")],
    ]);
    const merged = mergeLabels(live, draft, new Set(["c", "tmp-2"]));
    assert.deepEqual(merged.map((m) => m.id), ["a", "b", "tmp-1"]);
    assert.equal(merged[0].x, 0.1);
  });
});
