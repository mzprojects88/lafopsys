import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Payload = {
  patient?: Record<string, unknown>;
  diagnosisId?: string | null;
  carerInsert?: { name: string; relationship: string | null; mobile_number: string | null; effective_from: string } | null;
  carerUpdate?: { id: string; relationship?: string; mobile_number?: string };
  insert?: Record<string, unknown>;
};

/**
 * A person decides a change found on the original Patients Database sheet
 * (0064; user, 2026-09-24: the app is the record, the sheet's edits wait
 * for someone to apply them).
 *
 * - apply: the stored write happens (a field of a child, or the new child).
 * - dismiss: nothing changes; the sheet's edit is set aside.
 * - link: a "new child" is really a child already in the app. The sheet's
 *   CN goes on that record, and the next read compares every field the
 *   sheet fills, so any differences come back as their own proposals.
 *
 * For those who can edit Patients (0050). The proposal is claimed first, so
 * two people cannot apply it twice; a failed write puts it back.
 */
export async function POST(request: Request) {
  const session = await createClient();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  const { data: canEdit } = await session.schema("shared").rpc("module_editable", { p_module: "patients" });
  if (canEdit !== true) return NextResponse.json({ ok: false, error: "Your access to Patients is view only." }, { status: 403 });

  let body: { id?: unknown; action?: unknown; patientId?: unknown; note?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed request body." }, { status: 400 });
  }
  const id = typeof body.id === "string" && UUID_RE.test(body.id) ? body.id : null;
  const action = body.action === "apply" || body.action === "dismiss" || body.action === "link" ? body.action : null;
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null;
  if (!id || !action) return NextResponse.json({ ok: false, error: "A change and an action are required." }, { status: 400 });

  const ops = createAdminClient().schema("ops");
  const decided = { decided_by: user.id, decided_at: new Date().toISOString(), decision_note: note };
  // Claim it: only a pending proposal moves, and only once.
  const { data: claimed } = await ops
    .from("sheet_changes")
    .update({ status: action === "dismiss" ? "dismissed" : "applied", ...decided })
    .eq("id", id)
    .eq("status", "pending")
    .select("id, kind, sheet_cn, patient_id, payload")
    .maybeSingle();
  if (!claimed) return NextResponse.json({ ok: false, error: "Someone already decided this change." }, { status: 409 });
  if (action === "dismiss") return NextResponse.json({ ok: true });

  const release = async (error: string, status = 500) => {
    await ops.from("sheet_changes").update({ status: "pending", decided_by: null, decided_at: null, decision_note: null }).eq("id", id);
    return NextResponse.json({ ok: false, error }, { status });
  };
  const payload = claimed.payload as Payload;

  if (action === "link") {
    const patientId = typeof body.patientId === "string" && UUID_RE.test(body.patientId) ? body.patientId : null;
    if (claimed.kind !== "new_child" || !patientId) return release("Pick the child on file to link.", 400);
    const { data: target } = await ops.from("patients").select("patient_number").eq("id", patientId).maybeSingle();
    if (!target) return release("That child is not on file.", 404);
    if (target.patient_number && target.patient_number !== claimed.sheet_cn) {
      return release(`That child already has CN ${target.patient_number} on the sheet.`, 409);
    }
    // No baseline: the next read compares every field the sheet fills and proposes the differences.
    const { error } = await ops.from("patients").update({ patient_number: claimed.sheet_cn, sheet_row: null }).eq("id", patientId);
    if (error) return release(error.message);
    await ops.from("sheet_changes").update({ patient_id: patientId }).eq("id", id);
    return NextResponse.json({ ok: true, patientId });
  }

  // ---- apply ----
  let patientId = claimed.patient_id as string | null;
  if (claimed.kind === "new_child") {
    const insert = payload.insert ?? {};
    let { data, error } = await ops.from("patients").insert(insert).select("id").single();
    // The old CODE's number was taken since the change was found: the app numbers it instead.
    if (error?.code === "23505" && /case_number/.test(error.message)) ({ data, error } = await ops.from("patients").insert({ ...insert, case_number: null }).select("id").single());
    if (error || !data) return release(error?.code === "23505" ? `CN ${claimed.sheet_cn} is already on file.` : (error?.message ?? "The child was not added."));
    patientId = data.id as string;
    await ops.from("sheet_changes").update({ patient_id: patientId }).eq("id", id);
  } else if (payload.patient && Object.keys(payload.patient).length) {
    const { error } = await ops.from("patients").update(payload.patient).eq("id", patientId!);
    if (error) return release(error.message);
  }
  if (!patientId) return release("The change has no child to apply to.");

  if (payload.diagnosisId) {
    await ops.from("patient_diagnoses").delete().eq("patient_id", patientId);
    const { error } = await ops.from("patient_diagnoses").insert({ patient_id: patientId, diagnosis_id: payload.diagnosisId });
    if (error) return NextResponse.json({ ok: false, error: `Applied, but the diagnosis failed: ${error.message}` }, { status: 500 });
  }
  if (payload.carerInsert) {
    const { error } = await ops.from("carers").insert({ patient_id: patientId, ...payload.carerInsert });
    if (error) return NextResponse.json({ ok: false, error: `Applied, but the carer failed: ${error.message}` }, { status: 500 });
  }
  if (payload.carerUpdate) {
    const { id: carerId, ...upd } = payload.carerUpdate;
    const { error } = await ops.from("carers").update(upd).eq("id", carerId).eq("patient_id", patientId);
    if (error) return NextResponse.json({ ok: false, error: `Applied, but the carer failed: ${error.message}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true, patientId });
}
