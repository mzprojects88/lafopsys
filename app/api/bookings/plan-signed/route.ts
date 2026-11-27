import { NextResponse } from "next/server";
import { deleteObject, presignGet, putObject } from "@/lib/files/b2";
import { decodeDataUrl, tooLarge } from "@/lib/files/data-url";
import { signedName } from "@/lib/utils/booking";
import { createClient } from "@/lib/supabase/server";
import { sanitiseSegment } from "@/lib/utils/file-paths";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Under Vercel's 4.5 MB request limit once base64-encoded. */
const MAX_BYTES = 3 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "application/pdf"];

/**
 * The signed copy of an Activity Plan (0187): a photo or scan NCH signed, kept in the file library. The file is stored
 * first, then the plan is changed as the caller, so the bookings editors' own rule on booking.plans decides who may;
 * when it does not let them, the stored file is removed again. The file's key is the server's, never the browser's.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Please sign in again." }, { status: 401 });
  if (tooLarge(request, MAX_BYTES)) return NextResponse.json({ ok: false, error: "Attach a photo (JPG or PNG) or a PDF of up to 3 MB." }, { status: 413 });
  const body = (await request.json().catch(() => null)) as { planId?: unknown; fileName?: unknown; data?: unknown } | null;
  const planId = typeof body?.planId === "string" && UUID_RE.test(body.planId) ? body.planId : null;
  const fileName = typeof body?.fileName === "string" ? sanitiseSegment(body.fileName) : null;
  if (!planId || !fileName) return NextResponse.json({ ok: false, error: "That could not be read." }, { status: 400 });
  const file = decodeDataUrl(body?.data, TYPES, MAX_BYTES);
  if (!file) return NextResponse.json({ ok: false, error: "Attach a photo (JPG or PNG) or a PDF of up to 3 MB." }, { status: 400 });

  const { data: plan } = await supabase.schema("booking").from("plans").select("id, month, signed_file_key").eq("id", planId).maybeSingle();
  if (!plan) return NextResponse.json({ ok: false, error: "That plan was not found." }, { status: 404 });
  const key = `Bookings/Activity Plans/${String(plan.month).slice(0, 7)}/${planId}-${crypto.randomUUID().slice(0, 8)}-${fileName}`;
  try {
    await putObject(key, file.bytes, file.type);
  } catch {
    return NextResponse.json({ ok: false, error: "The file couldn't be stored; try again." }, { status: 502 });
  }
  const { data: changed, error } = await supabase
    .schema("booking")
    .from("plans")
    .update({ signed_file_key: key })
    .eq("id", planId)
    .select("id");
  if (error || !changed?.length) {
    await deleteObject(key).catch(() => undefined);
    return NextResponse.json({ ok: false, error: error ? "The signed copy couldn't be filed." : "Only the people who process bookings can file the signed copy." }, { status: error ? 500 : 403 });
  }
  // The copy it replaces leaves the library.
  if (plan.signed_file_key) await deleteObject(plan.signed_file_key as string).catch(() => undefined);
  return NextResponse.json({ ok: true });
}

/** A five-minute link to the signed copy, read as the caller so the bookings viewers' rule decides. */
export async function GET(request: Request) {
  const planId = new URL(request.url).searchParams.get("id") ?? "";
  if (!UUID_RE.test(planId)) return NextResponse.json({ ok: false, error: "Bad plan id." }, { status: 400 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Please sign in again." }, { status: 401 });
  const { data } = await supabase.schema("booking").from("plans").select("signed_file_key").eq("id", planId).maybeSingle();
  if (!data?.signed_file_key) return NextResponse.json({ ok: false, error: "No signed copy on file." }, { status: 404 });
  const name = signedName(data.signed_file_key as string) || "signed-plan.pdf";
  const type = /\.pdf$/i.test(name) ? "application/pdf" : /\.png$/i.test(name) ? "image/png" : "image/jpeg";
  return NextResponse.redirect(await presignGet(data.signed_file_key as string, name, type, true));
}
