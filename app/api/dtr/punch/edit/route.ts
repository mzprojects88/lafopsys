import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { addDays, orderBroken } from "@/lib/utils/dtr";
import { instantOn } from "@/lib/utils/dtr-prompts";
import { asPunchLike, punchesBetween, refreshDay } from "@/lib/server/dtr-day";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/dtr/punch/edit: changes a punch's time (0146). Those who manage punches only (checked first); the time
 * must keep the person's punches in order (orderBroken); ops.time_punch_edit (the server's only) keeps the day rule,
 * logs the original time with the reason and moves the punch. Then the day's summary follows its punches.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  const { data: may } = await supabase.schema("ops").rpc("manages_punches");
  if (may !== true) return NextResponse.json({ ok: false, error: "Only those who manage punches change one." }, { status: 403 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const punchId = typeof body?.punchId === "string" && UUID_RE.test(body.punchId) ? body.punchId : null;
  const date = typeof body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : null;
  const time = typeof body?.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(body.time) ? body.time : null;
  const reason = typeof body?.reason === "string" ? body.reason : "";
  if (!punchId || !date || !time) return NextResponse.json({ ok: false, error: "The punch, a day and a time are all required." }, { status: 400 });
  const at = instantOn(date, time);

  const db = createAdminClient();
  const { data: punch } = await db.schema("ops").from("time_punches").select("id, staff_id, time_entry_id").eq("id", punchId).maybeSingle();
  if (!punch) return NextResponse.json({ ok: false, error: "No such punch." }, { status: 404 });
  const { data: entry } = await db.schema("ops").from("time_entries").select("date").eq("id", punch.time_entry_id).maybeSingle();
  if (!entry) return NextResponse.json({ ok: false, error: "That time record no longer exists." }, { status: 404 });
  const day = String(entry.date);
  try {
    const before = (await punchesBetween(db, String(punch.staff_id), addDays(day, -1), addDays(day, 3))).map(asPunchLike);
    const broken = orderBroken(before, before.map((p) => (p.id === punchId ? { ...p, punchedAt: at.toISOString() } : p)));
    if (broken) return NextResponse.json({ ok: false, error: broken }, { status: 409 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }

  const { error } = await db.schema("ops").rpc("time_punch_edit", { p_punch: punchId, p_at: at.toISOString(), p_reason: reason, p_actor: user.id });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: error.code === "42501" ? 403 : 409 });
  const warning = await refreshDay(db, String(punch.time_entry_id));
  return NextResponse.json({ ok: true, warning: warning ? `The time is changed, but ${warning}.` : null });
}
