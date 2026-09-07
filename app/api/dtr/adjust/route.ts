import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { addDays, dayKey, entryTotals, pairSessions, timeLabel, zonedDayStart } from "@/lib/utils/dtr";

interface AdjustBody {
  timeEntryId?: unknown;
  /** Manila wall-clock day of the clock-out, `yyyy-MM-dd`. Usually the entry's
   * own day; the next day for a shift that ran past midnight. */
  date?: unknown;
  /** Manila wall-clock time, `HH:mm`. */
  time?: unknown;
  reason?: unknown;
}

/**
 * Supplies a clock-out that was never made.
 *
 * Four of the seven days recorded before this existed have a clock-in and no
 * clock-out, so they read as zero hours worked. Somebody has to be able to put
 * the real time in -- but a DTR whose entries can be edited afterwards is not
 * a DTR, which is why this ADDS a punch marked `source = 'adjustment'` and
 * signed by the admin who made it, and never edits or deletes an existing one.
 * ops.time_punches still has no update or delete policy for anyone.
 *
 * Admin only. The signature comes from the session (the policy requires
 * `adjusted_by = auth.uid()`), so it cannot be attributed to a colleague.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  const { data: callerStaff } = await supabase.schema("shared").from("staff").select("role").eq("id", user.id).single();
  if (callerStaff?.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Only admins can correct a time record." }, { status: 403 });
  }

  let body: AdjustBody;
  try {
    body = (await request.json()) as AdjustBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed request body." }, { status: 400 });
  }

  const timeEntryId = typeof body.timeEntryId === "string" ? body.timeEntryId : null;
  const date = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : null;
  const time = typeof body.time === "string" && /^\d{2}:\d{2}$/.test(body.time) ? body.time : null;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  if (!timeEntryId || !date || !time) {
    return NextResponse.json({ ok: false, error: "A day, a time and the entry are all required." }, { status: 400 });
  }
  if (!reason) {
    return NextResponse.json({ ok: false, error: "Say why the clock-out is missing." }, { status: 400 });
  }

  const { data: entry, error: entryError } = await supabase
    .schema("ops")
    .from("time_entries")
    .select("id, staff_id, date, clock_in, clock_out")
    .eq("id", timeEntryId)
    .maybeSingle();
  if (entryError) return NextResponse.json({ ok: false, error: entryError.message }, { status: 500 });
  if (!entry) return NextResponse.json({ ok: false, error: "That time record no longer exists." }, { status: 404 });
  if (!entry.clock_in) {
    return NextResponse.json({ ok: false, error: "That day has no clock-in to close." }, { status: 409 });
  }
  if (entry.clock_out) {
    return NextResponse.json({ ok: false, error: "That day already has a clock-out." }, { status: 409 });
  }

  // Manila wall clock -> a real instant. Built from the day's midnight rather
  // than parsed in the server's zone, which is UTC on Vercel and would land the
  // punch eight hours out.
  const [hours, minutes] = time.split(":").map(Number);
  if (hours > 23 || minutes > 59) {
    return NextResponse.json({ ok: false, error: "That is not a valid time." }, { status: 400 });
  }
  const punchedAt = new Date(zonedDayStart(date).getTime() + (hours * 60 + minutes) * 60_000);

  if (punchedAt.getTime() > Date.now()) {
    return NextResponse.json({ ok: false, error: "A clock-out can't be in the future." }, { status: 400 });
  }

  // The same window the punch route uses: the entry's day and the one after
  // it, so an overnight session's clock-out is in range wherever it falls.
  const entryDay = dayKey(entry.date as string);
  const { data: punchRows, error: punchesError } = await supabase
    .schema("ops")
    .from("time_punches")
    .select("id, staff_id, punch_type, punched_at, time_entry_id")
    .eq("staff_id", entry.staff_id)
    .gte("punched_at", zonedDayStart(entryDay).toISOString())
    .lt("punched_at", zonedDayStart(addDays(entryDay, 2)).toISOString())
    .order("punched_at", { ascending: true });
  if (punchesError) return NextResponse.json({ ok: false, error: punchesError.message }, { status: 500 });

  type PunchRowLite = { id: string; staff_id: string; punch_type: "clock_in" | "clock_out"; punched_at: string; time_entry_id: string | null };
  const existing = (punchRows ?? []) as PunchRowLite[];
  const lastIn = [...existing].reverse().find((p) => p.punch_type === "clock_in");
  if (lastIn && punchedAt.getTime() <= new Date(lastIn.punched_at).getTime()) {
    return NextResponse.json(
      { ok: false, error: `The clock-out has to be after the clock-in at ${timeLabel(lastIn.punched_at)}.` },
      { status: 400 }
    );
  }

  // Pair the punches as they WOULD be with this clock-out, before writing it.
  //
  // pairSessions closes a still-open session as `missed_out` the moment a
  // clock-in arrives on a later day. So on consecutive forgotten days, a
  // clock-out timed after the NEXT day's clock-in closes that day's session
  // instead of this one -- silently, and on the wrong person's wrong day.
  // Reachable from the dialog's "next morning" option, which is why it is
  // checked here rather than trusted to the caller.
  const sessions = pairSessions(
    [
      ...existing,
      {
        id: "pending-adjustment",
        staff_id: entry.staff_id as string,
        punch_type: "clock_out" as const,
        punched_at: punchedAt.toISOString(),
        time_entry_id: entry.id as string,
      },
    ].map((r) => ({
      id: r.id,
      staffId: r.staff_id,
      punchType: r.punch_type,
      punchedAt: r.punched_at,
      timeEntryId: r.time_entry_id ?? undefined,
    }))
  );

  const closedByThis = sessions.find((s) => s.clockOutAt === punchedAt.toISOString());
  if (!closedByThis || closedByThis.dayKey !== entryDay) {
    return NextResponse.json(
      {
        ok: false,
        error: "That time falls after the next shift started, so it would close that one instead. Pick an earlier time.",
      },
      { status: 409 }
    );
  }

  const totals = entryTotals(sessions, entryDay, entry.staff_id as string);

  const { error: insertError } = await supabase.schema("ops").from("time_punches").insert({
    time_entry_id: entry.id,
    staff_id: entry.staff_id,
    punch_type: "clock_out",
    punched_at: punchedAt.toISOString(),
    location_status: "unavailable",
    device_type: "unknown",
    source: "adjustment",
    adjustment_reason: reason,
    adjusted_by: user.id,
  });
  if (insertError) return NextResponse.json({ ok: false, error: insertError.message }, { status: 500 });

  // `flag` is deliberately left alone. The day WAS a missed punch; that it has
  // since been corrected is recorded by the adjustment punch, which says who
  // supplied the time and why. Clearing the flag would erase that it happened.
  const { error: summaryError } = await supabase
    .schema("ops")
    .from("time_entries")
    .update({
      clock_out: timeLabel(punchedAt),
      total_minutes: totals.totalMinutes,
      session_count: totals.sessionCount,
    })
    .eq("id", entry.id);
  if (summaryError) {
    return NextResponse.json(
      { ok: false, error: `The correction was recorded, but the daily summary failed: ${summaryError.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, totalMinutes: totals.totalMinutes, clockOut: timeLabel(punchedAt) });
}
