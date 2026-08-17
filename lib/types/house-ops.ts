export interface Room {
  id: string;
  name: string;
}

export type UnitStatus = "available" | "occupied" | "maintenance" | "blocked";

export interface Unit {
  id: string;
  code: string; // B1..B13
  roomId: string;
  status: UnitStatus;
  sharedUnit: boolean;
}

export interface BedPosition {
  id: string;
  unitId: string;
  label: "A" | "B" | "C" | "D";
}

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
