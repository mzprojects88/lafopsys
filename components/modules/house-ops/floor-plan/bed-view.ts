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

/**
 * Bed states are data colours (DESIGN.md): one token per state, so they
 * follow the theme. Reserved has no status tone of its own (warning is
 * maintenance), so it takes the violet chart series it always had.
 */
export const STATUS_STROKE: Record<BedStatus, string> = {
  available: "var(--success)",
  occupied: "var(--primary)",
  reserved: "var(--chart-4)",
  maintenance: "var(--warning)",
  blocked: "var(--destructive)",
};

/** The plan image is opaque white paper in both themes, so the ink drawn on it
 * is fixed like the print pages' (DESIGN.md) -- theme tokens would go white-on-white in dark mode. */
export const PLAN_INK = "#1d2939"; // design text colour, fixed: drawn on the plan's paper
export const PLAN_PAPER = "#ffffff"; // the plan image's own paper, fixed

/** The same colours as an opaque wash on the plan's paper: glyphs, legend
 * swatches and unplaced chips all use it, so they match exactly. */
export const STATUS_FILL = Object.fromEntries(
  Object.entries(STATUS_STROKE).map(([k, c]) => [k, `color-mix(in oklab, ${c} 18%, ${PLAN_PAPER})`])
) as Record<BedStatus, string>;

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
