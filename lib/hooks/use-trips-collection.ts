"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
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
    odometerStart: row.odometer_start ?? 0,
    odometerEnd: row.odometer_end ?? undefined,
    fuelCost: row.fuel_cost ?? undefined,
    status: row.status,
  };
}

export function useTripsData() {
  const [trips, setTrips] = React.useState<Trip[]>([]);
  const [loading, setLoading] = React.useState(true);

  const refetch = React.useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .schema("ops")
      .from("trips")
      .select("*, trip_passengers(patient_id)")
      .order("date", { ascending: false });
    setTrips((data ?? []).map(toTrip));
    setLoading(false);
  }, []);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from Supabase, an external system
    refetch();
  }, [refetch]);

  async function addTrip(trip: Omit<Trip, "id"> & { id?: string }): Promise<MutationResult> {
    const supabase = createClient();
    const id = trip.id ?? crypto.randomUUID();
    const { error } = await supabase.schema("ops").from("trips").insert({
      id,
      date: trip.date,
      direction: trip.direction,
      driver_staff_id: trip.driverId || null,
      vehicle: trip.vehicle,
      departure_time: trip.departureTime,
      return_time: trip.returnTime ?? null,
      odometer_start: trip.odometerStart,
      odometer_end: trip.odometerEnd ?? null,
      fuel_cost: trip.fuelCost ?? null,
      status: trip.status,
    });
    if (error) return { ok: false, error: error.message };

    if (trip.passengerPatientIds.length > 0) {
      const { error: passengersError } = await supabase
        .schema("ops")
        .from("trip_passengers")
        .insert(trip.passengerPatientIds.map((patientId) => ({ trip_id: id, patient_id: patientId })));
      if (passengersError) return { ok: false, error: passengersError.message };
    }
    await refetch();
    return { ok: true };
  }

  async function updateTrip(id: string, patch: Partial<Trip>): Promise<MutationResult> {
    const supabase = createClient();
    const row: Record<string, unknown> = {};
    if ("status" in patch) row.status = patch.status;
    if ("returnTime" in patch) row.return_time = patch.returnTime ?? null;
    if ("odometerEnd" in patch) row.odometer_end = patch.odometerEnd ?? null;
    if ("fuelCost" in patch) row.fuel_cost = patch.fuelCost ?? null;
    const { error } = await supabase.schema("ops").from("trips").update(row).eq("id", id);
    if (error) return { ok: false, error: error.message };
    await refetch();
    return { ok: true };
  }

  return { trips, loading, addTrip, updateTrip, refetch };
}
