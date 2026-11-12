import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { addDays, dayKey, orderBroken, planClockOut, timeLabel } from "@/lib/utils/dtr";
import { instantOn } from "@/lib/utils/dtr-prompts";
import { asPunchLike, punchesBetween, refreshDay } from "@/lib/server/dtr-day";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/dtr/adjust: adds a punch nobody made (0029; widened 0146). A clock-out for a day's session
 * (`timeEntryId`), or a clock-in on a day (`type: "clock_in"`, `staffId`). It ADDS a punch marked Added and signed by
 * whoever added it, never rewrites one. Who may is the database's call (ops.time_punch_add: those who manage
 * punches), checked first so nobody else learns anything from the order checks. A clock-out must close that day's
 * own session (planClockOut); any punch must leave the person's punches in order (orderBroken). Then the day's
 * summary follows its punches; `flag` stays missed_punch, as the day WAS missed.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  const { data: may } = await supabase.schema("ops").rpc("manages_punches");
  if (may !== true) return NextResponse.json({ ok: false, error: "Only those who manage punches add one." }, { status: 403 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const type = body?.type === "clock_in" ? "clock_in" : "clock_out";
  const date = typeof body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : null;
  const time = typeof body?.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(body.time) ? body.time : null;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const entryId = typeof body?.timeEntryId === "string" && UUID_RE.test(body.timeEntryId) ? body.timeEntryId : null;
  let staffId = typeof body?.staffId === "string" && UUID_RE.test(body.staffId) ? body.staffId : null;
  if (!date || !time || (type === "clock_out" ? !entryId : !staffId)) {
    return NextResponse.json({ ok: false, error: "A day, a time and the person (or the day's session) are all required." }, { status: 400 });
  }
  const at = instantOn(date, time);
  if (at.getTime() > Date.now()) return NextResponse.json({ ok: false, error: "A punch can't be in the future." }, { status: 400 });

  const db = createAdminClient();
  let day = dayKey(at);
  if (type === "clock_out") {
    const { data: entry } = await db.schema("ops").from("time_entries").select("id, staff_id, date").eq("id", entryId!).maybeSingle();
    if (!entry) return NextResponse.json({ ok: false, error: "That time record no longer exists." }, { status: 404 });
    staffId = String(entry.staff_id);
    day = String(entry.date);
  }
  let punches;
  try {
    punches = (await punchesBetween(db, staffId!, addDays(day, -1), addDays(day, 3))).map(asPunchLike);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
  if (type === "clock_out") {
    const plan = planClockOut(punches, { id: entryId!, staffId: staffId!, day }, at);
    if (!plan.ok) return NextResponse.json({ ok: false, error: plan.error }, { status: 409 });
  }
  const broken = orderBroken(punches, [...punches, { id: "new-punch", staffId: staffId!, punchType: type, punchedAt: at.toISOString(), timeEntryId: entryId ?? undefined }]);
  if (broken) return NextResponse.json({ ok: false, error: broken }, { status: 409 });

  const { data, error } = await db.schema("ops").rpc("time_punch_add", {
    p_staff: staffId,
    p_type: type,
    p_at: at.toISOString(),
    p_entry: entryId,
    p_reason: reason,
    p_actor: user.id,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: error.code === "42501" ? 403 : 409 });
  const added = data as { punch_id: string; time_entry_id: string };
  const warning = await refreshDay(db, added.time_entry_id);
  return NextResponse.json({
    ok: true,
    timeEntryId: added.time_entry_id,
    clockOut: type === "clock_out" ? timeLabel(at) : undefined,
    warning: warning ? `The punch is added, but ${warning}.` : null,
  });
}
