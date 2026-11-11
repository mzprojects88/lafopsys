import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteObject } from "@/lib/files/b2";
import { timeLabel } from "@/lib/utils/dtr";
import { dayTotals } from "@/lib/server/dtr-day";

type Deleted = { staff_id: string; time_entry_id: string | null; entry_deleted: boolean; photo_key: string | null };

/**
 * POST /api/dtr/punch/delete: the Super Admin deletes a punch made by mistake (0141). The one door: it verifies who
 * is signed in and runs ops.time_punch_delete (the server's only) as them; the function decides (the Super Admin,
 * with a reason), logs a full copy and removes the punch, its photo record and an emptied day. Then the photo file
 * leaves storage, and a day that keeps other punches gets its summary recomputed by the punch route's rules.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { punchId?: unknown; reason?: unknown } | null;
  const punchId = typeof body?.punchId === "string" && /^[0-9a-f-]{36}$/i.test(body.punchId) ? body.punchId : null;
  const reason = typeof body?.reason === "string" ? body.reason : "";
  if (!punchId) return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });

  const db = createAdminClient();
  const { data, error } = await db.schema("ops").rpc("time_punch_delete", { p_punch: punchId, p_reason: reason, p_actor: user.id });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: error.code === "42501" ? 403 : 400 });
  const d = data as Deleted;

  const warnings: string[] = [];
  if (d.photo_key) {
    try {
      await deleteObject(d.photo_key);
    } catch {
      warnings.push("its photo file could not be removed from storage");
    }
  }
  if (d.time_entry_id && !d.entry_deleted) {
    try {
      const { data: entry, error: entryError } = await db.schema("ops").from("time_entries").select("id, date").eq("id", d.time_entry_id).single();
      if (entryError) throw new Error(entryError.message);
      const day = String(entry.date);
      const { punches, totalMinutes, sessionCount } = await dayTotals(db, d.staff_id, day);
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
          total_minutes: totalMinutes,
          session_count: sessionCount,
        })
        .eq("id", entry.id);
      if (summaryError) throw new Error(summaryError.message);
    } catch (e) {
      warnings.push(`the day's summary did not update (${(e as Error).message}); open the day and check its hours`);
    }
  }
  return NextResponse.json({ ok: true, warning: warnings.length ? `The punch is deleted, but ${warnings.join(", and ")}.` : null });
}
