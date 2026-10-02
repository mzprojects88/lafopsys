"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import { todayIso } from "@/lib/utils/date";
import { pickupsStore } from "@/lib/hooks/use-pickups-collection";
import type { TripDirection, TripStatus } from "@/lib/types/house-ops";

export type MutationResult = { ok: true } | { ok: false; error: string };

export interface Vehicle {
  id: string;
  name: string;
  plateNo: string | null;
  fuelType: "diesel" | "gasoline";
  tankLitres: number | null;
  fuelDoorSide: "left" | "right" | null;
  defaultKmPerLitre: number | null;
  /** null = not tracked yet: trips run without readings (0076). */
  startOdometer: number | null;
  active: boolean;
  /** How far km per litre may fall below the recent average before Fuel Monitoring flags it (0079). */
  efficiencyAlertPct: number;
  /** The highest reading on record -- where the drums start. */
  lastReading: number | null;
  /** Today's odometer photo is in: later departures today don't need one (0078). */
  photoToday: boolean;
}

/** What the AI read from an odometer photo the server filed (0078). */
export interface OdometerPhotoRead {
  photoId: string;
  reading: number | null;
  confidence: number;
  note: string;
}

/** Trips that aren't NCH pick-ups: errands, hospital runs (0076). */
export interface Errand {
  id: string;
  date: string;
  direction: TripDirection;
  destination: string | null;
  vehicleId: string;
  driverId: string | null;
  departureTime: string;
  status: TripStatus;
  departedAt: string | null;
  arrivedAt: string | null;
  odometerStart: number | null;
  odometerEnd: number | null;
}

interface VehicleRow {
  id: string;
  name: string;
  plate_no: string | null;
  fuel_type: "diesel" | "gasoline";
  tank_litres: number | null;
  fuel_door_side: "left" | "right" | null;
  default_km_per_litre: number | null;
  start_odometer: number | null;
  active: boolean;
  efficiency_alert_pct: number | null;
}

export const vehiclesStore = createCollection<Vehicle[]>({
  key: "ops.vehicles",
  empty: [],
  // Every arrival moves a vehicle's last reading; a photo opens the day's departures.
  tables: [{ schema: "ops", table: "vehicles" }, { schema: "ops", table: "trips" }, { schema: "ops", table: "odometer_photos" }],
  fetch: async () => {
    const ops = createClient().schema("ops");
    const [vehicles, readings, photos] = await Promise.all([
      ops.from("vehicles").select("*").order("name"),
      ops.from("v_vehicle_odometer").select("vehicle_id, last_reading"),
      ops.from("odometer_photos").select("vehicle_id").eq("taken_on", todayIso()),
    ]);
    if (vehicles.error) throw new Error(vehicles.error.message);
    if (readings.error) throw new Error(readings.error.message);
    if (photos.error) throw new Error(photos.error.message);
    const last = new Map((readings.data ?? []).map((r) => [r.vehicle_id as string, r.last_reading as number | null]));
    const photographed = new Set((photos.data ?? []).map((p) => p.vehicle_id as string));
    return ((vehicles.data ?? []) as VehicleRow[]).map((v) => ({
      id: v.id,
      name: v.name,
      plateNo: v.plate_no,
      fuelType: v.fuel_type,
      tankLitres: v.tank_litres == null ? null : Number(v.tank_litres),
      fuelDoorSide: v.fuel_door_side,
      defaultKmPerLitre: v.default_km_per_litre == null ? null : Number(v.default_km_per_litre),
      startOdometer: v.start_odometer,
      active: v.active,
      efficiencyAlertPct: v.efficiency_alert_pct ?? 20,
      lastReading: last.get(v.id) ?? null,
      photoToday: photographed.has(v.id),
    }));
  },
});

export const errandsStore = createCollection<Errand[]>({
  key: "ops.trips.errands",
  empty: [],
  tables: [{ schema: "ops", table: "trips" }],
  fetch: async () => {
    const since = new Date(`${todayIso()}T00:00:00Z`);
    since.setUTCDate(since.getUTCDate() - 7);
    const { data, error } = await createClient()
      .schema("ops")
      .from("trips")
      .select("id, date, direction, destination, vehicle_id, driver_staff_id, departure_time, status, departed_at, arrived_at, odometer_start, odometer_end")
      .not("vehicle_id", "is", null)
      .neq("direction", "from_hospital")
      .gte("date", since.toISOString().slice(0, 10))
      .order("date", { ascending: false })
      .order("departure_time", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      id: r.id,
      date: r.date,
      direction: r.direction,
      destination: r.destination,
      vehicleId: r.vehicle_id,
      driverId: r.driver_staff_id,
      departureTime: r.departure_time,
      status: r.status,
      departedAt: r.departed_at,
      arrivedAt: r.arrived_at,
      odometerStart: r.odometer_start,
      odometerEnd: r.odometer_end,
    }));
  },
});

async function refreshAll(error: { message: string } | null): Promise<MutationResult> {
  if (error) return { ok: false, error: error.message };
  await Promise.all([vehiclesStore.refetch(), errandsStore.refetch(), pickupsStore.refetch(), routeKmStore.refetch()]);
  return { ok: true };
}

/** The usual km per route (ops.v_route_km, 0078), keyed by routeKey(). */
export const routeKmStore = createCollection<Map<string, { medianKm: number; trips: number }>>({
  key: "ops.v_route_km",
  empty: new Map(),
  tables: [{ schema: "ops", table: "trips" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("ops").from("v_route_km").select("route_key, trips, median_km");
    if (error) throw new Error(error.message);
    return new Map((data ?? []).map((r) => [r.route_key as string, { medianKm: Number(r.median_km), trips: r.trips as number }]));
  },
});

export function useRouteKm() {
  return useCollection(routeKmStore).data;
}

/** Sends a phone photo of the odometer (already shrunk) to be filed and read by the AI. */
export async function sendOdometerPhoto(vehicleId: string, stage: "depart" | "arrive" | "pump" | "other", image: string): Promise<{ ok: true; read: OdometerPhotoRead } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/transport/odometer-photo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vehicleId, stage, image }),
    });
    const body = await res.json();
    if (!res.ok || !body.ok) return { ok: false, error: body.error ?? "The photo couldn't be sent." };
    await vehiclesStore.refetch();
    return { ok: true, read: { photoId: body.photoId, reading: body.reading, confidence: body.confidence, note: body.note } };
  } catch {
    return { ok: false, error: "The photo couldn't be sent; check the connection." };
  }
}

/** Depart / arrive / "not left yet", with the reading (and the photo behind it) in the same update so the guard sees both. */
export async function moveTrip(
  tripId: string,
  status: TripStatus,
  reading?: { start?: number; end?: number; startPhotoId?: string | null; endPhotoId?: string | null }
): Promise<MutationResult> {
  const row: Record<string, unknown> = { status };
  if (reading?.start !== undefined) row.odometer_start = reading.start;
  if (reading?.end !== undefined) row.odometer_end = reading.end;
  if (reading?.startPhotoId) row.start_photo_id = reading.startPhotoId;
  if (reading?.endPhotoId) row.end_photo_id = reading.endPhotoId;
  return refreshAll((await createClient().schema("ops").from("trips").update(row).eq("id", tripId)).error);
}

/** The Super Admin's correction of an arrived trip, with a reason (ops.correct_odometer). */
export async function correctOdometer(tripId: string, start: number, end: number | null, reason: string): Promise<MutationResult> {
  return refreshAll(
    (await createClient().schema("ops").rpc("correct_odometer", { p_trip_id: tripId, p_start: start, p_end: end, p_reason: reason })).error
  );
}

/** An errand leaves now: the trip, then its departure with the reading. A refused departure takes the trip back out. */
export async function startErrand(input: {
  vehicleId: string;
  direction: TripDirection;
  destination: string;
  driverId: string | null;
  odometerStart: number | null;
  photoId?: string | null;
}): Promise<MutationResult> {
  const ops = createClient().schema("ops");
  const now = new Date();
  const departure = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Manila" });
  const { data, error } = await ops
    .from("trips")
    .insert({
      date: todayIso(),
      direction: input.direction,
      destination: input.destination.trim(),
      vehicle_id: input.vehicleId,
      vehicle: "", // the database writes the vehicle's name
      driver_staff_id: input.driverId,
      departure_time: departure,
      status: "scheduled",
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  const moved = await moveTrip(data.id, "in_progress", input.odometerStart == null ? undefined : { start: input.odometerStart, startPhotoId: input.photoId });
  if (!moved.ok) await ops.from("trips").delete().eq("id", data.id);
  return moved;
}

export function useVehicles() {
  const { data: vehicles, loading } = useCollection(vehiclesStore);
  return {
    vehicles,
    loading,
    /** Settings, Super Admin only (RLS). Adds when there's no id. */
    saveVehicle: async (v: Omit<Vehicle, "id" | "lastReading" | "photoToday"> & { id?: string }): Promise<MutationResult> => {
      const row = {
        name: v.name.trim(),
        plate_no: v.plateNo?.trim() || null,
        fuel_type: v.fuelType,
        tank_litres: v.tankLitres,
        fuel_door_side: v.fuelDoorSide,
        default_km_per_litre: v.defaultKmPerLitre,
        start_odometer: v.startOdometer,
        active: v.active,
        efficiency_alert_pct: v.efficiencyAlertPct,
      };
      const ops = createClient().schema("ops");
      const { error } = v.id ? await ops.from("vehicles").update(row).eq("id", v.id).select("id").single() : await ops.from("vehicles").insert(row);
      return refreshAll(error);
    },
  };
}

export function useErrands() {
  const { data: errands, loading } = useCollection(errandsStore);
  return { errands, loading };
}
