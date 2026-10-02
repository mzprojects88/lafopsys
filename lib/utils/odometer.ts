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
