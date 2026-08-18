"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
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
export function useShiftsData() {
  const [shifts, setShifts] = React.useState<Shift[]>([]);
  const [loading, setLoading] = React.useState(true);

  const refetch = React.useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.schema("ops").from("shifts").select("*").order("date", { ascending: false });
    setShifts((data ?? []).map(toShift));
    setLoading(false);
  }, []);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from Supabase, an external system
    refetch();
  }, [refetch]);

  return { shifts, loading, refetch };
}
