import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteObject, presignGet, putObject } from "@/lib/files/b2";
import { sanitiseSegment } from "@/lib/utils/file-paths";
import { decodeDataUrl, tooLarge } from "@/lib/files/data-url";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = ["receipt", "invoice", "quotation", "proof", "other"] as const;
/** Under Vercel's 4.5 MB request limit once base64-encoded. */
const MAX_BYTES = 3 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "application/pdf"];

async function caller() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

/**
 * Files a receipt, invoice or quotation on a payment request (0134). The database decides, as the caller,
 * whether they may attach (the requester until Finance prepares it; Finance editors until it closes); the
 * row is then written with the service role, so the file's key is the server's, never the browser's.
 */
export async function POST(request: Request) {
  const { supabase, user } = await caller();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (tooLarge(request, MAX_BYTES)) return NextResponse.json({ ok: false, error: "Attach a photo (JPG or PNG) or a PDF of up to 3 MB." }, { status: 413 });
  const body = (await request.json().catch(() => null)) as { voucherId?: unknown; kind?: unknown; fileName?: unknown; data?: unknown } | null;
  const voucherId = typeof body?.voucherId === "string" && UUID_RE.test(body.voucherId) ? body.voucherId : null;
  const kind = KINDS.find((k) => k === body?.kind) ?? null;
  const fileName = typeof body?.fileName === "string" ? sanitiseSegment(body.fileName) : null;
  if (!voucherId || !kind || !fileName) return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  const file = decodeDataUrl(body?.data, TYPES, MAX_BYTES);
  if (!file) return NextResponse.json({ ok: false, error: "Attach a photo (JPG or PNG) or a PDF of up to 3 MB." }, { status: 400 });

  const { data: may } = await supabase.schema("ops").rpc("voucher_can_attach", { p_id: voucherId });
  if (!may) return NextResponse.json({ ok: false, error: "You can't add files to this request now." }, { status: 403 });

  const id = crypto.randomUUID();
  const key = `Finance/Vouchers/${new Date().getUTCFullYear()}/${voucherId}/${id}-${fileName}`;
  try {
    await putObject(key, file.bytes, file.type);
  } catch {
    return NextResponse.json({ ok: false, error: "The file couldn't be stored; try again." }, { status: 502 });
  }
  const { error } = await createAdminClient()
    .schema("ops")
    .from("voucher_files")
    .insert({ id, voucher_id: voucherId, kind, object_key: key, file_name: fileName, content_type: file.type, bytes: file.bytes.length, uploaded_by: user.id });
  if (error) {
    await deleteObject(key).catch(() => undefined);
    return NextResponse.json({ ok: false, error: `The file couldn't be filed: ${error.message}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id });
}

/** A five-minute link to one file, read as the caller so RLS decides. */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!UUID_RE.test(id)) return NextResponse.json({ ok: false, error: "Bad file id." }, { status: 400 });
  const { supabase, user } = await caller();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  const { data } = await supabase.schema("ops").from("voucher_files").select("object_key, file_name, content_type").eq("id", id).maybeSingle();
  if (!data) return NextResponse.json({ ok: false, error: "No file you can see." }, { status: 404 });
  const url = await presignGet(data.object_key as string, data.file_name as string, data.content_type as string, true);
  return NextResponse.json({ ok: true, url }, { headers: { "cache-control": "no-store" } });
}

/** Removes a file: its uploader, while they may still attach to the request (never after approval). */
export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!UUID_RE.test(id)) return NextResponse.json({ ok: false, error: "Bad file id." }, { status: 400 });
  const { supabase, user } = await caller();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  const { data } = await supabase.schema("ops").from("voucher_files").select("voucher_id, object_key, uploaded_by").eq("id", id).maybeSingle();
  if (!data) return NextResponse.json({ ok: false, error: "No file you can see." }, { status: 404 });
  const { data: may } = await supabase.schema("ops").rpc("voucher_can_attach", { p_id: data.voucher_id });
  if (!may || data.uploaded_by !== user.id) return NextResponse.json({ ok: false, error: "You can't remove this file now." }, { status: 403 });
  const { error } = await createAdminClient().schema("ops").from("voucher_files").delete().eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  await deleteObject(data.object_key as string).catch(() => undefined);
  return NextResponse.json({ ok: true });
}
