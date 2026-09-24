import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { addDays, planClockOut, timeLabel, zonedDayStart } from "@/lib/utils/dtr";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An admin or HR person decides a DTR correction request (0061/0062).
 *
 * Approve: check the requested clock-out closes that day's own session
 * (planClockOut, the same rule as an admin's direct fix), then
 * ops.approve_correction_request adds the signed adjustment punch and marks
 * the request approved in one transaction, then the day's totals are
 * recomputed from the punches. Reject: ops.reject_correction_request with
 * the note the person will see. Who may decide is the database's call.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  let body: { id?: unknown; decision?: unknown; note?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed request body." }, { status: 400 });
  }
  const id = typeof body.id === "string" && UUID_RE.test(body.id) ? body.id : null;
  const decision = body.decision === "approve" || body.decision === "reject" ? body.decision : null;
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!id || !decision) return NextResponse.json({ ok: false, error: "A request and a decision are required." }, { status: 400 });

  if (decision === "reject") {
    const { error } = await supabase.schema("ops").rpc("reject_correction_request", { p_id: id, p_note: note });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: error.code === "42501" ? 403 : 409 });
    return NextResponse.json({ ok: true });
  }

  const { data: req } = await supabase
    .schema("ops")
    .from("dtr_correction_requests")
    .select("id, staff_id, time_entry_id, requested_at, status")
    .eq("id", id)
    .maybeSingle();
  if (!req) return NextResponse.json({ ok: false, error: "No such request." }, { status: 404 });
  const { data: entry } = await supabase.schema("ops").from("time_entries").select("id, date, clock_out").eq("id", req.time_entry_id).maybeSingle();
  if (!entry) return NextResponse.json({ ok: false, error: "That time record no longer exists." }, { status: 404 });

  // The entry's day and the next: an overnight session's clock-out, and the next day's clock-in, are both in range.
  const day = entry.date as string;
  const { data: punchRows, error: punchesError } = await supabase
    .schema("ops")
    .from("time_punches")
    .select("id, staff_id, punch_type, punched_at, time_entry_id")
    .eq("staff_id", req.staff_id)
    .gte("punched_at", zonedDayStart(day).toISOString())
    .lt("punched_at", zonedDayStart(addDays(day, 2)).toISOString());
  if (punchesError) return NextResponse.json({ ok: false, error: punchesError.message }, { status: 500 });
  type P = { id: string; staff_id: string; punch_type: "clock_in" | "clock_out"; punched_at: string; time_entry_id: string | null };
  const at = new Date(req.requested_at as string);
  const plan = planClockOut(
    ((punchRows ?? []) as P[]).map((r) => ({ id: r.id, staffId: r.staff_id, punchType: r.punch_type, punchedAt: r.punched_at, timeEntryId: r.time_entry_id ?? undefined })),
    { id: entry.id as string, staffId: req.staff_id as string, day },
    at
  );
  if (!plan.ok) return NextResponse.json({ ok: false, error: `${plan.error} Reject it with a note so they can ask again.` }, { status: 409 });

  const { error: approveError } = await supabase.schema("ops").rpc("approve_correction_request", { p_id: id, p_note: note || null });
  if (approveError) return NextResponse.json({ ok: false, error: approveError.message }, { status: approveError.code === "42501" ? 403 : 409 });

  // The day's summary follows its punches. `flag` stays missed_punch, as with an
  // admin's direct fix (0029): the day WAS missed, and the punch says who fixed it.
  const { error: summaryError } = await supabase
    .schema("ops")
    .from("time_entries")
    .update({ clock_out: timeLabel(at), total_minutes: plan.totalMinutes, session_count: plan.sessionCount })
    .eq("id", entry.id);
  if (summaryError) return NextResponse.json({ ok: false, error: `Approved, but the day's summary failed: ${summaryError.message}` }, { status: 500 });
  return NextResponse.json({ ok: true, totalMinutes: plan.totalMinutes });
}
