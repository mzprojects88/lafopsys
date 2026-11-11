import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteObject } from "@/lib/files/b2";
import { addDays, entryTotals, pairSessions, timeLabel, zonedDayStart } from "@/lib/utils/dtr";

type Deleted = { staff_id: string; time_entry_id: string | null; entry_deleted: boolean; photo_key: string | null };
type PunchRow = { id: string; staff_id: string; punch_type: "clock_in" | "clock_out"; punched_at: string; time_entry_id: string | null };

/**
 * POST /api/dtr/punch/delete: the Super Admin deletes a punch made by mistake (0141). ops.time_punch_delete runs as
 * the caller and decides who may (the Super Admin, with a reason), logs a full copy and removes the punch, its photo
 * record and an emptied day. Here: the photo file leaves storage, and a day that keeps other punches gets its
 * summary recomputed by the punch route's rules (first in, latest out, totals from paired sessions).
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { punchId?: unknown; reason?: unknown } | null;
  const punchId = typeof body?.punchId === "string" && /^[0-9a-f-]{36}$/i.test(body.punchId) ? body.punchId : null;
  const reason = typeof body?.reason === "string" ? body.reason : "";
  if (!punchId) return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });

  const { data, error } = await supabase.schema("ops").rpc("time_punch_delete", { p_punch: punchId, p_reason: reason });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: error.code === "42501" ? 403 : 400 });
  const d = data as Deleted;

  let warning: string | null = null;
  if (d.photo_key) {
    try {
      await deleteObject(d.photo_key);
    } catch {
      warning = "The punch is deleted; its photo file could not be removed from storage.";
    }
  }

  if (d.time_entry_id && !d.entry_deleted) {
    const db = createAdminClient();
    const { data: entry } = await db.schema("ops").from("time_entries").select("id, date").eq("id", d.time_entry_id).maybeSingle();
    if (entry) {
      const day = String(entry.date);
      // The same window as the punch route: the day and the next, so an overnight session's clock-out counts.
      const { data: rows } = await db
        .schema("ops")
        .from("time_punches")
        .select("id, staff_id, punch_type, punched_at, time_entry_id")
        .eq("staff_id", d.staff_id)
        .gte("punched_at", zonedDayStart(day).toISOString())
        .lt("punched_at", zonedDayStart(addDays(day, 2)).toISOString());
      const punches = (rows ?? []) as PunchRow[];
      const totals = entryTotals(
        pairSessions(punches.map((r) => ({ id: r.id, staffId: r.staff_id, punchType: r.punch_type, punchedAt: r.punched_at, timeEntryId: r.time_entry_id ?? undefined }))),
        day,
        d.staff_id
      );
      const own = punches.filter((r) => r.time_entry_id === entry.id).sort((a, b) => a.punched_at.localeCompare(b.punched_at));
      const firstIn = own.find((r) => r.punch_type === "clock_in");
      const last = own.at(-1);
      const { error: summaryError } = await db
        .schema("ops")
        .from("time_entries")
        .update({
          clock_in: firstIn ? timeLabel(firstIn.punched_at) : null,
          // Still clocked in when the day's last punch is a clock-in.
          clock_out: last?.punch_type === "clock_out" ? timeLabel(last.punched_at) : null,
          total_minutes: totals.totalMinutes,
          session_count: totals.sessionCount,
        })
        .eq("id", entry.id);
      if (summaryError) warning = `The punch is deleted, but the day's summary failed to update: ${summaryError.message}`;
    }
  }
  return NextResponse.json({ ok: true, warning });
}
