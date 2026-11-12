import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteObject, presignGet, putObject } from "@/lib/files/b2";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 1024 * 1024;
const TYPES: Record<string, (b: Uint8Array) => boolean> = {
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
};

async function caller() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

/**
 * POST /api/signature: the signed-in person files their OWN signature image (0149), a PNG or JPG of up to 1 MB,
 * checked by its first bytes. Nobody uploads for someone else, the Super Admin included. The row is the server's
 * (service role), replacing any earlier one, whose file then leaves storage; the upload is logged.
 */
export async function POST(request: Request) {
  const { user } = await caller();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { data?: unknown } | null;
  const m = typeof body?.data === "string" ? /^data:(image\/jpeg|image\/png);base64,([A-Za-z0-9+/=]+)$/.exec(body.data) : null;
  const bytes = m && m[2].length <= Math.ceil((MAX_BYTES * 4) / 3) + 4 ? Uint8Array.from(Buffer.from(m[2], "base64")) : null;
  if (!m || !bytes || bytes.length === 0 || bytes.length > MAX_BYTES || !TYPES[m[1]](bytes)) {
    return NextResponse.json({ ok: false, error: "Use a PNG or JPG of your signature, up to 1 MB." }, { status: 400 });
  }
  const db = createAdminClient().schema("shared");
  const { data: old } = await db.from("staff_signatures").select("object_key").eq("staff_id", user.id).maybeSingle();
  const key = `HR/Signatures/${user.id}/${crypto.randomUUID()}.${m[1] === "image/png" ? "png" : "jpg"}`;
  try {
    await putObject(key, bytes, m[1]);
  } catch {
    return NextResponse.json({ ok: false, error: "The signature couldn't be stored; try again." }, { status: 502 });
  }
  const { error } = await db.from("staff_signatures").upsert({ staff_id: user.id, object_key: key, content_type: m[1], bytes: bytes.length, uploaded_at: new Date().toISOString() });
  if (error) {
    await deleteObject(key).catch(() => undefined);
    return NextResponse.json({ ok: false, error: `The signature couldn't be saved: ${error.message}` }, { status: 500 });
  }
  if (old?.object_key) await deleteObject(old.object_key as string).catch(() => undefined);
  await db.from("staff_signature_log").insert({ staff_id: user.id, action: "uploaded", by_staff_id: user.id });
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
  await db.from("staff_signature_log").insert({ staff_id: asked, action: "removed", by_staff_id: user.id });
  return NextResponse.json({ ok: true });
}
