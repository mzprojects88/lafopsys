import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildCaseRecordPdf } from "@/lib/pdf/case-record";
import { accreditationLine } from "@/lib/pdf/accreditation";
import { FORMS, caseNumberFor, type FormId } from "@/lib/case-files/forms";
import { computeAge } from "@/lib/utils/age";

const UUID = /^[0-9a-f-]{36}$/i;
const fullName = (s: { first_name?: string | null; last_name?: string | null } | null | undefined) => `${s?.first_name ?? ""} ${s?.last_name ?? ""}`.trim();

/**
 * An approved case record (0124) as its paper form, for signing. Read with the caller's own session:
 * the database lets only the social worker, the Super Admin and the CEO see case records, so nobody
 * else gets a PDF. The case
 * number is the app's LFCN unless `original` asks for the paper folder's number.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { recordId?: unknown; original?: unknown } | null;
  const recordId = typeof body?.recordId === "string" && UUID.test(body.recordId) ? body.recordId : null;
  if (!recordId) return NextResponse.json({ error: "Choose a record." }, { status: 400 });

  const { data: rec } = await supabase.schema("ops").from("case_records").select("*").eq("id", recordId).maybeSingle();
  if (!rec) return NextResponse.json({ error: "Only the social worker, the Super Admin and the CEO can open case records." }, { status: 404 });
  if (rec.status !== "approved") return NextResponse.json({ error: "Approve the record first: only an approved record is printed for signing." }, { status: 422 });

  const [{ data: patient }, { data: dx }, { data: carer }] = await Promise.all([
    supabase.schema("ops").from("patients").select("first_name, last_name, birth_date, sex, raw_address, case_number, legacy_code").eq("id", rec.patient_id).maybeSingle(),
    supabase.schema("ops").from("patient_diagnoses").select("diagnoses(name)").eq("patient_id", rec.patient_id),
    supabase.schema("ops").from("carers").select("name").eq("patient_id", rec.patient_id).is("effective_to", null).limit(1).maybeSingle(),
  ]);
  if (!patient) return NextResponse.json({ error: "Patient not found" }, { status: 404 });

  // Names on the signature lines only: the preparer, the approver and the CEO.
  const admin = createAdminClient();
  const [{ data: signers }, { data: ceo }, { data: settings }] = await Promise.all([
    admin.schema("shared").from("staff").select("id, first_name, last_name").in("id", [rec.prepared_by, rec.approved_by].filter(Boolean)),
    admin.schema("shared").from("staff").select("first_name, last_name, position").eq("active", true).or("role.eq.ceo,extra_roles.cs.{ceo}").limit(1).maybeSingle(),
    admin.schema("shared").from("app_settings").select("report_header, dswd_label, dswd_number").eq("id", true).maybeSingle(),
  ]);
  const nameOf = (id: string | null) => fullName(signers?.find((s) => s.id === id));
  const caseNumber = caseNumberFor({ caseNumber: patient.case_number, legacyCode: patient.legacy_code }, body?.original === true);
  const form = rec.form as FormId;

  const pdf = buildCaseRecordPdf({
    form,
    caseNumber,
    childName: `${patient.last_name}, ${patient.first_name}`,
    ageSex: [patient.birth_date ? `${computeAge(patient.birth_date)} y/o` : "", patient.sex === "M" ? "Male" : patient.sex === "F" ? "Female" : ""].filter(Boolean).join(" / "),
    birthDate: patient.birth_date ?? undefined,
    address: patient.raw_address ?? undefined,
    diagnosis: (dx ?? []).map((d) => (d.diagnoses as { name?: string } | null)?.name).filter(Boolean).join(", ") || undefined,
    carerName: carer?.name ?? undefined,
    heldOn: rec.held_on,
    venue: rec.venue ?? undefined,
    data: rec.data ?? {},
    preparedBy: nameOf(rec.prepared_by),
    approvedBy: nameOf(rec.approved_by),
    approvedOn: String(rec.approved_at).slice(0, 10),
    ceoName: fullName(ceo) || undefined,
    ceoTitle: ceo?.position || undefined,
    header: settings?.report_header || undefined,
    accreditation: accreditationLine(settings),
  });
  const file = `${FORMS[form].title} - ${caseNumber}`.replace(/[^A-Za-z0-9 .-]/g, "");
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${file}.pdf"`, "Cache-Control": "no-store" },
  });
}
