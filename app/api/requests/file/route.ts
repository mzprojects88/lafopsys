import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteObject, presignGet, putObject } from "@/lib/files/b2";
import { sanitiseSegment } from "@/lib/utils/file-paths";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = ["receipt", "invoice", "quotation", "other"] as const;
/** Under Vercel's 4.5 MB request limit once base64-encoded. */
const MAX_BYTES = 3 * 1024 * 1024;
const TYPES: Record<string, (b: Uint8Array) => boolean> = {
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  "application/pdf": (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46,
};

/** The bytes of a data URL of an accepted type, checked by its first bytes, not just its label. */
function decode(value: unknown): { bytes: Uint8Array; type: string } | null {
  if (typeof value !== "string") return null;
  const m = /^data:(image\/jpeg|image\/png|application\/pdf);base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!m || m[2].length > Math.ceil((MAX_BYTES * 4) / 3) + 4) return null;
  const bytes = Uint8Array.from(Buffer.from(m[2], "base64"));
  return bytes.length > 0 && bytes.length <= MAX_BYTES && TYPES[m[1]](bytes) ? { bytes, type: m[1] } : null;
}

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
  const body = (await request.json().catch(() => null)) as { voucherId?: unknown; kind?: unknown; fileName?: unknown; data?: unknown } | null;
  const voucherId = typeof body?.voucherId === "string" && UUID_RE.test(body.voucherId) ? body.voucherId : null;
  const kind = KINDS.find((k) => k === body?.kind) ?? null;
  const fileName = typeof body?.fileName === "string" ? sanitiseSegment(body.fileName) : null;
  if (!voucherId || !kind || !fileName) return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  const file = decode(body?.data);
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

/** Removes a file: whoever may attach to the request now, their own uploads; Finance editors, any. */
export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!UUID_RE.test(id)) return NextResponse.json({ ok: false, error: "Bad file id." }, { status: 400 });
  const { supabase, user } = await caller();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  const { data } = await supabase.schema("ops").from("voucher_files").select("voucher_id, object_key, uploaded_by").eq("id", id).maybeSingle();
  if (!data) return NextResponse.json({ ok: false, error: "No file you can see." }, { status: 404 });
  const [{ data: may }, { data: finance }] = await Promise.all([
    supabase.schema("ops").rpc("voucher_can_attach", { p_id: data.voucher_id }),
    supabase.schema("shared").rpc("module_editable", { p_module: "finance" }),
  ]);
  if (!may || (data.uploaded_by !== user.id && !finance)) return NextResponse.json({ ok: false, error: "You can't remove this file now." }, { status: 403 });
  const { error } = await createAdminClient().schema("ops").from("voucher_files").delete().eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  await deleteObject(data.object_key as string).catch(() => undefined);
  return NextResponse.json({ ok: true });
}
