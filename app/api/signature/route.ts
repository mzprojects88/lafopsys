import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteObject, presignGet, putObject } from "@/lib/files/b2";
import { decodeDataUrl, tooLarge } from "@/lib/files/data-url";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 1024 * 1024;
const TYPES = ["image/png", "image/jpeg"];

async function caller() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

/**
 * POST /api/signature: the signed-in person files their OWN signature image (0149), a PNG or JPG of up to 1 MB,
 * checked by its bytes (lib/files/data-url). Nobody uploads for someone else, the Super Admin included. The row is
 * the server's (service role), replacing any earlier one, whose file then leaves storage; the upload is logged.
 */
export async function POST(request: Request) {
  const { user } = await caller();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  const bad = () => NextResponse.json({ ok: false, error: "Use a PNG or JPG of your signature, up to 1 MB." }, { status: 400 });
  if (tooLarge(request, MAX_BYTES)) return bad();
  const body = (await request.json().catch(() => null)) as { data?: unknown } | null;
  const file = decodeDataUrl(body?.data, TYPES, MAX_BYTES);
  if (!file) return bad();

  const db = createAdminClient().schema("shared");
  const { data: old } = await db.from("staff_signatures").select("object_key").eq("staff_id", user.id).maybeSingle();
  const key = `HR/Signatures/${user.id}/${crypto.randomUUID()}.${file.type === "image/png" ? "png" : "jpg"}`;
  try {
    await putObject(key, file.bytes, file.type);
  } catch {
    return NextResponse.json({ ok: false, error: "The signature couldn't be stored; try again." }, { status: 502 });
  }
  const { error } = await db.from("staff_signatures").upsert({ staff_id: user.id, object_key: key, content_type: file.type, bytes: file.bytes.length, uploaded_at: new Date().toISOString() });
  if (error) {
    await deleteObject(key).catch(() => undefined);
    return NextResponse.json({ ok: false, error: `The signature couldn't be saved: ${error.message}` }, { status: 500 });
  }
  // Two uploads at once (a double click): whichever row stands keeps its file; any other one leaves storage.
  const { data: now } = await db.from("staff_signatures").select("object_key").eq("staff_id", user.id).maybeSingle();
  const kept = now?.object_key as string | undefined;
  for (const k of [key, old?.object_key as string | undefined]) if (k && k !== kept) await deleteObject(k).catch(() => undefined);
  const { error: logError } = await db.from("staff_signature_log").insert({ staff_id: user.id, action: "uploaded", by_staff_id: user.id });
  if (logError) return NextResponse.json({ ok: false, error: `Saved, but the change log failed: ${logError.message}` }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** A five-minute link to a signature: your own, or anyone's for the Super Admin (RLS decides). */
export async function GET(request: Request) {
  const { supabase, user } = await caller();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  const asked = new URL(request.url).searchParams.get("staff") ?? user.id;
  if (!UUID_RE.test(asked)) return NextResponse.json({ ok: false, error: "Bad staff id." }, { status: 400 });
  const { data } = await supabase.schema("shared").from("staff_signatures").select("object_key, content_type, uploaded_at").eq("staff_id", asked).maybeSingle();
  if (!data) return NextResponse.json({ ok: true, url: null }, { headers: { "cache-control": "no-store" } });
  const url = await presignGet(data.object_key as string, "signature", data.content_type as string, true);
  return NextResponse.json({ ok: true, url, uploadedAt: data.uploaded_at }, { headers: { "cache-control": "no-store" } });
}

/** Removes a signature: your own, or anyone's for the Super Admin (someone who has left); logged. */
export async function DELETE(request: Request) {
  const { supabase, user } = await caller();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  const asked = new URL(request.url).searchParams.get("staff") ?? user.id;
  if (!UUID_RE.test(asked)) return NextResponse.json({ ok: false, error: "Bad staff id." }, { status: 400 });
  // Read as the caller: their own row, or (the Super Admin) anyone's; nobody else gets a row to remove.
  const { data } = await supabase.schema("shared").from("staff_signatures").select("object_key").eq("staff_id", asked).maybeSingle();
  if (!data) return NextResponse.json({ ok: false, error: "No signature you can remove." }, { status: 404 });
  const db = createAdminClient().schema("shared");
  const { error } = await db.from("staff_signatures").delete().eq("staff_id", asked);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  await deleteObject(data.object_key as string).catch(() => undefined);
  const { error: logError } = await db.from("staff_signature_log").insert({ staff_id: asked, action: "removed", by_staff_id: user.id });
  if (logError) return NextResponse.json({ ok: false, error: `Removed, but the change log failed: ${logError.message}` }, { status: 500 });
  return NextResponse.json({ ok: true });
}
