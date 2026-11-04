import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildCaseFolderPdf, buildCasePeriodPdf, buildCaseRecordPdf, type CaseRecordPdfData } from "@/lib/pdf/case-record";
import { accreditationLine } from "@/lib/pdf/accreditation";
import { FORMS, caseNumberFor, folderOrder, folderStatus, periodRange, periodReportRows, type CasePeriodCounts, type DocumentKind, type FormId } from "@/lib/case-files/forms";
import { computeAge } from "@/lib/utils/age";

const UUID = /^[0-9a-f-]{36}$/i;
const fullName = (s: { first_name?: string | null; last_name?: string | null } | null | undefined) => `${s?.first_name ?? ""} ${s?.last_name ?? ""}`.trim();

/**
 * An approved case record (0124) as its paper form, for signing -- or, with `patientId`, the child's
 * whole case folder (phase 4): a cover with the DSWD checklist and contents, then every approved
 * record -- or, with `period` ("2026-10" or "2026"), the social worker's counts-only report. Read with the caller's own session: the database lets only the social worker, the Super
 * Admin and the CEO see case records, so nobody else gets a PDF. The case number is the app's LFCN
 * unless `original` asks for the paper folder's number.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { recordId?: unknown; patientId?: unknown; original?: unknown; period?: unknown } | null;
  if (typeof body?.period === "string") return periodReport(supabase, body.period, userData.user.id);
  const id = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v : null);
  const recordId = id(body?.recordId);
  const folderOf = id(body?.patientId);
  if (!recordId && !folderOf) return NextResponse.json({ error: "Choose a record." }, { status: 400 });

  const ops = supabase.schema("ops");
  const { data: recs } = recordId
    ? await ops.from("case_records").select("*").eq("id", recordId)
    : await ops.from("case_records").select("*").eq("patient_id", folderOf!).eq("status", "approved");
  const { data: docs } = folderOf ? await ops.from("case_documents").select("kind").eq("patient_id", folderOf) : { data: [] };
  if (!recs?.length)
    return NextResponse.json(
      { error: recordId ? "Only the social worker, the Super Admin and the CEO can open case records." : "No approved records yet: approve a record first." },
      { status: 404 },
    );
  if (recs.some((r) => r.status !== "approved")) return NextResponse.json({ error: "Approve the record first: only an approved record is printed for signing." }, { status: 422 });
  const patientId = recs[0].patient_id as string;

  const [{ data: patient }, { data: dx }, { data: carer }] = await Promise.all([
    ops.from("patients").select("first_name, last_name, birth_date, sex, raw_address, case_number, legacy_code").eq("id", patientId).maybeSingle(),
    ops.from("patient_diagnoses").select("diagnoses(name)").eq("patient_id", patientId),
    ops.from("carers").select("name").eq("patient_id", patientId).is("effective_to", null).limit(1).maybeSingle(),
  ]);
  if (!patient) return NextResponse.json({ error: "Patient not found" }, { status: 404 });

  // Names on the signature lines only: the preparers, the approvers and the CEO.
  const admin = createAdminClient();
  const [{ data: signers }, { data: ceo }, { data: settings }] = await Promise.all([
    admin.schema("shared").from("staff").select("id, first_name, last_name").in("id", [...new Set(recs.flatMap((r) => [r.prepared_by, r.approved_by]).filter(Boolean))]),
    admin.schema("shared").from("staff").select("first_name, last_name, position").eq("active", true).or("role.eq.ceo,extra_roles.cs.{ceo}").limit(1).maybeSingle(),
    admin.schema("shared").from("app_settings").select("report_header, dswd_label, dswd_number").eq("id", true).maybeSingle(),
  ]);
  const nameOf = (sid: string | null) => fullName(signers?.find((s) => s.id === sid));
  const caseNumber = caseNumberFor({ caseNumber: patient.case_number, legacyCode: patient.legacy_code }, body?.original === true);

  const pdfData = (rec: (typeof recs)[number]): CaseRecordPdfData => ({
    form: rec.form as FormId,
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

  let pdf: Buffer;
  let file: string;
  if (recordId) {
    pdf = buildCaseRecordPdf(pdfData(recs[0]));
    file = `${FORMS[recs[0].form as FormId].title} - ${caseNumber}`;
  } else {
    const ordered = folderOrder(recs.map((r) => ({ ...r, form: r.form as FormId, heldOn: r.held_on as string | null })));
    const kinds = (docs ?? []) as { kind: DocumentKind }[];
    pdf = buildCaseFolderPdf(ordered.map(pdfData), { checklist: folderStatus(ordered, kinds), uploads: kinds.length });
    file = `Case folder - ${caseNumber}`;
  }
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${file.replace(/[^A-Za-z0-9 .-]/g, "")}.pdf"`, "Cache-Control": "no-store" },
  });
}


async function periodReport(supabase: Awaited<ReturnType<typeof createClient>>, period: string, userId: string) {
  const range = periodRange(period);
  if (!range) return NextResponse.json({ error: "Choose a month or a year." }, { status: 400 });
  const { data, error } = await supabase.schema("ops").rpc("case_period_report", { p_from: range.from, p_to: range.to });
  if (error) return NextResponse.json({ error: "The report couldn't be made." }, { status: 500 });
  const admin = createAdminClient();
  const [{ data: me }, { data: ceo }, { data: settings }] = await Promise.all([
    admin.schema("shared").from("staff").select("first_name, last_name").eq("id", userId).maybeSingle(),
    admin.schema("shared").from("staff").select("first_name, last_name, position").eq("active", true).or("role.eq.ceo,extra_roles.cs.{ceo}").limit(1).maybeSingle(),
    admin.schema("shared").from("app_settings").select("report_header, dswd_label, dswd_number").eq("id", true).maybeSingle(),
  ]);
  const pdf = buildCasePeriodPdf({
    title: range.title,
    rows: periodReportRows(data as CasePeriodCounts),
    preparedBy: fullName(me),
    ceoName: fullName(ceo) || undefined,
    ceoTitle: ceo?.position || undefined,
    header: settings?.report_header || undefined,
    accreditation: accreditationLine(settings),
  });
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="Social worker report - ${period}.pdf"`, "Cache-Control": "no-store" },
  });
}
