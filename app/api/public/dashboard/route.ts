import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * The website's five program figures for the year to date (housing, transportation, meals,
 * LAF Center participants, Care Cart people served) plus the typed prior-year totals -- the
 * LAF Programs sheet's "Website Dashboard" tab, from the app (0112). Public: no session, no
 * names, no detail; cached half an hour.
 */
export async function GET() {
  const { data, error } = await createAdminClient().schema("ops").rpc("website_dashboard");
  if (error) return NextResponse.json({ ok: false, error: "The dashboard is not available right now." }, { status: 503 });
  return NextResponse.json(
    { ok: true, ...(data as Record<string, unknown>) },
    { headers: { "Cache-Control": "public, max-age=1800, s-maxage=1800", "Access-Control-Allow-Origin": "*" } }
  );
}
