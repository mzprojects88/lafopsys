/**
 * The one place that says whether a bed is free (0047). A unit is a physical
 * bed; its stored status is only the lock (available / maintenance /
 * blocked). "Occupied" is derived here from active stays on the unit's
 * positions, counted against its capacity -- never read from the row.
 * Pure functions, relative imports only: tests/ runs this file directly
 * under node --test.
 */
import type { BedPosition, BedStatus, Room, Unit } from "../types/house-ops";
import type { Stay } from "../types/patient";
import { compareBedCodes } from "./floor-plan-geometry.ts";

export { compareBedCodes };

/** A bed held for a child who has not arrived yet (0065): not a stay, but not free for anyone else either. */
export interface BedHold {
  id: string;
  unitId: string;
  reservedFor: string;
  expectedOn: string;
}

/** Holds on this bed, other than the one being used right now. */
function holdsOn(unit: Unit, holds: readonly BedHold[], exceptHoldId?: string): number {
  return holds.filter((h) => h.unitId === unit.id && h.id !== exceptHoldId).length;
}

export function isActiveStay(stay: Stay): boolean {
  return stay.status === "in_house" || stay.status === "overdue";
}

/** A unit's positions in label order (A first). */
export function positionsForUnit(unitId: string, positions: BedPosition[]): BedPosition[] {
  return positions.filter((p) => p.unitId === unitId).sort((a, b) => a.label.localeCompare(b.label));
}

export function activeStaysForUnit(unit: Unit, positions: BedPosition[], stays: Stay[]): Stay[] {
  const ids = new Set(positionsForUnit(unit.id, positions).map((p) => p.id));
  return stays.filter((s) => isActiveStay(s) && ids.has(s.bedPositionId));
}

export function isBedOccupied(unit: Unit, positions: BedPosition[], stays: Stay[]): boolean {
  return activeStaysForUnit(unit, positions, stays).length >= unit.capacity;
}

/** What the floor plan shows: the lock wins over occupancy, occupancy over a hold. */
export function deriveBedStatus(unit: Unit, positions: BedPosition[], stays: Stay[], holds: readonly BedHold[] = []): BedStatus {
  if (unit.status !== "available") return unit.status;
  const inUse = activeStaysForUnit(unit, positions, stays).length;
  if (inUse >= unit.capacity) return "occupied";
  return inUse + holdsOn(unit, holds) >= unit.capacity ? "reserved" : "available";
}

/** May an admission or transfer land here? A held bed only for the child it is held for (`exceptHoldId`). */
export function isBedAssignable(unit: Unit, positions: BedPosition[], stays: Stay[], holds: readonly BedHold[] = [], exceptHoldId?: string): boolean {
  return (
    unit.active &&
    unit.status === "available" &&
    activeStaysForUnit(unit, positions, stays).length + holdsOn(unit, holds, exceptHoldId) < unit.capacity
  );
}

/** The lowest position label with no active stay, or null when the bed is full. */
export function nextFreePosition(unit: Unit, positions: BedPosition[], stays: Stay[]): BedPosition | null {
  const taken = new Set(stays.filter(isActiveStay).map((s) => s.bedPositionId));
  return positionsForUnit(unit.id, positions).find((p) => !taken.has(p.id)) ?? null;
}

export function roomForUnit(unit: Unit, rooms: Room[]): Room | null {
  return (unit.roomId && rooms.find((r) => r.id === unit.roomId)) || null;
}

/** "B7 · Room 2", or "B7 · Unplaced" while the admin has not drawn it yet. */
export function bedLabel(unit: Unit, rooms: Room[]): string {
  const room = roomForUnit(unit, rooms);
  return `${unit.code} · ${room?.name ?? "Unplaced"}`;
}

export interface AssignableBed {
  unit: Unit;
  position: BedPosition;
  room: Room | null;
  label: string;
}

/**
 * Every bed an admission may take, with the position it would take, sorted
 * room by room (then B2 before B10); beds not yet on the plan come last.
 */
export function assignableBeds(
  units: Unit[],
  positions: BedPosition[],
  stays: Stay[],
  rooms: Room[],
  opts: { excludeUnitId?: string; holds?: readonly BedHold[]; forHoldId?: string } = {}
): AssignableBed[] {
  const out: AssignableBed[] = [];
  for (const unit of units) {
    if (unit.id === opts.excludeUnitId) continue;
    if (!isBedAssignable(unit, positions, stays, opts.holds ?? [], opts.forHoldId)) continue;
    const position = nextFreePosition(unit, positions, stays);
    if (!position) continue;
    out.push({ unit, position, room: roomForUnit(unit, rooms), label: bedLabel(unit, rooms) });
  }
  return out.sort((a, b) => {
    const ra = a.room ? a.room.sortOrder : Number.MAX_SAFE_INTEGER;
    const rb = b.room ? b.room.sortOrder : Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return compareBedCodes(a.unit.code, b.unit.code);
  });
}

export function unitForBedPosition(bedPositionId: string, units: Unit[], positions: BedPosition[]): Unit | undefined {
  const position = positions.find((p) => p.id === bedPositionId);
  return position ? units.find((u) => u.id === position.unitId) : undefined;
}

/** Admission slots across the live beds -- what "Total Capacity" means. */
export function houseCapacity(units: Unit[]): number {
  return units.filter((u) => u.active).reduce((sum, u) => sum + u.capacity, 0);
}

export interface BedCounts {
  available: number;
  occupied: number;
  reserved: number;
  maintenance: number;
  blocked: number;
  unplaced: number;
  total: number;
}

/** Live beds only; a retired bed counts nowhere. */
export function bedCounts(units: Unit[], positions: BedPosition[], stays: Stay[], holds: readonly BedHold[] = []): BedCounts {
  const counts: BedCounts = { available: 0, occupied: 0, reserved: 0, maintenance: 0, blocked: 0, unplaced: 0, total: 0 };
  for (const unit of units) {
    if (!unit.active) continue;
    counts.total += 1;
    counts[deriveBedStatus(unit, positions, stays, holds)] += 1;
    if (unit.x === null || unit.y === null) counts.unplaced += 1;
  }
  return counts;
}
