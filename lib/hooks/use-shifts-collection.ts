"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import type { Shift } from "@/lib/types/staff";

interface ShiftRow {
  id: string;
  staff_id: string;
  date: string;
  start_time: string;
  end_time: string;
  label: Shift["label"];
}

function toShift(row: ShiftRow): Shift {
  return { id: row.id, staffId: row.staff_id, date: row.date, startTime: row.start_time, endTime: row.end_time, label: row.label };
}

/** Real ops.shifts -- starts empty, no real historical schedule data exists
 * (lib/mock-data/staff.ts generates shifts entirely with `rng`). Staff build
 * the real schedule going forward once accounts exist. */
export const shiftsStore = createCollection<Shift[]>({
  key: "ops.shifts",
  empty: [],
  tables: [{ schema: "ops", table: "shifts" }],
  fetch: async () => {
    const supabase = createClient();
    const { data, error } = await supabase.schema("ops").from("shifts").select("*").order("date", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(toShift);
  },
});

export function useShiftsData() {
  const { data: shifts, loading } = useCollection(shiftsStore);

  return { shifts, loading, refetch: shiftsStore.refetch };
}
