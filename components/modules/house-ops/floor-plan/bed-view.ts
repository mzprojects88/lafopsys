import type { BedPosition, BedStatus, Room, Unit } from "@/lib/types/house-ops";
import type { Carer, Patient, Stay } from "@/lib/types/patient";
import { activeStaysForUnit, deriveBedStatus, positionsForUnit, roomForUnit } from "@/lib/utils/beds";

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
}

export const STATUS_FILL: Record<BedStatus, string> = {
  available: "#d1fae5",
  occupied: "#dbeafe",
  maintenance: "#fef3c7",
  blocked: "#fee2e2",
};

export const STATUS_STROKE: Record<BedStatus, string> = {
  available: "#10b981",
  occupied: "#3b82f6",
  maintenance: "#f59e0b",
  blocked: "#ef4444",
};

export const STATUS_LABEL: Record<BedStatus, string> = {
  available: "Available",
  occupied: "Occupied",
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
}): BedView[] {
  const { units, rooms, bedPositions, stays, patients, carers, draftFor } = input;
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
        bedStatus: deriveBedStatus(unit, bedPositions, stays),
        occupants,
        room: roomForUnit(unit, rooms),
        dirty: Boolean(draft),
      };
    });
}
