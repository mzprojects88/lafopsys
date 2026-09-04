"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import type { TimeEntry, TimeEntryFlag } from "@/lib/types/staff";

export type MutationResult = { ok: true; id: string } | { ok: false; error: string };

interface TimeEntryRow {
  id: string;
  staff_id: string;
  date: string;
  clock_in: string | null;
  clock_out: string | null;
  break_minutes: number;
  flag: TimeEntryFlag;
  overtime_minutes: number;
  gps_stamped: boolean;
}

function toTimeEntry(row: TimeEntryRow): TimeEntry {
  return {
    id: row.id,
    staffId: row.staff_id,
    date: row.date,
    clockIn: row.clock_in ?? undefined,
    clockOut: row.clock_out ?? undefined,
    breakMinutes: row.break_minutes,
    flag: row.flag,
    overtimeMinutes: row.overtime_minutes,
    gpsStamped: row.gps_stamped,
  };
}

export const timeEntriesStore = createCollection<TimeEntry[]>({
  key: "ops.time_entries",
  empty: [],
  tables: [{ schema: "ops", table: "time_entries" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("ops").from("time_entries").select("*").order("date", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as TimeEntryRow[]).map(toTimeEntry);
  },
});

/** Real ops.time_entries -- backs the clock-in gate, roster "clocked in"
 * status, and the timesheets flag table. Writes go through
 * app/api/dtr/punch/route.ts (see use-clock-status.ts) so every punch also
 * lands in the DTR with its location and device; nothing writes this table
 * from the browser. */
export function useTimeEntriesData() {
  const { data: entries, loading } = useCollection(timeEntriesStore);
  return { entries, loading, refetch: timeEntriesStore.refetch };
}
