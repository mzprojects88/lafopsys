import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailReady, sendPending } from "@/lib/notify/email";
import { buildReportEmail, type ReportKey } from "@/lib/notify/report-emails";
import { isDue } from "@/lib/notify/schedule";
import { todayIso } from "@/lib/utils/date";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface ScheduleRow {
  id: string;
  name: string;
  report: ReportKey;
  recipients: string[];
  frequency: "monthly" | "weekly";
  day: number;
  active: boolean;
  last_sent_on: string | null;
}

/** Whether email is set up (for the Scheduled reports page). */
export async function GET() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({ ok: true, emailReady: emailReady() });
}

/**
 * The daily run (0118): pg_cron at 7:00 AM Manila with CALENDAR_SYNC_SECRET sends every schedule
 * due today; the Super Admin or finance can "Send now" one schedule from the page. Either way the
 * emails go through ops.outbox, then out through Resend (or wait there until the key is set).
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { scheduleId?: string };
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  let only: string | null = null;
  if (bearer !== undefined) {
    const expected = process.env.CALENDAR_SYNC_SECRET;
    if (!expected) return NextResponse.json({ ok: false, error: "CALENDAR_SYNC_SECRET is not configured on the server." }, { status: 500 });
    const a = Buffer.from(bearer);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
  } else {
    const session = await createClient();
    const { data } = await session.auth.getUser();
    if (!data.user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
    const [{ data: admin }, { data: finance }] = await Promise.all([
      session.schema("shared").rpc("has_role", { p_roles: ["admin"] }),
      session.schema("shared").rpc("has_power", { p_power: "finance_work" }),
    ]);
    if (admin !== true && finance !== true) return NextResponse.json({ ok: false, error: "Only the Super Admin or finance sends reports." }, { status: 403 });
    if (!body.scheduleId || !/^[0-9a-f-]{36}$/i.test(body.scheduleId)) return NextResponse.json({ ok: false, error: "Choose a schedule." }, { status: 400 });
    only = body.scheduleId;
  }

  const admin = createAdminClient();
  const today = todayIso();
  const { data: schedules, error } = await admin.schema("ops").from("report_schedules").select("id, name, report, recipients, frequency, day, active, last_sent_on");
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  const due = ((schedules ?? []) as ScheduleRow[]).filter((s) => (only ? s.id === only : isDue(s, today)));
  if (only && !due[0]?.recipients.length) return NextResponse.json({ ok: false, error: "Add at least one email address first." }, { status: 422 });

  let queued = 0;
  for (const s of due) {
    const { subject, html } = await buildReportEmail(admin, s.report, today);
    const { error: qError } = await admin.schema("ops").from("outbox").insert(s.recipients.map((to) => ({ to_address: to, subject, body_html: html, source: `schedule:${s.id}` })));
    if (qError) return NextResponse.json({ ok: false, error: qError.message }, { status: 500 });
    queued += s.recipients.length;
    await admin.schema("ops").from("report_schedules").update({ last_sent_on: today }).eq("id", s.id);
  }
  const result = await sendPending(admin);
  return NextResponse.json({ ok: true, schedules: due.length, queued, ...result, emailReady: emailReady() });
}
