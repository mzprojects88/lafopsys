import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, entryTotals, pairSessions, timeLabel, zonedDayStart, type PunchLike } from "@/lib/utils/dtr";

export type DayPunch = { id: string; staff_id: string; punch_type: "clock_in" | "clock_out"; punched_at: string; time_entry_id: string | null };

/** A person's punches from the start of `from` to the start of `to` (org days). Throws when they can't be read. */
export async function punchesBetween(db: SupabaseClient, staffId: string, from: string, to: string): Promise<DayPunch[]> {
  const { data, error } = await db
    .schema("ops")
    .from("time_punches")
    .select("id, staff_id, punch_type, punched_at, time_entry_id")
    .eq("staff_id", staffId)
    .gte("punched_at", zonedDayStart(from).toISOString())
    .lt("punched_at", zonedDayStart(to).toISOString());
  if (error) throw new Error(error.message);
  return (data ?? []) as DayPunch[];
}

export const asPunchLike = (r: DayPunch): PunchLike => ({ id: r.id, staffId: r.staff_id, punchType: r.punch_type, punchedAt: r.punched_at, timeEntryId: r.time_entry_id ?? undefined });

/**
 * A person's punches around a day and the day's totals, by the DTR's pairing rules: the window is the day and the
 * next, so an overnight session's clock-out counts, and sessions belong to the day they were clocked in. Used by
 * the punch route and refreshDay, so they always write the same summary. Throws when the punches can't be read, so
 * nobody writes a summary from nothing.
 */
export async function dayTotals(db: SupabaseClient, staffId: string, day: string): Promise<{ punches: DayPunch[]; totalMinutes: number; sessionCount: number }> {
  const punches = await punchesBetween(db, staffId, day, addDays(day, 2));
  return { punches, ...entryTotals(pairSessions(punches.map(asPunchLike)), day, staffId) };
}

/**
 * Rewrites a day's summary from its punches after one was added, changed or deleted (0141/0146): first clock-in,
 * the clock-out when the last punch is one, minutes and sessions. Returns a warning instead of throwing, as the
 * punch change itself already stands.
 */
export async function refreshDay(db: SupabaseClient, entryId: string): Promise<string | null> {
  try {
    const { data: entry, error } = await db.schema("ops").from("time_entries").select("id, staff_id, date").eq("id", entryId).single();
    if (error) throw new Error(error.message);
    const day = String(entry.date);
    const { punches, totalMinutes, sessionCount } = await dayTotals(db, String(entry.staff_id), day);
    const own = punches.filter((r) => r.time_entry_id === entry.id).sort((a, b) => a.punched_at.localeCompare(b.punched_at));
    const firstIn = own.find((r) => r.punch_type === "clock_in");
    const last = own.at(-1);
    const { error: summaryError } = await db
      .schema("ops")
      .from("time_entries")
      .update({
        clock_in: firstIn ? timeLabel(firstIn.punched_at) : null,
        clock_out: last?.punch_type === "clock_out" ? timeLabel(last.punched_at) : null,
        total_minutes: totalMinutes,
        session_count: sessionCount,
      })
      .eq("id", entry.id);
    if (summaryError) throw new Error(summaryError.message);
    return null;
  } catch (e) {
    return `the day's summary did not update (${(e as Error).message}); open the day and check its hours`;
  }
}
