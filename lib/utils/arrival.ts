import type { ArrivalApp, ArrivalMode } from "../types/patient";

/** The choices a check-in offers, in the order staff meet them (0052). */
export const ARRIVAL_MODE_LABELS: Record<ArrivalMode, string> = {
  laf_hope: "LAF HOPE",
  ride_app: "Ride app",
  own_transport: "Own / public transport",
  hospital_vehicle: "Hospital ambulance / NCH vehicle",
};

export const ARRIVAL_APP_LABELS: Record<ArrivalApp, string> = {
  grab: "Grab",
  joyride: "JoyRide",
  indrive: "inDrive",
  moveit: "MoveIt",
  angkas: "Angkas",
};

/** "Grab" / "LAF HOPE" -- one line for a stay's arrival. */
export function arrivalLabel(mode: ArrivalMode | undefined, app?: ArrivalApp): string {
  if (!mode) return "Not recorded";
  return mode === "ride_app" && app ? ARRIVAL_APP_LABELS[app] : ARRIVAL_MODE_LABELS[mode];
}
