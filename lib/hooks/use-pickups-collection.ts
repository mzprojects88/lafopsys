"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import { todayIso } from "@/lib/utils/date";
import type { TripStatus } from "@/lib/types/house-ops";

export type MutationResult = { ok: true } | { ok: false; error: string };

export interface ManifestEntry {
  id: string;
  sheetRowId: string | null;
  patientId: string | null;
  name: string;
  carerName: string | null;
  note: string | null;
  boardedAt: string | null;
  boardedBy: string | null;
}

export interface Pickup {
  id: string;
  date: string;
  /** from_hospital = a pick-up to LAF House, to_hospital = a delivery to the hospital (0096). */
  direction: "from_hospital" | "to_hospital";
  destination: string | null;
  departureTime: string;
  driverId: string | null;
  status: TripStatus;
  departedAt: string | null;
  arrivedAt: string | null;
  vehicleId: string | null;
  odometerStart: number | null;
  odometerEnd: number | null;
  manifest: ManifestEntry[];
}

interface Row {
  id: string;
  date: string;
  direction: "from_hospital" | "to_hospital";
  destination: string | null;
  departure_time: string;
  driver_staff_id: string | null;
  status: TripStatus;
  departed_at: string | null;
  arrived_at: string | null;
  vehicle_id: string | null;
  odometer_start: number | null;
  odometer_end: number | null;
  trip_manifest: {
    id: string;
    house_sheet_person_id: string | null;
    patient_id: string | null;
    name: string;
    carer_name: string | null;
    note: string | null;
    boarded_at: string | null;
    boarded_by: string | null;
  }[] | null;
}

/** Trips with passengers -- pick-ups to LAF House and deliveries to the hospital -- from a week
 * back onwards, each with its manifest (0053, 0096). Found by carries_passengers, never by the
 * vehicle's name: production renamed the van. */
export const pickupsStore = createCollection<Pickup[]>({
  key: "ops.trips.laf_hope",
  empty: [],
  tables: [{ schema: "ops", table: "trips" }, { schema: "ops", table: "trip_manifest" }],
  fetch: async () => {
    const since = new Date(`${todayIso()}T00:00:00Z`);
    since.setUTCDate(since.getUTCDate() - 7);
    const { data, error } = await createClient()
      .schema("ops")
      .from("trips")
      .select("id, date, direction, destination, departure_time, driver_staff_id, status, departed_at, arrived_at, vehicle_id, odometer_start, odometer_end, trip_manifest(*)")
      // Errands (0076) are in errandsStore.
      .eq("carries_passengers", true)
      .gte("date", since.toISOString().slice(0, 10))
      .order("date", { ascending: false })
      .order("departure_time");
    if (error) throw new Error(error.message);
    return ((data ?? []) as Row[]).map((r) => ({
      id: r.id,
      date: r.date,
      direction: r.direction,
      destination: r.destination,
      departureTime: r.departure_time,
      driverId: r.driver_staff_id,
      status: r.status,
      departedAt: r.departed_at,
      arrivedAt: r.arrived_at,
      vehicleId: r.vehicle_id,
      odometerStart: r.odometer_start,
      odometerEnd: r.odometer_end,
      manifest: (r.trip_manifest ?? [])
        .map((m) => ({
          id: m.id,
          sheetRowId: m.house_sheet_person_id,
          patientId: m.patient_id,
          name: m.name,
          carerName: m.carer_name,
          note: m.note,
          boardedAt: m.boarded_at,
          boardedBy: m.boarded_by,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }));
  },
});

async function done(error: { message: string } | null): Promise<MutationResult> {
  if (error) return { ok: false, error: error.message };
  await pickupsStore.refetch();
  return { ok: true };
}

export function usePickups() {
  const { data: pickups, loading } = useCollection(pickupsStore);
  const ops = () => createClient().schema("ops");

  return {
    pickups,
    loading,
    /** The trip and its manifest, from rows on NCH's sheet, in one step. */
    createPickup: async (p: { date: string; departureTime: string; driverId: string | null; sheetRowIds: string[] }) =>
      done((await ops().rpc("create_pickup", { p_date: p.date, p_departure_time: p.departureTime, p_driver_id: p.driverId, p_sheet_row_ids: p.sheetRowIds })).error),
    /** The database stamps the time and who ticked it. */
    setBoarded: async (entryId: string, onBoard: boolean) =>
      done((await ops().from("trip_manifest").update({ boarded_at: onBoard ? new Date().toISOString() : null }).eq("id", entryId)).error),
    /** A pick-up or a delivery with its passengers, in one step (0096). */
    createTrip: async (t: {
      date: string;
      departureTime: string;
      driverId: string | null;
      direction: "from_hospital" | "to_hospital";
      destination: string | null;
      vehicleId: string | null;
      sheetRowIds: string[];
      patientIds: string[];
    }) =>
      done(
        (
          await ops().rpc("create_trip", {
            p_date: t.date,
            p_departure_time: t.departureTime,
            p_driver_id: t.driverId,
            p_direction: t.direction,
            p_destination: t.destination,
            p_vehicle_id: t.vehicleId,
            p_sheet_row_ids: t.sheetRowIds,
            p_patient_ids: t.patientIds,
          })
        ).error
      ),
    /** A passenger the driver or social worker adds: a patient on file or a typed name. Who added is stamped. */
    addPassenger: async (tripId: string, p: { patientId: string | null; name: string; carerName: string | null; note: string | null }) =>
      done((await ops().from("trip_manifest").insert({ trip_id: tripId, patient_id: p.patientId, name: p.name, carer_name: p.carerName, note: p.note })).error),
    /** Corrects a passenger until the trip arrives. */
    updatePassenger: async (entryId: string, p: { name: string; carerName: string | null; note: string | null }) =>
      done((await ops().from("trip_manifest").update({ name: p.name, carer_name: p.carerName, note: p.note }).eq("id", entryId)).error),
    addToManifest: async (tripId: string, row: { id: string; patientName: string; carerName: string | null }) =>
      done((await ops().from("trip_manifest").insert({ trip_id: tripId, house_sheet_person_id: row.id, name: row.patientName, carer_name: row.carerName })).error),
    removeFromManifest: async (entryId: string) => done((await ops().from("trip_manifest").delete().eq("id", entryId)).error),
    // Departing and arriving: moveTrip in use-vehicles-collection (the odometer goes with them, 0076).
  };
}
