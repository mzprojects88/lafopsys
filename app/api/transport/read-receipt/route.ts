import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { openaiConfigured } from "@/lib/ai/env";
import { readReceiptPhoto } from "@/lib/ai/openai";
import { decodeJpegDataUrl } from "@/lib/utils/punch-photo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** A 1600px receipt photo is well under this. */
const MAX_BYTES = 3_000_000;

/**
 * Reads a fuel or expense receipt to prefill Log fuel / Log expense (0078).
 * Nothing is stored here: the receipt is filed with the entry after the
 * driver checks the fields and saves. Transport editors only.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (!openaiConfigured()) return NextResponse.json({ ok: false, error: "AI reading is off." }, { status: 503 });

  const body = (await request.json().catch(() => null)) as { image?: unknown } | null;
  const jpeg = decodeJpegDataUrl(body?.image, MAX_BYTES);
  if (!jpeg) return NextResponse.json({ ok: false, error: "That photo couldn't be read; take it again." }, { status: 400 });

  const { data: canEdit } = await supabase.schema("shared").rpc("module_editable", { p_module: "transport" });
  if (!canEdit) return NextResponse.json({ ok: false, error: "Your access to Transport is view only." }, { status: 403 });
  const { data: kinds } = await supabase.schema("ops").from("vehicle_expense_kinds").select("id, name");

  try {
    const read = await readReceiptPhoto(jpeg, (kinds ?? []) as { id: string; name: string }[]);
    return NextResponse.json({ ok: true, ...read });
  } catch {
    return NextResponse.json({ ok: false, error: "The AI couldn't read this receipt; fill it in by hand." }, { status: 502 });
  }
}
