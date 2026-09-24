import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { presignGet } from "@/lib/files/b2";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A five-minute link to one punch photo (0060). Read as the caller, so RLS
 * decides: admins and HR get the row, everyone else (the person in the
 * photo included) gets nothing and so no link.
 */
export async function GET(request: Request) {
  const punchId = new URL(request.url).searchParams.get("punch") ?? "";
  if (!UUID_RE.test(punchId)) return NextResponse.json({ ok: false, error: "Bad punch id." }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const { data } = await supabase.schema("ops").from("time_punch_photos").select("object_key").eq("punch_id", punchId).maybeSingle();
  if (!data) return NextResponse.json({ ok: false, error: "No photo you can see for this punch." }, { status: 404 });

  const url = await presignGet(data.object_key as string, `punch-${punchId}.jpg`, "image/jpeg", true);
  return NextResponse.json({ ok: true, url }, { headers: { "cache-control": "no-store" } });
}
