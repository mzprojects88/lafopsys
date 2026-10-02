// The odometer drums (Fuel Monitoring, 0076): what they show and what a driver typed.

/** The drums' digits, zero-padded to `width`; more drums if the reading outgrows them. */
export function odometerDigits(km: number | null, width = 6): string[] {
  const whole = km == null || !Number.isFinite(km) || km < 0 ? 0 : Math.floor(km);
  return String(whole).padStart(width, "0").split("");
}

/** A typed reading: digits only (spaces, commas and "km" ignored), at most 7 of them. */
export function parseOdometer(text: string): number | null {
  const digits = text.replace(/\D/g, "").slice(0, 7);
  return digits ? Number(digits) : null;
}

/** "160,648 km" */
export function formatKm(km: number): string {
  return `${km.toLocaleString("en-PH")} km`;
}

/** Why a reading can't be saved, or null. Mirrors ops.guard_trip_odometer so the driver hears it first. */
export function readingProblem(km: number | null, lowest: number | null): string | null {
  if (km == null) return "Enter the odometer reading.";
  if (lowest != null && km < lowest) return `The odometer can't go back: it last read ${formatKm(lowest)}.`;
  return null;
}

/** A route's name for "the usual km" -- mirrors ops.route_key (0078): an NCH pick-up, or purpose plus destination. */
export function routeKey(direction: string, destination: string | null): string {
  const place = (destination ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  if (direction === "from_hospital" && !place) return "pickup";
  return `${direction}:${place}`;
}

/** How many past trips before the usual km is trusted. */
export const ROUTE_MIN_TRIPS = 3;

// ponytail: a fixed tolerance (half the usual, at least 10 km); a per-route spread can replace it if drivers get asked too often.
/** Is this trip's km far from the route's usual? Only once the route has enough trips. */
export function isUnusualTrip(km: number, usual: { medianKm: number; trips: number } | null): boolean {
  if (!usual || usual.trips < ROUTE_MIN_TRIPS) return false;
  return Math.abs(km - usual.medianKm) > Math.max(10, usual.medianKm * 0.5);
}
