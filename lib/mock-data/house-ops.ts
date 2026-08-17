import type {
  ActivitySession,
  BedPosition,
  CareCartLog,
  CensusSnapshot,
  MealService,
  Room,
  Trip,
  Unit,
} from "@/lib/types/house-ops";
import { makeRng, TODAY_ISO } from "@/lib/utils/seeded-random";
import realPatients from "@/lib/mock-data/real/patients.json";
import realMealServices from "@/lib/mock-data/real/meal-services.json";
import realCareCartLogs from "@/lib/mock-data/real/care-cart-logs.json";
import realCensusHistory from "@/lib/mock-data/real/census-history.json";

const rng = makeRng(303);

// Placeholder floor-plan structure — see LAF House Beds Layout.jfif for the
// real physical arrangement; this distribution (5/4/4 across 3 rooms) is an
// inference from the spec text and should be confirmed before this screen
// is treated as pixel-faithful.
export const rooms: Room[] = [
  { id: "room-1", name: "Room 1" },
  { id: "room-2", name: "Room 2" },
  { id: "room-3", name: "Room 3" },
];

const roomAssignment: Record<string, number> = {
  B1: 1, B2: 1, B3: 1, B4: 1, B5: 1,
  B6: 2, B7: 2, B8: 2, B9: 2,
  B10: 3, B11: 3, B12: 3, B13: 3,
};

export const units: Unit[] = Object.entries(roomAssignment).map(([code, roomN]) => ({
  id: `unit-${code}`,
  code,
  roomId: `room-${roomN}`,
  status: rng.pick(["occupied", "occupied", "occupied", "available", "maintenance"] as const),
  sharedUnit: rng.bool(0.35),
}));

export const bedPositions: BedPosition[] = units.flatMap((u) =>
  (["A", "B", "C", "D"] as const).map((label) => ({
    id: `${u.id}-${label}`,
    unitId: u.id,
    label,
  }))
);

// Sourced directly from the real patients JSON (not from ./patients.ts) to avoid
// a circular import -- patients.ts already imports `bedPositions` from this file.
const patientIdPool = (realPatients as { id: string }[]).map((p) => p.id);

export const trips: Trip[] = Array.from({ length: 18 }).map((_, i) => {
  const dep = rng.pick(["06:30", "07:00", "08:00", "13:00"]);
  const status = rng.pick(["completed", "completed", "completed", "scheduled", "in_progress"] as const);
  return {
    id: `trip-${i + 1}`,
    date: rng.daysFromNow(-rng.int(0, 13)),
    direction: rng.pick(["to_hospital", "from_hospital", "errand", "other"] as const),
    driverId: "stf-7",
    vehicle: rng.pick(["LAF Van 1", "LAF Van 2"]),
    departureTime: dep,
    returnTime: status === "completed" ? rng.pick(["11:30", "12:00", "16:00", "17:30"]) : undefined,
    passengerPatientIds: rng.pickN(patientIdPool, rng.int(1, 4)),
    odometerStart: 40200 + i * 38,
    odometerEnd: status === "completed" ? 40200 + i * 38 + rng.int(12, 60) : undefined,
    fuelCost: status === "completed" ? rng.int(300, 1200) : undefined,
    status,
  };
});

const mockMealServices: MealService[] = Array.from({ length: 14 }).flatMap((_, day) =>
  (["breakfast", "lunch", "dinner"] as const).map((mealType) => ({
    id: `meal-${day}-${mealType}`,
    date: rng.daysFromNow(-day),
    mealType,
    headcount: rng.int(14, 22),
    exceptions: rng.bool(0.3)
      ? [{ patientId: rng.pick(patientIdPool), reason: rng.pick(["Hospital confinement", "Dietary restriction", "Out on trip"]) }]
      : [],
    costPerHead: rng.int(45, 90),
  }))
);

// Real day-log meal headcounts, synced from DATA/clean/meal-services.json (see
// scripts/sync-real-data.mjs and scripts/clean-care-cart-data.py). Real records
// have no costPerHead (not in the source sheet). Falls back to seeded mock data.
export const mealServices: MealService[] =
  realMealServices.length > 0 ? (realMealServices as MealService[]) : mockMealServices;

const mockCareCartLogs: CareCartLog[] = Array.from({ length: 20 }).map((_, i) => ({
  id: `cc-${i + 1}`,
  date: rng.daysFromNow(-rng.int(0, 10)),
  timeSlot: rng.pick(["10:00", "12:00", "14:00", "17:00 ER Round"] as const),
  itemsServed: rng.pick(["Biscuits + juice", "Sandwiches", "Rice meal", "Fruit cups", "Milk + crackers"]),
  headcount: rng.int(8, 30),
  volunteerId: rng.bool(0.6) ? rng.pick(["vol-1", "vol-5"]) : undefined,
  source: rng.pick(["LAF Pantry", "Donation"] as const),
}));

// Real Care Cart food-distribution ledger, synced from DATA/clean/care-cart-logs.json.
// Real records have no volunteerId/source (not in the source ledgers) and use the
// combined "10:00 & 14:00" slot the source itself doesn't split per row.
export const careCartLogs: CareCartLog[] =
  realCareCartLogs.length > 0 ? (realCareCartLogs as CareCartLog[]) : mockCareCartLogs;

export const activitySessions: ActivitySession[] = Array.from({ length: 10 }).map((_, i) => ({
  id: `act-${i + 1}`,
  date: rng.daysFromNow(-rng.int(0, 20)),
  title: rng.pick(["Art & Craft", "Music Therapy", "Story Time", "Board Games", "Movie Afternoon"]),
  participants: rng.int(5, 18),
  volunteerCount: rng.int(2, 6),
  facilitator: rng.pick(["Miguel Santos", "Ella Ramos", "NCH Child Life Team"]),
  hours: rng.pick([1, 1.5, 2]),
}));

const mockCensusHistory: CensusSnapshot[] = Array.from({ length: 30 }).map((_, day) => {
  const inHouse = rng.int(10, 19);
  return {
    date: rng.daysFromNow(-29 + day),
    inHouse,
    unitsOccupied: Math.min(13, Math.ceil(inHouse / 2)),
    unitsShared: rng.int(1, 5),
    totalUnits: 13,
  };
});

// Real daily headcounts, synced from DATA/clean/census-history.json (see
// scripts/sync-real-data.mjs and scripts/clean-occupancy-data.py). No
// unitsOccupied/unitsShared for real days -- the source roster has no bed-
// level detail, only names (see the script's docstring for why `stays`
// itself, used for bed-level views, is untouched by this data).
//
// Truncated to <= TODAY_ISO so `censusHistory[censusHistory.length - 1]`
// keeps meaning "today" for the dashboard/analytics pages that assume that,
// even though the source sheet range extends a few days past TODAY_ISO.
const realCensusHistoryFiltered = (realCensusHistory as CensusSnapshot[]).filter((c) => c.date <= TODAY_ISO);
export const censusHistory: CensusSnapshot[] =
  realCensusHistoryFiltered.length > 0 ? realCensusHistoryFiltered : mockCensusHistory;
