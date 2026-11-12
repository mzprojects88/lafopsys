import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteObject } from "@/lib/files/b2";
import { refreshDay } from "@/lib/server/dtr-day";

type Deleted = { time_entry_id: string | null; entry_deleted: boolean; photo_key: string | null };

/**
 * POST /api/dtr/punch/delete: those who manage punches delete one made by mistake (0141, widened 0146). The one door: it verifies who
 * is signed in and runs ops.time_punch_delete (the server's only) as them; the function decides (manages punches,
 * with a reason), logs a full copy and removes the punch, its photo record and an emptied day. Then the photo file
 * leaves storage, and a day that keeps other punches gets its summary recomputed by the punch route's rules.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { punchId?: unknown; reason?: unknown } | null;
  const punchId = typeof body?.punchId === "string" && /^[0-9a-f-]{36}$/i.test(body.punchId) ? body.punchId : null;
  const reason = typeof body?.reason === "string" ? body.reason : "";
  if (!punchId) return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });

  const db = createAdminClient();
  const { data, error } = await db.schema("ops").rpc("time_punch_delete", { p_punch: punchId, p_reason: reason, p_actor: user.id });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: error.code === "42501" ? 403 : 400 });
  const d = data as Deleted;

  const warnings: string[] = [];
  if (d.photo_key) {
    try {
      await deleteObject(d.photo_key);
    } catch {
      warnings.push("its photo file could not be removed from storage");
    }
  }
  if (d.time_entry_id && !d.entry_deleted) {
    const w = await refreshDay(db, d.time_entry_id);
    if (w) warnings.push(w);
  }
  return NextResponse.json({ ok: true, warning: warnings.length ? `The punch is deleted, but ${warnings.join(", and ")}.` : null });
}
