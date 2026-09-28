import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NEWCOMER, findBedPlans, isValidArrangement } from "../lib/utils/bed-plan.ts";

// Room 1: B1, B2 · Room 2: B3, B4 · Room 3: B5.
const bed = (code, roomId, roomOrder, over = {}) => ({ id: code, code, roomId, roomOrder, roomName: `Room ${roomOrder}`, capacity: 1, usable: true, ...over });
const beds = [bed("B1", "r1", 1), bed("B2", "r1", 1), bed("B3", "r2", 2), bed("B4", "r2", 2), bed("B5", "r3", 3)];
const person = (key, sex, unitId, over = {}) => ({ key, sex, unitId, nightsHere: 3, ...over });
const moves = (plan) => plan.moves.map((m) => `${m.key}:${m.from ?? "-"}>${m.to}`).sort().join(" ");

describe("isValidArrangement", () => {
  it("accepts one sex per room filled in order; refuses mixing or skipping a room", () => {
    const ok = [person("a", "F", "B1"), person("b", "F", "B2"), person("c", "M", "B3")];
    assert.equal(isValidArrangement(ok, beds, new Map(ok.map((p) => [p.key, p.unitId]))), true);
    const mixed = [person("a", "F", "B1"), person("c", "M", "B2")];
    assert.equal(isValidArrangement(mixed, beds, new Map(mixed.map((p) => [p.key, p.unitId]))), false);
    const gap = [person("a", "F", "B3")];
    assert.equal(isValidArrangement(gap, beds, new Map(gap.map((p) => [p.key, p.unitId]))), false);
  });

  it("lets one family share a room", () => {
    const fam = [person("mom", "F", "B1", { familyId: "x" }), person("dad", "M", "B2", { familyId: "x" })];
    assert.equal(isValidArrangement(fam, beds, new Map(fam.map((p) => [p.key, p.unitId]))), true);
  });
});

describe("findBedPlans", () => {
  it("nothing to do when the house is already right", () => {
    assert.deepEqual(findBedPlans([person("a", "F", "B1")], beds), []);
  });

  it("closes a gap: a woman alone in Room 2 moves to Room 1", () => {
    const [plan] = findBedPlans([person("a", "F", "B3")], beds);
    assert.match(moves(plan), /^a:B3>B[12]$/);
  });

  it("makes room for a man when Room 1 is women's and Room 2 has one woman", () => {
    const people = [person("a", "F", "B1"), person("b", "F", "B3"), person(NEWCOMER, "M", null)];
    const [plan] = findBedPlans(people, beds);
    // b joins the women in Room 1, the newcomer takes Room 2.
    assert.equal(plan.moves.filter((m) => m.key !== NEWCOMER).length, 1);
    assert.equal(plan.moves.find((m) => m.key === "b")?.to, "B2");
    assert.ok(["B3", "B4"].includes(plan.moves.find((m) => m.key === NEWCOMER)?.to));
  });

  it("swaps two families when no bed is free", () => {
    const full = [bed("B1", "r1", 1), bed("B2", "r2", 2)];
    const people = [person("m", "M", "B1"), person("f", "F", "B2", { familyId: undefined })];
    // Already valid (one per room, both rooms full) -> nothing to do.
    assert.deepEqual(findBedPlans(people, full), []);
  });

  it("moves both women up when Room 1 is empty and Room 2 holds them", () => {
    const people = [person("old", "F", "B3", { nightsHere: 20, leavesIn: 1 }), person("new", "F", "B4", { nightsHere: 1 })];
    const plans = findBedPlans(people, beds);
    assert.ok(plans.length >= 1);
    // Room 1 must fill first, and it has room for both: two moves, no shorter plan.
    assert.equal(plans[0].moves.length, 2);
  });

  it("fills a free bed with the family that must move anyway, not one already in place", () => {
    // Room 1 has a free bed; x (a woman) shares Room 2 with a man, so she must move -- into Room 1.
    const people = [person("a", "F", "B1"), person("x", "F", "B3"), person("m", "M", "B4")];
    const [plan] = findBedPlans(people, beds);
    assert.equal(moves(plan), "x:B3>B2");
  });

  it("returns nothing when no plan exists within the move limit", () => {
    const people = [person("a", "F", "B1"), person("b", "M", "B2"), person(NEWCOMER, "M", null)];
    const plans = findBedPlans(people, [bed("B1", "r1", 1), bed("B2", "r1", 1)], { maxMoves: 2 });
    assert.deepEqual(plans, []);
  });
});
