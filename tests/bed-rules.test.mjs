import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bedChoices, bedRuleProblem, familyLink, keptBeds, occupantsOf, relationshipFromText, roomBreaches, roomSex, sexFromRelationship } from "../lib/utils/bed-rules.ts";

// Room 1 (B1, B2), Room 2 (B3, B4), Room 3 (B5): the house in miniature.
const rooms = [
  { id: "r1", name: "Room 1", bounds: null, sortOrder: 1 },
  { id: "r2", name: "Room 2", bounds: null, sortOrder: 2 },
  { id: "r3", name: "Room 3", bounds: null, sortOrder: 3 },
];
const unit = (code, roomId, over = {}) => ({
  id: `u-${code}`, code, roomId, status: "available", sharedUnit: false, x: 0.5, y: 0.5, w: 0.08, h: 0.12, rotationDeg: 0, capacity: 1, active: true, ...over,
});
const units = [unit("B1", "r1"), unit("B2", "r1"), unit("B3", "r2"), unit("B4", "r2"), unit("B5", "r3")];
const positions = units.map((u) => ({ id: `${u.id}-A`, unitId: u.id, label: "A" }));
const patients = [
  { id: "kid-a", sex: "F" },
  { id: "kid-d", sex: "M", familyId: "fam" },
  { id: "kid-s", sex: "F", familyId: "fam" },
  { id: "kid-boy", sex: "M" },
];
const carers = [
  { id: "mom-a", patientId: "kid-a", sex: "F" },
  { id: "dad-d", patientId: "kid-d", sex: "M" },
  { id: "mom-s", patientId: "kid-s", sex: "F" },
];
const stay = (id, patientId, unitCode, carerId) => ({ id, patientId, bedPositionId: `u-${unitCode}-A`, carerId, checkInAt: "2026-09-01", status: "in_house" });
const people = { carers, patients };
const codes = (beds) => beds.map((b) => b.unit.code).join(",");

describe("sexFromRelationship", () => {
  it("reads the relationships that say it, and nothing from the rest", () => {
    assert.equal(sexFromRelationship(" Mother "), "F");
    assert.equal(sexFromRelationship("lolo"), "M");
    assert.equal(sexFromRelationship("Guardian"), undefined);
    assert.equal(sexFromRelationship(null), undefined);
  });
});

describe("bedChoices", () => {
  it("an empty house offers Room 1 only; later rooms say why", () => {
    const { allowed, blocked } = bedChoices(units, positions, [], rooms, people, { who: { sex: "F" } });
    assert.equal(codes(allowed), "B1,B2");
    assert.equal(blocked[0].reason, "Room 1 still has a free bed: fill it first");
  });

  it("a man carer skips a women's Room 1 and takes Room 2, not Room 3", () => {
    const stays = [stay("s1", "kid-a", "B1", "mom-a")];
    const { allowed, blocked } = bedChoices(units, positions, stays, rooms, people, { who: { sex: "M" } });
    assert.equal(codes(allowed), "B3,B4");
    assert.deepEqual(blocked.map((b) => `${b.unit.code}: ${b.reason}`), ["B2: Room 1 is a women's room now", "B5: Room 2 still has a free bed: fill it first"]);
  });

  it("the same family may share a room", () => {
    const stays = [stay("s1", "kid-s", "B1", "mom-s")];
    const { allowed } = bedChoices(units, positions, stays, rooms, people, { who: { sex: "M", familyId: "fam" } });
    assert.equal(codes(allowed), "B2");
  });

  it("a held bed counts, by its carer's sex", () => {
    const holds = [{ id: "h1", unitId: "u-B1", reservedFor: "x", expectedOn: "2026-09-28", patientId: null, carerSex: "F" }];
    const { allowed } = bedChoices(units, positions, [], rooms, people, { who: { sex: "M" }, holds });
    assert.equal(codes(allowed), "B3,B4");
  });

  it("a child's own hold does not count against them", () => {
    const holds = [{ id: "h1", unitId: "u-B1", reservedFor: "x", expectedOn: "2026-09-28", patientId: "kid-boy", carerSex: "M" }];
    const { allowed } = bedChoices(units, positions, [], rooms, people, { who: { sex: "M" }, holds, forHoldId: "h1", patientId: "kid-boy" });
    assert.equal(codes(allowed), "B1,B2");
  });

  it("moving a stay ignores its own bed: leaving Room 1 is refused while it has room", () => {
    const stays = [stay("s1", "kid-a", "B1", "mom-a")];
    const { blocked } = bedChoices(units, positions, stays, rooms, people, { who: { sex: "F" }, ignoreStayId: "s1", excludeUnitId: "u-B1" });
    assert.equal(blocked.find((b) => b.unit.code === "B3")?.reason, "Room 1 still has a free bed: fill it first");
  });

  it("locked beds are not free: Room 2 opens when Room 1's other beds are locked", () => {
    const locked = units.map((u) => (u.code === "B2" ? { ...u, status: "maintenance" } : u));
    const stays = [stay("s1", "kid-a", "B1", "mom-a")];
    assert.equal(codes(bedChoices(locked, positions, stays, rooms, people, { who: { sex: "F" } }).allowed), "B3,B4");
  });

  it("without a known sex nothing is blocked (the form asks first)", () => {
    const { blocked } = bedChoices(units, positions, [stay("s1", "kid-a", "B1", "mom-a")], rooms, people, { who: {} });
    assert.equal(blocked.length, 0);
  });
});

describe("rooms", () => {
  it("say who they are for; a child without a carer counts as their own sex", () => {
    const stays = [stay("s1", "kid-a", "B1", "mom-a"), stay("s2", "kid-boy", "B3", undefined)];
    const occ = occupantsOf(units, positions, stays, carers, patients, []);
    assert.equal(roomSex("r1", occ), "F");
    assert.equal(roomSex("r2", occ), "M");
    assert.equal(roomSex("r3", occ), null);
    assert.equal(bedRuleProblem(units[1], { sex: "M" }, units, rooms, occ), "Room 1 is a women's room now");
  });
});

describe("roomBreaches", () => {
  it("flags a room with women and men carers, but not one family", () => {
    const mixed = [stay("s1", "kid-a", "B1", "mom-a"), stay("s2", "kid-d", "B2", "dad-d")];
    const family = [stay("s1", "kid-s", "B1", "mom-s"), stay("s2", "kid-d", "B2", "dad-d")];
    assert.deepEqual(roomBreaches(rooms, occupantsOf(units, positions, mixed, carers, patients, [])).map((r) => r.name), ["Room 1"]);
    assert.deepEqual(roomBreaches(rooms, occupantsOf(units, positions, family, carers, patients, [])), []);
  });
});

describe("relationshipFromText", () => {
  it("reads English and Filipino words as the form's choices", () => {
    assert.equal(relationshipFromText("nanay"), "Mother");
    assert.equal(relationshipFromText("Grand mother"), "Grandmother");
    assert.equal(relationshipFromText("TITO"), "Uncle");
    assert.equal(relationshipFromText("kapitbahay"), "Guardian");
    assert.equal(relationshipFromText(""), "");
  });
});

describe("familyLink", () => {
  it("joins the sibling's family, or starts one for both", () => {
    assert.deepEqual(familyLink({ id: "a" }, { id: "b", familyId: "f1" }), { familyId: "f1", updates: [{ id: "a", familyId: "f1" }] });
    assert.deepEqual(familyLink({ id: "a", familyId: "f0" }, { id: "b" }), { familyId: "f0", updates: [{ id: "b", familyId: "f0" }] });
    assert.deepEqual(familyLink({ id: "a" }, { id: "b" }, () => "new"), { familyId: "new", updates: [{ id: "a", familyId: "new" }, { id: "b", familyId: "new" }] });
    // A child not created yet: only the sibling changes now.
    assert.deepEqual(familyLink(undefined, { id: "b" }, () => "new"), { familyId: "new", updates: [{ id: "b", familyId: "new" }] });
    assert.deepEqual(familyLink({ id: "a", familyId: "f1" }, { id: "b", familyId: "f1" }).updates, []);
  });
});

describe("temporary beds (0092)", () => {
  // Room 1 (B1, B2 + T1), Room 2 (B3, B4), Room 3 (B5), Below Room 3 (T2).
  const roomsT = [...rooms, { id: "r4", name: "Below Room 3", bounds: null, sortOrder: 4 }];
  const unitsT = [...units, unit("T1", "r1", { temporary: true }), unit("T2", "r4", { temporary: true })];
  const positionsT = unitsT.map((u) => ({ id: `${u.id}-A`, unitId: u.id, label: "A" }));

  it("a free temporary bed never makes the next room wait", () => {
    const stays = [stay("s1", "kid-a", "B1", "mom-a"), stay("s2", "kid-s", "B2", "mom-s")];
    const { allowed, blocked } = bedChoices(unitsT, positionsT, stays, roomsT, people, { who: { sex: "F" } });
    assert.equal(codes(allowed), "B3,B4");
    assert.equal(blocked.find((b) => b.unit.code === "T1")?.reason, "Room 2 still has a free bed: fill it first");
  });

  it("a temporary bed is refused while any room has a free regular bed for them", () => {
    const { blocked } = bedChoices(unitsT, positionsT, [], roomsT, people, { who: { sex: "F" } });
    assert.equal(blocked.find((b) => b.unit.code === "T1")?.reason, "Room 1 still has a free bed: fill it first");
    assert.equal(blocked.find((b) => b.unit.code === "T2")?.reason, "Room 1 still has a free bed: fill it first");
  });

  it("once the regular beds are full or closed to them, the temporary beds open, Room 1 before the area below Room 3", () => {
    const stays = [
      stay("s1", "kid-a", "B1", "mom-a"), stay("s2", "kid-s", "B2", "mom-s"),
      stay("s3", "kid-boy", "B3"), stay("s4", "kid-d", "B4", "dad-d"), stay("s5", "kid-boy", "B5"),
    ];
    const { allowed, blocked } = bedChoices(unitsT, positionsT, stays, roomsT, people, { who: { sex: "F" } });
    assert.equal(codes(allowed), "T1");
    assert.equal(blocked.find((b) => b.unit.code === "T2")?.reason, "Room 1 still has a free bed: fill it first");
  });
});

describe("Settings switches and long stays (0163)", () => {
  const today = "2026-11-18";
  const closed = (id, patientId, unitCode, carerId, checkInAt, visitId) => ({
    id, patientId, bedPositionId: `u-${unitCode}-A`, carerId, checkInAt, checkOutAt: checkInAt === today ? undefined : today,
    checkOutReason: "daily_reset", status: "checked_out", visitId,
  });
  // kid-a's visit: two nights in B3, the second closed by this morning's reset; tonight is night 3.
  const visitA = [
    { ...closed("n1", "kid-a", "B3", "mom-a", "2026-11-16", "n1"), checkOutAt: "2026-11-17" },
    closed("n2", "kid-a", "B3", "mom-a", "2026-11-17", "n1"),
  ];
  const keptOf = (stays, fromNight = 3, now = "10:00") => keptBeds(units, positions, stays, carers, patients, { fromNight, until: "18:00", today, now });

  it("fill order off: Room 2 is offered while Room 1 is free", () => {
    const { allowed } = bedChoices(units, positions, [], rooms, people, { who: { sex: "F" }, rules: { fillOrder: false, singleSex: true } });
    assert.equal(codes(allowed), "B1,B2,B3,B4,B5");
  });

  it("single-sex off: a man may join a women's room, and Room 1 is his to fill first", () => {
    const stays = [stay("s1", "kid-a", "B1", "mom-a")];
    const rules = { fillOrder: true, singleSex: false };
    const { allowed, blocked } = bedChoices(units, positions, stays, rooms, people, { who: { sex: "M" }, rules });
    assert.equal(codes(allowed), "B2");
    assert.equal(blocked.find((b) => b.unit.code === "B3")?.reason, "Room 1 still has a free bed: fill it first");
    assert.deepEqual(roomBreaches(rooms, occupantsOf(units, positions, [...stays, stay("s2", "kid-boy", "B2")], carers, patients, []), rules), []);
  });

  it("a long stay's bed is kept for them, counts as taken, and is theirs to take back", () => {
    const kept = keptOf(visitA);
    assert.deepEqual(kept.map((k) => [k.unitId, k.keptFor, k.keptNight]), [["u-B3", "kid-a", 3]]);
    const rules = { fillOrder: true, singleSex: true, keptUntil: "18:00" };
    const other = bedChoices(units, positions, visitA, rooms, people, { who: { sex: "F" }, kept, rules });
    assert.equal(other.blocked.find((b) => b.unit.code === "B3")?.reason, "Bed B3 is kept for a family on their night 3 until 6:00 PM");
    const own = bedChoices(units, positions, visitA, rooms, people, { who: { sex: "F" }, kept, rules, patientId: "kid-a" });
    assert.equal(own.blocked.find((b) => b.unit.code === "B3")?.reason, "Room 1 still has a free bed: fill it first");
  });

  it("nothing is kept on night 2, after the finalize time, once they are back, or with the setting off", () => {
    assert.equal(keptOf(visitA.slice(1).map((s) => ({ ...s, visitId: "n2" }))).length, 0);
    assert.equal(keptOf(visitA, 3, "18:00").length, 0);
    assert.equal(keptOf([...visitA, stay("s3", "kid-a", "B4", "mom-a")]).length, 0);
    assert.equal(keptOf(visitA, null).length, 0);
  });
});
