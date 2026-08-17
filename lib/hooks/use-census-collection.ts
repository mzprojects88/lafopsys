"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
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
export function useCensusData() {
  const [history, setHistory] = React.useState<CensusSnapshot[]>([]);
  const [loading, setLoading] = React.useState(true);

  const refetch = React.useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.schema("ops").from("census_snapshots").select("*").order("date", { ascending: true });
    setHistory((data ?? []).map(toCensusSnapshot));
    setLoading(false);
  }, []);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from Supabase, an external system
    refetch();
  }, [refetch]);

  return { history, loading, refetch };
}
