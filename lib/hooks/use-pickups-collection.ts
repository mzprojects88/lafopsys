"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import { todayIso } from "@/lib/utils/date";
import type { TripStatus } from "@/lib/types/house-ops";

export type MutationResult = { ok: true } | { ok: false; error: string };

export const LAF_HOPE_VEHICLE = "LAF HOPE Transport";

export interface ManifestEntry {
  id: string;
  sheetRowId: string | null;
  patientId: string | null;
  name: string;
  carerName: string | null;
  boardedAt: string | null;
  boardedBy: string | null;
}

export interface Pickup {
  id: string;
  date: string;
  departureTime: string;
  driverId: string | null;
  status: TripStatus;
  departedAt: string | null;
  arrivedAt: string | null;
  manifest: ManifestEntry[];
}

interface Row {
  id: string;
  date: string;
  departure_time: string;
  driver_staff_id: string | null;
  status: TripStatus;
  departed_at: string | null;
  arrived_at: string | null;
  trip_manifest: {
    id: string;
    house_sheet_person_id: string | null;
    patient_id: string | null;
    name: string;
    carer_name: string | null;
    boarded_at: string | null;
    boarded_by: string | null;
  }[] | null;
}

/** LAF HOPE pick-ups from a week back onwards, each with its manifest (0053). */
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
      .select("id, date, departure_time, driver_staff_id, status, departed_at, arrived_at, trip_manifest(*)")
      .eq("vehicle", LAF_HOPE_VEHICLE)
      .gte("date", since.toISOString().slice(0, 10))
      .order("date", { ascending: false })
      .order("departure_time");
    if (error) throw new Error(error.message);
    return ((data ?? []) as Row[]).map((r) => ({
      id: r.id,
      date: r.date,
      departureTime: r.departure_time,
      driverId: r.driver_staff_id,
      status: r.status,
      departedAt: r.departed_at,
      arrivedAt: r.arrived_at,
      manifest: (r.trip_manifest ?? [])
        .map((m) => ({
          id: m.id,
          sheetRowId: m.house_sheet_person_id,
          patientId: m.patient_id,
          name: m.name,
          carerName: m.carer_name,
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
    addToManifest: async (tripId: string, row: { id: string; patientName: string; carerName: string | null }) =>
      done((await ops().from("trip_manifest").insert({ trip_id: tripId, house_sheet_person_id: row.id, name: row.patientName, carer_name: row.carerName })).error),
    removeFromManifest: async (entryId: string) => done((await ops().from("trip_manifest").delete().eq("id", entryId)).error),
    /** scheduled -> in_progress (departed) -> completed (arrived); the database stamps the times. */
    setStatus: async (tripId: string, status: TripStatus) => done((await ops().from("trips").update({ status }).eq("id", tripId)).error),
  };
}
