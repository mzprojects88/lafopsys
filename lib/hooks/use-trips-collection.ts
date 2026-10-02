"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import type { Trip, TripDirection, TripStatus } from "@/lib/types/house-ops";

export type MutationResult = { ok: true } | { ok: false; error: string };

interface TripRow {
  id: string;
  date: string;
  direction: TripDirection;
  driver_staff_id: string | null;
  vehicle: string;
  departure_time: string;
  return_time: string | null;
  odometer_start: number | null;
  odometer_end: number | null;
  fuel_cost: number | null;
  status: TripStatus;
  trip_passengers: { patient_id: string }[] | null;
  trip_manifest: { boarded_at: string | null }[] | null;
}

function toTrip(row: TripRow): Trip {
  return {
    id: row.id,
    date: row.date,
    direction: row.direction,
    driverId: row.driver_staff_id ?? "",
    vehicle: row.vehicle,
    departureTime: row.departure_time,
    returnTime: row.return_time ?? undefined,
    passengerPatientIds: (row.trip_passengers ?? []).map((p) => p.patient_id),
    // Before it leaves, everyone listed; after, only who actually boarded.
    manifestCount: (row.trip_manifest ?? []).filter((m) => row.status === "scheduled" || m.boarded_at).length,
    odometerStart: row.odometer_start ?? 0,
    odometerEnd: row.odometer_end ?? undefined,
    fuelCost: row.fuel_cost ?? undefined,
    status: row.status,
  };
}

export const tripsStore = createCollection<Trip[]>({
  key: "ops.trips",
  empty: [],
  // The embedded select reads the join table too, so a change there must refresh this.
  tables: [{ schema: "ops", table: "trips" }, { schema: "ops", table: "trip_passengers" }, { schema: "ops", table: "trip_manifest" }],
  fetch: async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .schema("ops")
      .from("trips")
      .select("*, trip_passengers(patient_id), trip_manifest(boarded_at)")
      .order("date", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(toTrip);
  },
});

export function useTripsData() {
  const { data: trips, loading } = useCollection(tripsStore);

  // Trips are started, departed and arrived in Transport (0076: use-vehicles-collection).
  return { trips, loading, refetch: tripsStore.refetch };
}
