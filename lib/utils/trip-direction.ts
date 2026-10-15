// How a trip's direction reads everywhere: cards, the printed manifest and the report (0096).

export type PassengerDirection = "from_hospital" | "to_hospital";

const WORDS: Record<PassengerDirection, { short: string; long: string; arrived: string }> = {
  from_hospital: { short: "Pick-up", long: "Pick-up · to LAF House", arrived: "Arrived at LAF House" },
  to_hospital: { short: "Delivery", long: "Delivery · to the hospital", arrived: "Arrived at the hospital" },
};

/** Pick-up or delivery; anything else (an errand) is not a passenger trip. */
export const tripWords = (direction: string) => WORDS[direction as PassengerDirection] ?? WORDS.from_hospital;

/** The report's label for any trip: a passenger trip by its direction, else the errand's purpose. */
export function directionLabel(direction: string, carriesPassengers: boolean): string {
  if (carriesPassengers && (direction === "from_hospital" || direction === "to_hospital")) return WORDS[direction].long;
  return direction === "to_hospital" ? "Hospital run" : direction === "errand" ? "Errand" : direction === "from_hospital" ? "Pick-up · to LAF House" : "Other";
}

/** Where a delivery goes when nobody says otherwise. */
export const DEFAULT_HOSPITAL = "National Children's Hospital";

/** Leave an hour before the earliest check-up, not before 5:00 AM. */
export function leaveBefore(times: string[]): string {
  const minutes = Math.min(...times.filter((t) => /^[0-9]{2}:[0-9]{2}/.test(t)).map((t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))));
  if (!Number.isFinite(minutes)) return "07:00";
  const m = Math.max(5 * 60, minutes - 60);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
