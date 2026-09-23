import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dayKey } from "@/lib/utils/dtr";
import { COPY_FORMULA_COLUMNS, COPY_HEADER, copyOrder, copyRow, type CopyRecord } from "@/lib/utils/master-sheet";

export const dynamic = "force-dynamic";

/**
 * Master Plan step 3: every child as the app holds them, in the Patients
 * Database's columns, for the script inside LAF's copy of the sheet
 * (scripts/apps-script/laf-copy-sync.gs) to write in every 5 minutes.
 *
 * Children's personal data: answers only to the SHEET_EXPORT_SECRET key,
 * which lives on Vercel and in the copy's Script Properties, nowhere else.
 * Exempt from the auth middleware for that reason (no session).
 */
export async function GET(request: Request) {
  const expected = process.env.SHEET_EXPORT_SECRET;
  if (!expected) return NextResponse.json({ ok: false, error: "The export is not set up on the server." }, { status: 503 });
  const given = Buffer.from(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });

  const ops = createAdminClient().schema("ops");
  const [patientsQ, carersQ, dxLinksQ, diagnosesQ, provincesQ, phasesQ] = await Promise.all([
    ops.from("patients").select("*"),
    ops.from("carers").select("patient_id, name, relationship, mobile_number, effective_from").is("effective_to", null).order("effective_from"),
    ops.from("patient_diagnoses").select("patient_id, diagnosis_id"),
    ops.from("diagnoses").select("id, name"),
    ops.from("provinces").select("id, name, region"),
    ops.from("treatment_phases").select("id, name"),
  ]);
  const failed = [patientsQ, carersQ, dxLinksQ, diagnosesQ, provincesQ, phasesQ].find((q) => q.error);
  if (failed?.error) return NextResponse.json({ ok: false, error: failed.error.message }, { status: 500 });

  type P = {
    id: string; patient_number: string | null; case_number: string | null; admitted_at: string; first_name: string; last_name: string;
    birth_date: string | null; sex: string | null; raw_address: string | null; province_id: string | null; status: string;
    illness_code: string | null; treatment_phase_id: string | null; marital_status: string | null; priority: string | null;
    remarks: string | null; legacy_code: string | null; updated_at: string; sheet_row: Record<string, string> | null;
  };
  type C = { patient_id: string; name: string; relationship: string | null; mobile_number: string | null };
  const names = (rows: { id: string; name: string }[] | null) => new Map((rows ?? []).map((r) => [r.id, r.name]));
  const dxName = names(diagnosesQ.data);
  const phaseName = names(phasesQ.data);
  const province = new Map(((provincesQ.data ?? []) as { id: string; name: string; region: string | null }[]).map((p) => [p.id, p]));
  const dxOf = new Map<string, string>();
  for (const l of (dxLinksQ.data ?? []) as { patient_id: string; diagnosis_id: string }[]) if (!dxOf.has(l.patient_id)) dxOf.set(l.patient_id, l.diagnosis_id);
  const carersOf = new Map<string, C[]>();
  for (const c of (carersQ.data ?? []) as C[]) carersOf.set(c.patient_id, [...(carersOf.get(c.patient_id) ?? []), c]);

  const manila = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", month: "numeric", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  const records: CopyRecord[] = ((patientsQ.data ?? []) as P[]).map((p) => {
    const carers = carersOf.get(p.id) ?? [];
    // The carer the original names, else the longest-standing current one.
    const sheetCarer = p.sheet_row?.CARER?.trim().toLowerCase();
    const carer = carers.find((c) => c.name.trim().toLowerCase() === sheetCarer) ?? carers[0];
    const prov = p.province_id ? province.get(p.province_id) : undefined;
    return {
      cn: p.patient_number,
      caseNumber: p.case_number,
      admittedOn: p.admitted_at,
      firstName: p.first_name,
      lastName: p.last_name,
      birthDate: p.birth_date,
      sex: p.sex,
      address: p.raw_address,
      province: prov?.name ?? null,
      region: prov?.region ?? null,
      status: p.status,
      illnessCode: p.illness_code,
      diagnosis: dxOf.has(p.id) ? (dxName.get(dxOf.get(p.id)!) ?? null) : null,
      phase: p.treatment_phase_id ? (phaseName.get(p.treatment_phase_id) ?? null) : null,
      carerName: carer?.name ?? null,
      carerRelationship: carer?.relationship ?? null,
      carerPhone: carer?.mobile_number ?? null,
      maritalStatus: p.marital_status,
      priority: p.priority,
      remarks: p.remarks,
      legacyCode: p.legacy_code,
      lastUpdated: manila.format(new Date(p.updated_at)).replace(",", ""),
      sheetRow: p.sheet_row,
    };
  });
  records.sort(copyOrder);
  const today = dayKey(new Date());

  return NextResponse.json(
    { ok: true, generatedAt: new Date().toISOString(), header: COPY_HEADER, skip: COPY_FORMULA_COLUMNS, rows: records.map((r) => copyRow(r, today)) },
    { headers: { "cache-control": "no-store" } }
  );
}
