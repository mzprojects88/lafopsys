"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
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
export const metricSnapshotsStore = createCollection<MetricSnapshot[]>({
  key: "ops.metric_snapshots",
  empty: [],
  tables: [{ schema: "ops", table: "metric_snapshots" }],
  fetch: async () => {
    const supabase = createClient();
    const { data, error } = await supabase.schema("ops").from("metric_snapshots").select("*").order("date");
    if (error) throw new Error(error.message);
    return (data ?? []).map(toMetricSnapshot);
  },
});

export function useMetricSnapshotsData() {
  const { data: snapshots, loading } = useCollection(metricSnapshotsStore);

  return { snapshots, loading, refetch: metricSnapshotsStore.refetch };
}
