"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import { todayIso } from "@/lib/utils/date";
import { patientsStore } from "@/lib/hooks/use-patients-collection";

export type MutationResult = { ok: true } | { ok: false; error: string };

export interface BedNight {
  night: string;
  stayId: string;
  bedPositionId: string;
  confirmedAt: string;
}

/** Last night and tonight from ops.bed_nights (0051): enough for "Same bed as yesterday?". */
export const bedNightsStore = createCollection<BedNight[]>({
  key: "ops.bed_nights",
  empty: [],
  tables: [{ schema: "ops", table: "bed_nights" }],
  fetch: async () => {
    const yesterday = new Date(`${todayIso()}T00:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const { data, error } = await createClient()
      .schema("ops")
      .from("bed_nights")
      .select("night, stay_id, bed_position_id, confirmed_at")
      .gte("night", yesterday.toISOString().slice(0, 10));
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({ night: r.night, stayId: r.stay_id, bedPositionId: r.bed_position_id, confirmedAt: r.confirmed_at }));
  },
});

export function useBedNights() {
  const { data: nights, loading } = useCollection(bedNightsStore);

  /** Tonight's bed: the one the stay is in (unitId null) or a move to another bed. */
  async function confirmNight(stayId: string, unitId: string | null = null): Promise<MutationResult> {
    const { error } = await createClient().schema("ops").rpc("confirm_night", { p_stay_id: stayId, p_unit_id: unitId });
    if (error) return { ok: false, error: error.message };
    // A move changes the stay's bed too.
    await Promise.all([bedNightsStore.refetch(), unitId ? patientsStore.refetch() : null]);
    return { ok: true };
  }

  return { nights, loading, confirmNight };
}
