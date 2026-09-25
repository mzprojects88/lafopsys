export interface Room {
  id: string;
  name: string;
  /** Normalised polygon over the plan image, [[x, y], ...]; null = not drawn yet (0047). */
  bounds: [number, number][] | null;
  sortOrder: number;
}

/** The stored lock state. 'occupied' is never stored -- see BedStatus. */
export type UnitStatus = "available" | "maintenance" | "blocked";

/** What the floor plan and the dialogs show: the stored lock, or occupancy
 * derived from active stays (lib/utils/beds.ts). */
/** "reserved": free, but held for a child who has not arrived yet (0065). */
export type BedStatus = UnitStatus | "occupied" | "reserved";

/** A physical bed (0047). One admission slot by default (capacity 1); the
 * A-D positions underneath are where ops.stays point. */
export interface Unit {
  id: string;
  code: string; // B1..B13, B14+ once added
  roomId: string | null;
  status: UnitStatus;
  sharedUnit: boolean;
  /** Bed centre, normalised 0..1 against the plan image; null = not placed yet (in the tray). */
  x: number | null;
  y: number | null;
  /** Size, normalised against the plan image. */
  w: number;
  h: number;
  /** Rotation about the centre, 0..359. */
  rotationDeg: number;
  capacity: number;
  active: boolean;
  retiredAt?: string;
  lockReason?: string;
  statusChangedAt?: string;
  statusChangedBy?: string;
}

export interface BedPosition {
  id: string;
  unitId: string;
  label: "A" | "B" | "C" | "D";
}

/** Free text an admin writes on the plan (0048). Centre normalised 0..1,
 * like a bed. The id is "tmp-<uuid>" while the label is unsaved in the editor. */
export interface FloorPlanLabel {
  id: string;
  text: string; // 1..60 chars
  x: number;
  y: number;
  rotationDeg: number; // 0..359
  fontSize: number; // 8..48
}

export const LABEL_DEFAULTS = { rotationDeg: 0, fontSize: 16 } as const;

export type TripDirection = "to_hospital" | "from_hospital" | "errand" | "other";
export type TripStatus = "scheduled" | "in_progress" | "completed";

export interface Trip {
  id: string;
  date: string;
  direction: TripDirection;
  driverId: string;
  vehicle: string;
  departureTime: string;
  returnTime?: string;
  passengerPatientIds: string[];
  /** A LAF HOPE pick-up's riders live on its manifest (0053): listed, or boarded once it has left. */
  manifestCount?: number;
  odometerStart: number;
  odometerEnd?: number;
  fuelCost?: number;
  status: TripStatus;
}

export type MealType = "breakfast" | "lunch" | "dinner";

export interface MealService {
  id: string;
  date: string;
  mealType: MealType;
  headcount: number;
  exceptions: { patientId: string; reason: string }[];
  /** No per-meal cost in the real Care Cart sheet -- undefined for real data, not fabricated. */
  costPerHead?: number;
}

export interface CareCartLog {
  id: string;
  date: string;
  /** "10:00 & 14:00" covers the real food-distribution ledger's own combined-window rows, which
   *  don't split per slot -- don't guess a single slot for those rows. */
  timeSlot: "10:00" | "12:00" | "14:00" | "17:00 ER Round" | "10:00 & 14:00";
  itemsServed: string;
  headcount: number;
  volunteerId?: string;
  /** No source column (pantry vs. donation) in the real ledger -- undefined for real data, not fabricated. */
  source?: "LAF Pantry" | "Donation";
}

export interface ActivitySession {
  id: string;
  date: string;
  title: string;
  participants: number;
  volunteerCount: number;
  facilitator: string;
  hours: number;
}

export interface CensusSnapshot {
  date: string;
  inHouse: number;
  /** No per-bed detail in the real Occupancy Tracker (name-only roster) -- undefined for real data, not fabricated. */
  unitsOccupied?: number;
  unitsShared?: number;
  totalUnits: number;
}
