"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import type { MetricSnapshot } from "@/lib/types/reports";

interface MetricSnapshotRow {
  date: string;
  bed_nights: number;
  meals: number;
  trips: number;
  care_cart_meals: number;
  activity_participants: number;
  donations_ytd: number;
}

function toMetricSnapshot(row: MetricSnapshotRow): MetricSnapshot {
  return {
    date: row.date,
    bedNights: row.bed_nights,
    meals: row.meals,
    trips: row.trips,
    careCartMeals: row.care_cart_meals,
    activityParticipants: row.activity_participants,
    donationsYtd: row.donations_ytd,
  };
}

/** Real ops.metric_snapshots -- 6 real monthly rows (integrate.md Step 3). */
export function useMetricSnapshotsData() {
  const [snapshots, setSnapshots] = React.useState<MetricSnapshot[]>([]);
  const [loading, setLoading] = React.useState(true);

  const refetch = React.useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.schema("ops").from("metric_snapshots").select("*").order("date");
    setSnapshots((data ?? []).map(toMetricSnapshot));
    setLoading(false);
  }, []);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from Supabase, an external system
    refetch();
  }, [refetch]);

  return { snapshots, loading, refetch };
}
