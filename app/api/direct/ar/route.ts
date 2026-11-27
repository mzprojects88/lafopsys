import { NextResponse } from "next/server";
import { accreditationLine } from "@/lib/pdf/accreditation";
import { buildLafAr, type LafArLine } from "@/lib/pdf/laf-ar";
import { signatureImages } from "@/lib/signatures/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { arFileName, attachmentHeader } from "@/lib/utils/ar-file-name";

export const dynamic = "force-dynamic";

const ID = /^[A-Za-z0-9_-]{1,80}$/;

/**
 * The acknowledgement receipt of a donation for patients (LAF-DTP, Inventory 0082) as a PDF: the same document LAF
 * Inventory prints. Whether the caller may see that donation is asked of the database with their own session
 * (inventory.direct_donations); what the receipt prints is then read with the service role, because the social worker,
 * the office admin and the CEO don't read the stock tables. Values stay off the page, as on Inventory's default.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { donationId?: unknown } | null;
  const donationId = typeof body?.donationId === "string" && ID.test(body.donationId) ? body.donationId : null;
  if (!donationId) return NextResponse.json({ error: "Missing receipt." }, { status: 400 });

  const { data: seen, error: refused } = await supabase.schema("inventory").rpc("direct_donations", { p_id: donationId });
  if (refused) return NextResponse.json({ error: "You can't see donations for patients." }, { status: 403 });
  if (!Array.isArray(seen) || seen.length !== 1) return NextResponse.json({ error: "That donation was not found." }, { status: 404 });

  const admin = createAdminClient();
  const inv = admin.schema("inventory");
  const [{ data: receipt }, { data: lines }, { data: settings }] = await Promise.all([
    inv.from("donation_log").select("id, date, donor_id, ar_number, ar_kind, received_by, received_by_staff_id, notes, booklet_ar_number, direct_note").eq("id", donationId).eq("ar_kind", "dtp").maybeSingle(),
    inv.from("donation_lines").select("id, description, quantity, uom, value").eq("donation_id", donationId).order("created_at"),
    admin.schema("shared").from("app_settings").select("report_header, dswd_label, dswd_number").eq("id", true).maybeSingle(),
  ]);
  if (!receipt?.ar_number) return NextResponse.json({ error: "That donation was not found." }, { status: 404 });
  const [{ data: donor }, { data: receiver }] = await Promise.all([
    receipt.donor_id ? admin.schema("ops").from("donors").select("name").eq("id", receipt.donor_id).maybeSingle() : Promise.resolve({ data: null }),
    receipt.received_by_staff_id ? admin.schema("shared").from("staff").select("first_name, last_name, position").eq("id", receipt.received_by_staff_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  // The receiver's signature, only if they allowed it on these receipts; the use is logged.
  const sigs = await signatureImages("gik_receipt", [receipt.received_by_staff_id], receipt.ar_number, user.id);
  const arLines: LafArLine[] = (lines ?? []).map((l) => ({ id: l.id as string, name: l.description as string, quantity: Number(l.quantity), uom: (l.uom as string | null) ?? "", lineTotal: Number(l.value) }));
  const pdf = buildLafAr(
    {
      arNumber: receipt.ar_number,
      bookletArNumber: receipt.booklet_ar_number ?? undefined,
      kind: "dtp",
      date: receipt.date,
      donorName: donor?.name ?? "Anonymous donor",
      receivedBy: receiver ? `${receiver.first_name} ${receiver.last_name}` : (receipt.received_by ?? undefined),
      receivedByPosition: receiver?.position?.trim() || undefined,
      receivedBySignature: receiver && receipt.received_by_staff_id ? sigs.get(receipt.received_by_staff_id) : undefined,
      notes: receipt.notes ?? (receipt.direct_note ? `Donor's wish: ${receipt.direct_note}` : undefined),
      header: settings?.report_header || undefined,
      accreditation: accreditationLine(settings),
      lines: arLines,
    },
    { showValues: false }
  );
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": attachmentHeader(arFileName(donor?.name, receipt.ar_number)), "Cache-Control": "no-store" },
  });
}
