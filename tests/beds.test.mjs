import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assignableBeds,
  bedCounts,
  bedLabel,
  compareBedCodes,
  deriveBedStatus,
  houseCapacity,
  isBedAssignable,
  isBedOccupied,
  nextFreePosition,
  unitForBedPosition,
} from "../lib/utils/beds.ts";

const rooms = [
  { id: "room-1", name: "Room 1", bounds: null, sortOrder: 1 },
  { id: "room-2", name: "Room 2", bounds: null, sortOrder: 2 },
];

function unit(code, over = {}) {
  return {
    id: `unit-${code}`,
    code,
    roomId: "room-1",
    status: "available",
    sharedUnit: false,
    x: 0.5,
    y: 0.5,
    w: 0.08,
    h: 0.12,
    rotationDeg: 0,
    capacity: 1,
    active: true,
    ...over,
  };
}

function positionsFor(...units) {
  return units.flatMap((u) => ["A", "B", "C", "D"].map((label) => ({ id: `${u.id}-${label}`, unitId: u.id, label })));
}

function stay(bedPositionId, status = "in_house") {
  return { id: `stay-${bedPositionId}-${status}`, patientId: "p", bedPositionId, checkInAt: "2026-09-01", status };
}

describe("occupancy", () => {
  const b1 = unit("B1");
  const positions = positionsFor(b1);

  it("a capacity-1 bed with one active stay is occupied and not assignable", () => {
    const stays = [stay("unit-B1-A")];
    assert.equal(isBedOccupied(b1, positions, stays), true);
    assert.equal(deriveBedStatus(b1, positions, stays), "occupied");
    assert.equal(isBedAssignable(b1, positions, stays), false);
    assert.equal(nextFreePosition(b1, positions, stays)?.label, "B");
  });

  it("an overdue stay still occupies; a checked-out one does not", () => {
    assert.equal(isBedOccupied(b1, positions, [stay("unit-B1-A", "overdue")]), true);
    assert.equal(isBedOccupied(b1, positions, [stay("unit-B1-A", "checked_out")]), false);
    assert.equal(deriveBedStatus(b1, positions, [stay("unit-B1-A", "checked_out")]), "available");
  });

  it("a capacity-2 bed with one stay is still assignable, at the next label", () => {
    const b2 = unit("B2", { capacity: 2 });
    const pos = positionsFor(b2);
    const stays = [stay("unit-B2-A")];
    assert.equal(isBedOccupied(b2, pos, stays), false);
    assert.equal(isBedAssignable(b2, pos, stays), true);
    assert.equal(nextFreePosition(b2, pos, stays)?.id, "unit-B2-B");
  });

  it("the lock wins over occupancy", () => {
    const locked = unit("B3", { status: "maintenance", lockReason: "Broken slat" });
    const pos = positionsFor(locked);
    assert.equal(deriveBedStatus(locked, pos, [stay("unit-B3-A")]), "maintenance");
    assert.equal(deriveBedStatus(locked, pos, []), "maintenance");
    assert.equal(isBedAssignable(locked, pos, []), false);
  });

  it("a retired bed is never assignable", () => {
    const retired = unit("B4", { active: false });
    assert.equal(isBedAssignable(retired, positionsFor(retired), []), false);
  });
});

describe("assignableBeds", () => {
  const b10 = unit("B10", { roomId: "room-1" });
  const b2 = unit("B2", { roomId: "room-1" });
  const b5 = unit("B5", { roomId: "room-2" });
  const b7 = unit("B7", { roomId: null, x: null, y: null });
  const retired = unit("B8", { active: false });
  const units = [b10, b7, b5, retired, b2];
  const positions = positionsFor(...units);

  it("sorts room by room, B2 before B10, unplaced last, retired gone", () => {
    const beds = assignableBeds(units, positions, [], rooms);
    assert.deepEqual(
      beds.map((b) => b.label),
      ["B2 · Room 1", "B10 · Room 1", "B5 · Room 2", "B7 · Unplaced"]
    );
    assert.equal(beds[0].position.id, "unit-B2-A");
  });

  it("drops the occupied and the excluded bed", () => {
    const beds = assignableBeds(units, positions, [stay("unit-B5-A")], rooms, { excludeUnitId: "unit-B2" });
    assert.deepEqual(
      beds.map((b) => b.unit.code),
      ["B10", "B7"]
    );
  });

  it("labels an unplaced bed as such", () => {
    assert.equal(bedLabel(b7, rooms), "B7 · Unplaced");
    assert.equal(bedLabel(b5, rooms), "B5 · Room 2");
  });

  it("finds the unit behind a position", () => {
    assert.equal(unitForBedPosition("unit-B5-C", units, positions)?.code, "B5");
    assert.equal(unitForBedPosition("unit-B99-A", units, positions), undefined);
  });
});

describe("capacity and counts", () => {
  it("sums capacity over live beds only", () => {
    const units = [unit("B1"), unit("B2", { capacity: 2 }), unit("B3", { active: false, capacity: 4 })];
    assert.equal(houseCapacity(units), 3);
  });

  it("counts each live bed once, by derived status, and the unplaced ones", () => {
    const units = [
      unit("B1"),
      unit("B2", { x: null, y: null, roomId: null }),
      unit("B3", { status: "blocked", lockReason: "Wet" }),
      unit("B4", { status: "maintenance", lockReason: "Paint" }),
      unit("B5", { active: false }),
    ];
    const positions = positionsFor(...units);
    const counts = bedCounts(units, positions, [stay("unit-B1-A"), stay("unit-B5-A")]);
    assert.deepEqual(counts, { available: 1, occupied: 1, maintenance: 1, blocked: 1, unplaced: 1, total: 4 });
  });

  it("orders codes naturally", () => {
    assert.deepEqual(["B10", "B2", "B1"].sort(compareBedCodes), ["B1", "B2", "B10"]);
  });
});
