import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, entryTotals, pairSessions, zonedDayStart } from "@/lib/utils/dtr";

export type DayPunch = { id: string; staff_id: string; punch_type: "clock_in" | "clock_out"; punched_at: string; time_entry_id: string | null };

/**
 * A person's punches around a day and the day's totals, by the DTR's pairing rules: the window is the day and the
 * next, so an overnight session's clock-out counts, and sessions belong to the day they were clocked in. Used by
 * the punch route and the delete route (0141), so the two always write the same summary. Throws when the punches
 * can't be read, so nobody writes a summary from nothing.
 */
export async function dayTotals(db: SupabaseClient, staffId: string, day: string): Promise<{ punches: DayPunch[]; totalMinutes: number; sessionCount: number }> {
  const { data, error } = await db
    .schema("ops")
    .from("time_punches")
    .select("id, staff_id, punch_type, punched_at, time_entry_id")
    .eq("staff_id", staffId)
    .gte("punched_at", zonedDayStart(day).toISOString())
    .lt("punched_at", zonedDayStart(addDays(day, 2)).toISOString());
  if (error) throw new Error(error.message);
  const punches = (data ?? []) as DayPunch[];
  const totals = entryTotals(
    pairSessions(punches.map((r) => ({ id: r.id, staffId: r.staff_id, punchType: r.punch_type, punchedAt: r.punched_at, timeEntryId: r.time_entry_id ?? undefined }))),
    day,
    staffId
  );
  return { punches, ...totals };
}
