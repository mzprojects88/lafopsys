import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { readCaseDocument } from "@/lib/ai/openai";
import { DOCUMENT_KINDS, FORM_IDS, dataFromPairs, formsForAi, type FormId } from "@/lib/case-files/forms";
import { todayIso } from "@/lib/utils/date";

export const maxDuration = 300;
const UUID = /^[0-9a-f-]{36}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Reads one uploaded case paper with the AI (0124) and drafts the matching records for the social
 * worker to check and approve -- nothing is approved here. Only when Settings › Case files allows it,
 * and only for the social worker: every read and write uses the caller's session, so the database's
 * social-worker-only rules apply. The paper's original case number fills the child's record only
 * where none is set.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { documentId?: unknown } | null;
  const documentId = typeof body?.documentId === "string" && UUID.test(body.documentId) ? body.documentId : null;
  if (!documentId) return NextResponse.json({ error: "Choose a paper." }, { status: 400 });

  const { data: settings } = await supabase.schema("shared").from("app_settings").select("case_ai_reading").eq("id", true).maybeSingle();
  if (settings?.case_ai_reading !== true) return NextResponse.json({ error: "Reading case papers with AI is turned off in Settings." }, { status: 403 });

  // Reading drafts records: the social worker's job alone (the Super Admin and the CEO only view).
  const { data: me } = await supabase.schema("shared").from("staff").select("role, extra_roles").eq("id", userData.user.id).maybeSingle();
  if (me?.role !== "social_worker" && !(me?.extra_roles as string[] | null)?.includes("social_worker")) {
    return NextResponse.json({ error: "Only the social worker reads case papers with AI." }, { status: 403 });
  }

  const ops = supabase.schema("ops");
  const { data: doc } = await ops.from("case_documents").select("id, patient_id, storage_path, content_type").eq("id", documentId).maybeSingle();
  if (!doc) return NextResponse.json({ error: "Only the social worker can read case papers." }, { status: 404 });

  await ops.from("case_documents").update({ ai_status: "pending", ai_error: null }).eq("id", doc.id);
  try {
    const { data: blob, error: downloadError } = await supabase.storage.from("case-files").download(doc.storage_path);
    if (downloadError || !blob) throw new Error("The file could not be opened.");
    const read = await readCaseDocument(new Uint8Array(await blob.arrayBuffer()), doc.content_type, DOCUMENT_KINDS, formsForAi());

    let drafted = 0;
    for (const r of read.records) {
      if (!FORM_IDS.includes(r.form as FormId)) continue;
      const data = dataFromPairs(r.form as FormId, r.fields);
      if (!Object.keys(data).length) continue;
      const heldOn = r.heldOn && DAY.test(r.heldOn) && r.heldOn <= todayIso() ? r.heldOn : null;
      const { error } = await ops.from("case_records").insert({
        patient_id: doc.patient_id,
        form: r.form,
        status: "draft",
        held_on: heldOn,
        venue: r.venue?.trim().slice(0, 200) || null,
        data,
        source_document_id: doc.id,
      });
      if (!error) drafted++;
    }

    const original = read.originalCaseNumber?.trim();
    if (original && /^[A-Za-z0-9-]{3,40}$/.test(original)) {
      await ops.from("patients").update({ legacy_code: original }).eq("id", doc.patient_id).is("legacy_code", null);
    }
    await ops.from("case_documents").update({ ai_status: "read", ai_summary: read.summary.slice(0, 2000), read_at: new Date().toISOString() }).eq("id", doc.id);
    return NextResponse.json({ ok: true, drafted });
  } catch (e) {
    const message = e instanceof Error && /abort/i.test(e.message) ? "The AI took too long: try again." : "The AI could not read this paper. Try a clearer scan, or fill the form by hand.";
    await ops.from("case_documents").update({ ai_status: "failed", ai_error: message }).eq("id", doc.id);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
