/**
 * The bed rules (0070), the app's copy of ops.bed_rule_problem -- change both
 * together. A room holds women carers or men carers, not both (the first
 * carer in an empty room decides; carers of one family may share); Room 1
 * fills before Room 2, Room 2 before Room 3, and a later room opens only when
 * every earlier one is full or holds carers of the other sex. The sex that
 * counts is the carer's, or the child's own when no carer stays. The
 * database refuses a bed that breaks them; here they grey out beds with the
 * reason. Pure; relative imports so tests/ can run it under node --test.
 */
import type { BedPosition, Room, Unit } from "../types/house-ops";
import type { Carer, Patient, Stay } from "../types/patient";
import { bedLabel, isActiveStay, isBedAssignable, nextFreePosition, roomForUnit, type AssignableBed, type BedHold } from "./beds.ts";

export type Sex = "F" | "M";

/** Whose sex and family decide where someone may sleep. */
export interface Sleeper {
  sex?: Sex;
  familyId?: string;
}

export interface Occupant {
  roomId: string | null;
  unitId: string;
  sex?: Sex;
  familyId?: string;
}

const F_RELATIONSHIPS = ["mother", "grandmother", "aunt", "sister", "stepmother", "step-mother", "godmother", "nanay", "ina", "lola", "tita", "tiya", "ate", "ninang"];
const M_RELATIONSHIPS = ["father", "grandfather", "uncle", "brother", "stepfather", "step-father", "godfather", "tatay", "ama", "lolo", "tito", "tiyo", "kuya", "ninong"];

/** "Mother" says F, "Father" says M; "Guardian" or "Sibling" says nothing (0070 filled carers the same way). */
export function sexFromRelationship(relationship: string | null | undefined): Sex | undefined {
  const r = (relationship ?? "").trim().toLowerCase();
  if (F_RELATIONSHIPS.includes(r)) return "F";
  if (M_RELATIONSHIPS.includes(r)) return "M";
  return undefined;
}

/** The sex that counts for a stay: its carer's, or the child's own without one. */
export function sleeperOfStay(stay: Stay, carers: Carer[], patients: Patient[]): Sleeper {
  const patient = patients.find((p) => p.id === stay.patientId);
  const carer = stay.carerId ? carers.find((c) => c.id === stay.carerId) : undefined;
  return { sex: stay.carerId ? carer?.sex : patient?.sex, familyId: patient?.familyId };
}

/** Everyone in a bed now (stays in the house, open holds), except the stay being moved and the child being placed. */
export function occupantsOf(
  units: Unit[],
  positions: BedPosition[],
  stays: Stay[],
  carers: Carer[],
  patients: Patient[],
  holds: readonly BedHold[],
  ignore: { stayId?: string; patientId?: string | null; holdId?: string } = {}
): Occupant[] {
  const unitOf = new Map(positions.map((p) => [p.id, units.find((u) => u.id === p.unitId)]));
  const out: Occupant[] = [];
  for (const s of stays) {
    if (!isActiveStay(s) || s.id === ignore.stayId) continue;
    const unit = unitOf.get(s.bedPositionId);
    if (!unit) continue;
    out.push({ roomId: unit.roomId ?? null, unitId: unit.id, ...sleeperOfStay(s, carers, patients) });
  }
  for (const h of holds) {
    if (h.id === ignore.holdId || (ignore.patientId && h.patientId === ignore.patientId)) continue;
    const unit = units.find((u) => u.id === h.unitId);
    if (!unit) continue;
    const familyId = h.patientId ? patients.find((p) => p.id === h.patientId)?.familyId : undefined;
    out.push({ roomId: unit.roomId ?? null, unitId: unit.id, sex: h.carerSex ?? undefined, familyId });
  }
  return out;
}

const clashes = (o: Occupant, who: Sleeper) => !!o.sex && o.sex !== who.sex && !(who.familyId && o.familyId === who.familyId);

/** Why this sleeper may not take this bed, or null. Mirrors ops.bed_rule_problem. */
export function bedRuleProblem(unit: Unit, who: Sleeper, units: Unit[], rooms: Room[], occupants: Occupant[]): string | null {
  const room = roomForUnit(unit, rooms);
  if (!room || !who.sex) return null;
  if (occupants.some((o) => o.roomId === room.id && clashes(o, who))) {
    return `${room.name} is a ${who.sex === "F" ? "men's" : "women's"} room now`;
  }
  for (const earlier of [...rooms].filter((r) => r.sortOrder < room.sortOrder).sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (occupants.some((o) => o.roomId === earlier.id && clashes(o, who))) continue;
    const free = units.some(
      (u) => u.roomId === earlier.id && u.active && u.status === "available" && occupants.filter((o) => o.unitId === u.id).length < u.capacity
    );
    if (free) return `${earlier.name} still has a free bed: fill it first`;
  }
  return null;
}

/** Who a room is for right now: F, M, "mixed" (a breach, or a family), or null when empty or unknown. */
export function roomSex(roomId: string, occupants: Occupant[]): Sex | "mixed" | null {
  const sexes = new Set(occupants.filter((o) => o.roomId === roomId && o.sex).map((o) => o.sex));
  if (sexes.size === 0) return null;
  return sexes.size > 1 ? "mixed" : [...sexes][0]!;
}

export interface BlockedBed extends AssignableBed {
  reason: string;
}

/**
 * The beds this person may take (`allowed`) and the free beds the rules keep
 * them off, with why (`blocked`), room by room. Without a known sex nothing
 * is blocked -- the form asks for it first, and the database checks again.
 */
export function bedChoices(
  units: Unit[],
  positions: BedPosition[],
  stays: Stay[],
  rooms: Room[],
  people: { carers: Carer[]; patients: Patient[] },
  opts: { who: Sleeper; excludeUnitId?: string; holds?: readonly BedHold[]; forHoldId?: string; ignoreStayId?: string; patientId?: string | null }
): { allowed: AssignableBed[]; blocked: BlockedBed[] } {
  const holds = opts.holds ?? [];
  const occupants = occupantsOf(units, positions, stays, people.carers, people.patients, holds, {
    stayId: opts.ignoreStayId,
    patientId: opts.patientId,
    holdId: opts.forHoldId,
  });
  const allowed: AssignableBed[] = [];
  const blocked: BlockedBed[] = [];
  for (const unit of units) {
    if (unit.id === opts.excludeUnitId) continue;
    if (!isBedAssignable(unit, positions, stays, holds, opts.forHoldId)) continue;
    const position = nextFreePosition(unit, positions, stays);
    if (!position) continue;
    const bed = { unit, position, room: roomForUnit(unit, rooms), label: bedLabel(unit, rooms) };
    const reason = bedRuleProblem(unit, opts.who, units, rooms, occupants);
    if (reason) blocked.push({ ...bed, reason });
    else allowed.push(bed);
  }
  const order = (a: AssignableBed, b: AssignableBed) =>
    (a.room?.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.room?.sortOrder ?? Number.MAX_SAFE_INTEGER) ||
    a.unit.code.localeCompare(b.unit.code, undefined, { numeric: true });
  return { allowed: allowed.sort(order), blocked: blocked.sort(order) };
}

/** Rooms where carers of both sexes sleep and they are not one family: a
 * breach (an allowed exception, or someone placed before the rules) to fix. */
export function roomBreaches(rooms: Room[], occupants: Occupant[]): Room[] {
  return rooms.filter((room) => {
    const here = occupants.filter((o) => o.roomId === room.id && o.sex);
    return here.some((a) => here.some((b) => clashes(b, { sex: a.sex, familyId: a.familyId })));
  });
}

/** The relationships the admission forms offer, in their order. */
export const CARER_RELATIONSHIPS = ["Mother", "Father", "Grandmother", "Grandfather", "Aunt", "Uncle", "Sibling", "Guardian"];

// How NCH's sheet and families write them ("nanay", "Grand mother", "tito").
const RELATIONSHIP_WORDS: Record<string, string> = {
  mother: "Mother", nanay: "Mother", ina: "Mother", mama: "Mother", mommy: "Mother", nay: "Mother",
  father: "Father", tatay: "Father", ama: "Father", papa: "Father", daddy: "Father", tay: "Father",
  grandmother: "Grandmother", lola: "Grandmother",
  grandfather: "Grandfather", lolo: "Grandfather",
  aunt: "Aunt", auntie: "Aunt", tita: "Aunt", tiya: "Aunt",
  uncle: "Uncle", tito: "Uncle", tiyo: "Uncle",
  sibling: "Sibling", sister: "Sibling", brother: "Sibling", ate: "Sibling", kuya: "Sibling",
  guardian: "Guardian",
};

/** A relationship typed anywhere as one of the form's choices: known words
 * (English or Filipino) map to theirs, anything else is "Guardian", nothing is "". */
export function relationshipFromText(raw: string | null | undefined): string {
  const key = (raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "");
  if (!key) return "";
  return RELATIONSHIP_WORDS[key] ?? "Guardian";
}
