"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import { patientsStore } from "@/lib/hooks/use-patients-collection";
import { pickupsStore } from "@/lib/hooks/use-pickups-collection";
import type { ArrivalApp, ArrivalMode, ArrivalRide } from "@/lib/types/patient";

export type MutationResult = { ok: true } | { ok: false; error: string };

interface RideRow {
  id: string;
  ride_date: string;
  app: ArrivalApp;
  fare: number | string | null;
  notes: string | null;
  reimbursed_at: string | null;
  reimbursed_amount: number | string | null;
  reimbursed_to: string | null;
  reimbursed_by: string | null;
  riders: number;
  reimbursable: boolean;
}

const num = (v: number | string | null) => (v === null ? null : Number(v));

/** ops.v_arrival_rides (0052): each ride with its rider count and whether it can be paid back. */
export const arrivalRidesStore = createCollection<ArrivalRide[]>({
  key: "ops.arrival_rides",
  empty: [],
  // The rider count comes from stays, so a stay's change refreshes this too.
  tables: [{ schema: "ops", table: "arrival_rides" }, { schema: "ops", table: "stays" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("ops").from("v_arrival_rides").select("*").order("ride_date", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as RideRow[]).map((r) => ({
      id: r.id,
      rideDate: r.ride_date,
      app: r.app,
      fare: num(r.fare),
      notes: r.notes ?? undefined,
      reimbursedAt: r.reimbursed_at ?? undefined,
      reimbursedAmount: num(r.reimbursed_amount) ?? undefined,
      reimbursedTo: r.reimbursed_to ?? undefined,
      reimbursedBy: r.reimbursed_by ?? undefined,
      riders: r.riders,
      reimbursable: r.reimbursable,
    }));
  },
});

export interface ArrivalInput {
  mode: ArrivalMode;
  /** ride_app: the app of a new ride. */
  app?: ArrivalApp;
  /** ride_app: join this ride instead of starting one. */
  rideId?: string;
  /** ride_app, new ride: the fare, if known yet. */
  fare?: number | null;
  /** laf_hope: the pick-up that brought them (0053). */
  tripId?: string;
}

/** How a stay's family reached the house (ops.record_arrival). */
/** Returns the ride the stay is on (a new one, or the one joined) and the pick-up, for the group's house-rules talk (0065). */
export async function recordArrival(stayId: string, input: ArrivalInput): Promise<{ ok: true; rideId: string | null; tripId: string | null } | { ok: false; error: string }> {
  const { data, error } = await createClient()
    .schema("ops")
    .rpc("record_arrival", {
      p_stay_id: stayId,
      p_mode: input.mode,
      p_app: input.mode === "ride_app" && !input.rideId ? (input.app ?? null) : null,
      p_ride_id: input.mode === "ride_app" ? (input.rideId ?? null) : null,
      p_fare: input.mode === "ride_app" && !input.rideId ? (input.fare ?? null) : null,
      p_trip_id: input.mode === "laf_hope" ? (input.tripId ?? null) : null,
    });
  if (error) return { ok: false, error: error.message };
  await Promise.all([arrivalRidesStore.refetch(), patientsStore.refetch(), input.tripId ? pickupsStore.refetch() : null]);
  const result = (data ?? {}) as { ride_id?: string | null; trip_id?: string | null };
  return { ok: true, rideId: result.ride_id ?? null, tripId: result.trip_id ?? null };
}

export function useArrivalRides() {
  const { data: rides, loading } = useCollection(arrivalRidesStore);

  async function update(id: string, patch: Record<string, unknown>): Promise<MutationResult> {
    const { error } = await createClient().schema("ops").from("arrival_rides").update(patch).eq("id", id);
    if (error) return { ok: false, error: error.message };
    await arrivalRidesStore.refetch();
    return { ok: true };
  }

  return {
    rides,
    loading,
    setFare: (id: string, fare: number | null) => update(id, { fare }),
    /** The database refuses a ride that does not qualify and signs the pay-out itself. */
    markReimbursed: (id: string, p: { on: string; amount: number; to: string }) =>
      update(id, { reimbursed_at: p.on, reimbursed_amount: p.amount, reimbursed_to: p.to }),
    undoReimbursed: (id: string) => update(id, { reimbursed_at: null, reimbursed_amount: null, reimbursed_to: null }),
  };
}
