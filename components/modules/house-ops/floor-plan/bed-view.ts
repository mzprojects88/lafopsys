import type { BedPosition, BedStatus, Room, Unit } from "@/lib/types/house-ops";
import type { Carer, Patient, Stay } from "@/lib/types/patient";
import { activeStaysForUnit, deriveBedStatus, positionsForUnit, roomForUnit, type BedHold } from "@/lib/utils/beds";

export interface BedOccupant {
  stay: Stay;
  patient?: Patient;
  carer?: Carer;
  position?: BedPosition;
}

/** A bed as the floor plan shows it: the unit, with any unsaved draft
 * geometry already applied, its derived status and who is in it. */
export interface BedView extends Unit {
  bedStatus: BedStatus;
  occupants: BedOccupant[];
  room: Room | null;
  /** Geometry differs from what is saved (edit mode). */
  dirty: boolean;
  /** Held for children who have not arrived yet (0065). */
  holds: BedHold[];
}

export const STATUS_FILL: Record<BedStatus, string> = {
  available: "#d1fae5",
  occupied: "#dbeafe",
  reserved: "#ede9fe",
  maintenance: "#fef3c7",
  blocked: "#fee2e2",
};

export const STATUS_STROKE: Record<BedStatus, string> = {
  available: "#10b981",
  occupied: "#3b82f6",
  reserved: "#8b5cf6",
  maintenance: "#f59e0b",
  blocked: "#ef4444",
};

export const STATUS_LABEL: Record<BedStatus, string> = {
  available: "Available",
  occupied: "Occupied",
  reserved: "Reserved",
  maintenance: "Maintenance",
  blocked: "Blocked",
};

export function buildBedViews(input: {
  units: Unit[];
  rooms: Room[];
  bedPositions: BedPosition[];
  stays: Stay[];
  patients: Patient[];
  carers: Carer[];
  draftFor: (unit: Unit) => Partial<Unit> | undefined;
  holds?: readonly BedHold[];
}): BedView[] {
  const { units, rooms, bedPositions, stays, patients, carers, draftFor, holds = [] } = input;
  return units
    .filter((u) => u.active)
    .map((base) => {
      const draft = draftFor(base);
      const unit: Unit = draft ? { ...base, ...draft } : base;
      const occupants: BedOccupant[] = activeStaysForUnit(base, bedPositions, stays).map((stay) => ({
        stay,
        patient: patients.find((p) => p.id === stay.patientId),
        carer: stay.carerId ? carers.find((c) => c.id === stay.carerId) : undefined,
        position: positionsForUnit(base.id, bedPositions).find((p) => p.id === stay.bedPositionId),
      }));
      return {
        ...unit,
        bedStatus: deriveBedStatus(unit, bedPositions, stays, holds),
        occupants,
        room: roomForUnit(unit, rooms),
        dirty: Boolean(draft),
        holds: holds.filter((h) => h.unitId === base.id),
      };
    });
}
