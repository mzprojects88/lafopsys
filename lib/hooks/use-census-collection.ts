"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import type { CensusSnapshot } from "@/lib/types/house-ops";

interface CensusSnapshotRow {
  date: string;
  in_house: number;
  units_occupied: number | null;
  units_shared: number | null;
  total_units: number;
}

function toCensusSnapshot(row: CensusSnapshotRow): CensusSnapshot {
  return {
    date: row.date,
    inHouse: row.in_house,
    unitsOccupied: row.units_occupied ?? undefined,
    unitsShared: row.units_shared ?? undefined,
    totalUnits: row.total_units,
  };
}

/** Real daily occupancy history from `ops.census_snapshots`, ordered oldest-first
 * (matching the old mock export's convention of `[...][length - 1]` meaning "most recent"). */
export const censusStore = createCollection<CensusSnapshot[]>({
  key: "ops.census_snapshots",
  empty: [],
  tables: [{ schema: "ops", table: "census_snapshots" }],
  fetch: async () => {
    const supabase = createClient();
    const { data, error } = await supabase.schema("ops").from("census_snapshots").select("*").order("date", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map(toCensusSnapshot);
  },
});

export function useCensusData() {
  const { data: history, loading } = useCollection(censusStore);

  return { history, loading, refetch: censusStore.refetch };
}
