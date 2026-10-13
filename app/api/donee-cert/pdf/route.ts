import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildDoneeCert, type DoneeCertLine } from "@/lib/pdf/donee-cert";

/**
 * A certificate of donation (BIR Form 2322, 0085) as a PDF. The caller's session must be able
 * to read the certificate row (module read / donor read-own); the rest is read with the
 * service role: the gift, the donor's address and TIN, the signatory's name and position, and,
 * for a gift in kind, the receipt lines LAF Inventory recorded (ops.donations.source_id is that
 * receipt's id).
 */
const UUID = /^[0-9a-f-]{36}$/i;

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { certificateId?: unknown } | null;
  const certificateId = typeof body?.certificateId === "string" && UUID.test(body.certificateId) ? body.certificateId : null;
  if (!certificateId) return NextResponse.json({ error: "Missing certificate" }, { status: 400 });

  const { data: cert } = await supabase
    .schema("ops")
    .from("donee_certificates")
    .select("id, donation_id, control_number, status, kind, amount, description, signatory_id")
    .eq("id", certificateId)
    .maybeSingle();
  if (!cert) return NextResponse.json({ error: "Certificate not found" }, { status: 404 });

  const admin = createAdminClient();
  const { data: donation } = await admin
    .schema("ops")
    .from("donations")
    .select("date, kind, total_value, currency, item_description, quantity, source_id, invoice_number, donors:donor_id(name, address, tin)")
    .eq("id", cert.donation_id)
    .maybeSingle();
  if (!donation) return NextResponse.json({ error: "Donation not found" }, { status: 404 });
  const donor = donation.donors as unknown as { name: string; address: string | null; tin: string | null } | null;

  const [{ data: settings }, { data: ar }, { data: invLines }, { data: invReceipt }] = await Promise.all([
    admin.schema("shared").from("app_settings").select("report_header, org_address, org_tin, certificate_signatory_id").eq("id", true).maybeSingle(),
    admin.schema("ops").from("acknowledgment_receipts").select("sequence_number").eq("donation_id", cert.donation_id).maybeSingle(),
    donation.kind === "in_kind" && donation.source_id
      ? admin.schema("inventory").from("donation_lines").select("description, quantity, uom, value").eq("donation_id", donation.source_id).order("created_at")
      : Promise.resolve({ data: null }),
    donation.kind === "in_kind" && donation.source_id ? admin.schema("inventory").from("donation_log").select("ar_number").eq("id", donation.source_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const signatoryId = cert.signatory_id ?? settings?.certificate_signatory_id ?? null;
  const { data: signatory } = signatoryId ? await admin.schema("shared").from("staff").select("first_name, last_name, position").eq("id", signatoryId).maybeSingle() : { data: null };

  const lines: DoneeCertLine[] = (invLines ?? []).map((l) => ({ name: l.description, quantity: Number(l.quantity), uom: l.uom ?? "", value: Number(l.value) }));
  if (donation.kind === "in_kind" && lines.length === 0) {
    lines.push({ name: donation.item_description || "Donated items", quantity: Number(donation.quantity ?? 1), uom: "", value: Number(donation.total_value) });
  }

  const pdf = buildDoneeCert({
    controlNumber: cert.control_number,
    date: donation.date,
    kind: (cert.kind ?? donation.kind) as "cash" | "in_kind",
    amount: Number(cert.amount ?? donation.total_value),
    currency: donation.currency as "PHP" | "USD",
    donorName: donor?.name ?? "Anonymous donor",
    donorAddress: donor?.address ?? undefined,
    donorTin: donor?.tin ?? undefined,
    receiptNumber: ar?.sequence_number ?? invReceipt?.ar_number ?? donation.invoice_number ?? undefined,
    lines,
    orgAddress: settings?.org_address || undefined,
    orgTin: settings?.org_tin || undefined,
    header: settings?.report_header || undefined,
    signatoryName: signatory ? `${signatory.first_name} ${signatory.last_name}` : undefined,
    signatoryPosition: signatory?.position?.trim() || undefined,
  });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${cert.control_number}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
