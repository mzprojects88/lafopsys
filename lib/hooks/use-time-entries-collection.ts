"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
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

/** Real ops.time_entries -- backs the clock-in gate, roster "clocked in"
 * status, and the timesheets flag table. Starts empty (no real historical
 * clock data exists); staff create real rows by clocking in going forward. */
export function useTimeEntriesData() {
  const [entries, setEntries] = React.useState<TimeEntry[]>([]);
  const [loading, setLoading] = React.useState(true);

  const refetch = React.useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.schema("ops").from("time_entries").select("*").order("date", { ascending: false });
    setEntries((data ?? []).map(toTimeEntry));
    setLoading(false);
  }, []);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from Supabase, an external system
    refetch();
  }, [refetch]);

  async function clockIn(staffId: string, date: string, time: string): Promise<MutationResult> {
    const supabase = createClient();
    const { data: existing } = await supabase
      .schema("ops")
      .from("time_entries")
      .select("id")
      .eq("staff_id", staffId)
      .eq("date", date)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .schema("ops")
        .from("time_entries")
        .update({ clock_in: time, clock_out: null })
        .eq("id", existing.id);
      if (error) return { ok: false, error: error.message };
      await refetch();
      return { ok: true, id: existing.id };
    }

    const id = crypto.randomUUID();
    const { error } = await supabase
      .schema("ops")
      .from("time_entries")
      .insert({ id, staff_id: staffId, date, clock_in: time });
    if (error) return { ok: false, error: error.message };
    await refetch();
    return { ok: true, id };
  }

  async function clockOut(entryId: string, time: string): Promise<MutationResult> {
    const supabase = createClient();
    const { error } = await supabase.schema("ops").from("time_entries").update({ clock_out: time }).eq("id", entryId);
    if (error) return { ok: false, error: error.message };
    await refetch();
    return { ok: true, id: entryId };
  }

  return { entries, loading, clockIn, clockOut, refetch };
}
