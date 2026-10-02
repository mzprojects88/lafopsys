import { redirect } from "next/navigation";

// Trips live in Transport now (0076): one log, with each vehicle and its odometer.
export default function HouseOpsTripsPage() {
  redirect("/transport");
}
