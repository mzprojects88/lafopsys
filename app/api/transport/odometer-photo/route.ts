import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteObject, presignGet, putObject } from "@/lib/files/b2";
import { openaiConfigured } from "@/lib/ai/env";
import { readOdometerPhoto, type OdometerRead } from "@/lib/ai/openai";
import { decodeJpegDataUrl } from "@/lib/utils/punch-photo";
import { odometerPhotoKey } from "@/lib/utils/file-paths";
import { todayIso } from "@/lib/utils/date";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAGES = ["depart", "arrive", "pump", "other"] as const;
/** A 1280px dashboard photo is ~150-400 KB; this is the ceiling. */
const MAX_BYTES = 2_000_000;

/**
 * Files an odometer photo and reads it (Fuel Monitoring, 0078). The caller
 * must be able to edit Transport and see the vehicle -- both asked of the
 * database as the caller. The row is then written with the service role, so
 * the AI reading and the file's key are the server's, never the browser's.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { vehicleId?: unknown; stage?: unknown; image?: unknown } | null;
  const vehicleId = typeof body?.vehicleId === "string" && UUID_RE.test(body.vehicleId) ? body.vehicleId : null;
  const stage = STAGES.find((s) => s === body?.stage) ?? null;
  if (!vehicleId || !stage) return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  const jpeg = decodeJpegDataUrl(body?.image, MAX_BYTES);
  if (!jpeg) return NextResponse.json({ ok: false, error: "That photo couldn't be read; take it again." }, { status: 400 });

  const { data: canEdit } = await supabase.schema("shared").rpc("module_editable", { p_module: "transport" });
  if (!canEdit) return NextResponse.json({ ok: false, error: "Your access to Transport is view only." }, { status: 403 });
  const { data: vehicle } = await supabase.schema("ops").from("vehicles").select("id, name").eq("id", vehicleId).maybeSingle();
  if (!vehicle) return NextResponse.json({ ok: false, error: "No such vehicle." }, { status: 404 });

  const photoId = crypto.randomUUID();
  const day = todayIso();
  const key = odometerPhotoKey(vehicle.name as string, day, photoId);
  try {
    await putObject(key, jpeg, "image/jpeg");
  } catch {
    return NextResponse.json({ ok: false, error: "The photo couldn't be stored; try again." }, { status: 502 });
  }

  // A reading the AI can't give is not an error: the driver types it.
  let read: OdometerRead = { reading: null, confidence: 0, note: "AI reading is off." };
  if (openaiConfigured()) {
    try {
      read = await readOdometerPhoto(jpeg);
    } catch {
      read = { reading: null, confidence: 0, note: "The AI couldn't read it this time." };
    }
  }

  const { error } = await createAdminClient()
    .schema("ops")
    .from("odometer_photos")
    .insert({
      id: photoId,
      vehicle_id: vehicleId,
      stage,
      taken_by: user.id,
      taken_on: day,
      object_key: key,
      bytes: jpeg.length,
      ai_reading: read.reading,
      ai_confidence: Math.round(read.confidence * 100) / 100,
      ai_note: read.note,
    });
  if (error) {
    await deleteObject(key).catch(() => undefined);
    return NextResponse.json({ ok: false, error: `The photo couldn't be filed: ${error.message}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true, photoId, reading: read.reading, confidence: read.confidence, note: read.note });
}

/** A five-minute link to one odometer photo, read as the caller so RLS decides. */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!UUID_RE.test(id)) return NextResponse.json({ ok: false, error: "Bad photo id." }, { status: 400 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  const { data } = await supabase.schema("ops").from("odometer_photos").select("object_key").eq("id", id).maybeSingle();
  if (!data) return NextResponse.json({ ok: false, error: "No photo you can see." }, { status: 404 });
  const url = await presignGet(data.object_key as string, `odometer-${id}.jpg`, "image/jpeg", true);
  return NextResponse.json({ ok: true, url }, { headers: { "cache-control": "no-store" } });
}
