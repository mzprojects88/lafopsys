import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildCafPackage, type CafChild } from "@/lib/pdf/caf";
import { ageOn, cafMonthLabel } from "@/lib/utils/caf";
import { todayIso } from "@/lib/utils/date";

/**
 * NCH Cancer Assistance Fund billing package (0098) as a PDF: the whole month, or one child's
 * Statement of Account and Endorsement Letter. The bill and its lines are read with the caller's
 * session -- only holders of "Prepares NCH billing" or "Sees NCH billing" get any rows -- and only
 * then are the children's names, birth dates and diagnoses read with the service role.
 */
const UUID = /^[0-9a-f-]{36}$/i;

interface CafSettings {
  rate?: number;
  program?: string;
  payer_name?: string;
  payer_address?: string;
  bank_name?: string;
  bank_account_name?: string;
  bank_account_no?: string;
  bank_account_type?: string;
  prepared_by?: string | null;
  approved_by?: string | null;
  nch_letterhead?: string[];
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { billingId?: unknown; patientId?: unknown } | null;
  const billingId = typeof body?.billingId === "string" && UUID.test(body.billingId) ? body.billingId : null;
  const patientId = typeof body?.patientId === "string" && UUID.test(body.patientId) ? body.patientId : null;
  if (!billingId) return NextResponse.json({ error: "Missing bill" }, { status: 400 });

  const { data: bill } = await supabase.schema("ops").from("caf_billings").select("id, month, status, rate, cap, discount_pct, invoice_date").eq("id", billingId).maybeSingle();
  if (!bill) return NextResponse.json({ error: "Bill not found" }, { status: 404 });
  let linesQuery = supabase.schema("ops").from("caf_billing_lines").select("patient_id, nights, pwd").eq("billing_id", billingId);
  if (patientId) linesQuery = linesQuery.eq("patient_id", patientId);
  const { data: lines } = await linesQuery;
  if (!lines?.length) return NextResponse.json({ error: "No child on this bill" }, { status: 404 });

  const admin = createAdminClient();
  const [{ data: patients }, { data: settings }] = await Promise.all([
    admin
      .schema("ops")
      .from("patients")
      .select("id, first_name, last_name, birth_date, illness_type, patient_diagnoses(diagnoses(name))")
      .in("id", lines.map((l) => l.patient_id)),
    admin.schema("shared").from("app_settings").select("caf, report_header, org_address").eq("id", true).maybeSingle(),
  ]);
  const caf = (settings?.caf ?? {}) as CafSettings;
  const signerIds = [caf.prepared_by, caf.approved_by].filter((id): id is string => !!id && UUID.test(id));
  const { data: signers } = signerIds.length
    ? await admin.schema("shared").from("staff").select("id, first_name, last_name, position").in("id", signerIds)
    : { data: [] as { id: string; first_name: string; last_name: string; position: string | null }[] };
  const signer = (id?: string | null) => {
    const s = (signers ?? []).find((x) => x.id === id);
    return s ? { name: `${s.first_name} ${s.last_name}`, title: s.position ? `LAF, ${s.position}` : undefined } : undefined;
  };

  const invoiceDate = bill.invoice_date ?? todayIso();
  const children: CafChild[] = lines
    .map((l) => {
      const p = (patients ?? []).find((x) => x.id === l.patient_id);
      const diagnoses = ((p?.patient_diagnoses ?? []) as unknown as { diagnoses: { name: string } | null }[]).map((d) => d.diagnoses?.name).filter(Boolean);
      return {
        name: p ? `${p.last_name}, ${p.first_name}` : "Unknown patient",
        age: ageOn(p?.birth_date ?? null, invoiceDate),
        diagnosis: diagnoses[0] ?? p?.illness_type ?? "",
        nights: (l.nights as string[]) ?? [],
        pwd: l.pwd,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const pdf = buildCafPackage({
    month: bill.month,
    invoiceDate,
    terms: { rate: Number(bill.rate), cap: bill.cap, discountPct: Number(bill.discount_pct) },
    children,
    program: caf.program ?? "Transient House Cancer Assistance Fund",
    payerName: caf.payer_name ?? "NATIONAL CHILDREN'S HOSPITAL",
    payerAddress: caf.payer_address ?? "",
    bank: { name: caf.bank_name ?? "", accountName: caf.bank_account_name ?? "", accountNo: caf.bank_account_no ?? "", accountType: caf.bank_account_type ?? "Savings" },
    preparedBy: signer(caf.prepared_by),
    approvedBy: signer(caf.approved_by),
    nchLetterhead: caf.nch_letterhead ?? [],
    header: settings?.report_header || undefined,
    orgAddress: settings?.org_address || undefined,
    onlyChild: !!patientId,
    draft: bill.status === "draft",
  });

  const name = `NCH-CAF-${cafMonthLabel(bill.month).replace(" ", "-")}${patientId ? `-${children[0]?.name.split(",")[0]}` : ""}${bill.status === "draft" ? "-DRAFT" : ""}.pdf`;
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${name.replace(/[^A-Za-z0-9.-]/g, "")}"`,
      "Cache-Control": "no-store",
    },
  });
}
