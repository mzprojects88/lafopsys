import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { callerHolds } from "@/lib/rbac/server-powers";
import { draftDriversFor, draftNightly, suggestPurposesFor } from "@/lib/finance/month-drivers";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The monthly summary's AI (0113, 0114, 0121), one month at a time:
 *  - step "draft" (default): a confirmer asks for the month's Key monthly drivers; `preview: true` returns the text without saving.
 *  - step "purposes": finance asks for suggested purposes on the month's untagged debits.
 *  - pg_cron at 1:00 AM Manila with CALENDAR_SYNC_SECRET: the nightly note on yesterday's data (draftNightly).
 */
export async function POST(request: Request) {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (bearer !== undefined) {
    const expected = process.env.CALENDAR_SYNC_SECRET;
    if (!expected) return NextResponse.json({ ok: false, error: "CALENDAR_SYNC_SECRET is not configured on the server." }, { status: 500 });
    const a = Buffer.from(bearer);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
    const nightly = await draftNightly(createAdminClient());
    return NextResponse.json({ ok: true, ...nightly }, { headers: { "cache-control": "no-store" } });
  }

  const body = (await request.json().catch(() => null)) as { month?: string; preview?: boolean; step?: "draft" | "purposes" } | null;
  const month = body?.month ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return NextResponse.json({ ok: false, error: "Bad month." }, { status: 400 });
  const step = body?.step === "purposes" ? "purposes" : "draft";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  const power = step === "purposes" ? "finance_work" : "confirm_summary";
  if (!(await callerHolds(supabase, power))) {
    return NextResponse.json({ ok: false, error: step === "purposes" ? "Only finance can tag what the money was spent on." : "Only the CEO, finance or the Super Admin can ask for a draft." }, { status: 403 });
  }

  const admin = createAdminClient();
  const result = step === "purposes" ? await suggestPurposesFor(admin, month) : await draftDriversFor(admin, month, { save: !body?.preview });
  return NextResponse.json(result, { status: result.ok ? 200 : result.error.startsWith("AI drafting is not set up") ? 503 : 422, headers: { "cache-control": "no-store" } });
}
