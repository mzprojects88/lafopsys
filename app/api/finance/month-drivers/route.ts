import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { callerHolds } from "@/lib/rbac/server-powers";
import { draftDriversFor } from "@/lib/finance/month-drivers";

export const dynamic = "force-dynamic";

/**
 * Suggest / Regenerate on the monthly summary (0113): a confirmer asks for a draft of one
 * month's Key monthly drivers. `preview: true` returns the text without saving it.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { month?: string; preview?: boolean } | null;
  const month = body?.month ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return NextResponse.json({ ok: false, error: "Bad month." }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (!(await callerHolds(supabase, "confirm_summary"))) {
    return NextResponse.json({ ok: false, error: "Only the CEO, finance or the Super Admin can ask for a draft." }, { status: 403 });
  }

  const result = await draftDriversFor(createAdminClient(), month, { save: !body?.preview });
  return NextResponse.json(result, { status: result.ok ? 200 : result.error.startsWith("AI drafting is not set up") ? 503 : 422, headers: { "cache-control": "no-store" } });
}
