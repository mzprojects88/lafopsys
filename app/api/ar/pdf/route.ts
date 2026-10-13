import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildCashAr } from "@/lib/pdf/cash-ar";

/**
 * A cash acknowledgement receipt (0085) as a PDF, built on every download from the row the
 * database numbered. The caller must see Donors or Finance (RLS: the receipt row is read with
 * their session); the names it prints (donor, issuer, campaign, settings) are then read with
 * the service role so a finance viewer gets the same document as a donors editor.
 */
const UUID = /^[0-9a-f-]{36}$/i;

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { receiptId?: unknown } | null;
  const receiptId = typeof body?.receiptId === "string" && UUID.test(body.receiptId) ? body.receiptId : null;
  if (!receiptId) return NextResponse.json({ error: "Missing receipt" }, { status: 400 });

  // The session decides whether this person may see the receipt at all (module read / donor read-own).
  const { data: receipt } = await supabase
    .schema("ops")
    .from("acknowledgment_receipts")
    .select("id, donation_id, sequence_number, status, issued_by, booklet_number, amount, currency")
    .eq("id", receiptId)
    .maybeSingle();
  if (!receipt) return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  if (receipt.status === "draft") return NextResponse.json({ error: "This receipt was never issued" }, { status: 400 });

  const admin = createAdminClient();
  const { data: donation } = await admin
    .schema("ops")
    .from("donations")
    .select("date, donor_id, total_value, currency, payment_method, notes, campaign_id, donors:donor_id(name), campaigns:campaign_id(name)")
    .eq("id", receipt.donation_id)
    .maybeSingle();
  if (!donation) return NextResponse.json({ error: "Donation not found" }, { status: 404 });
  const [{ data: issuer }, { data: settings }] = await Promise.all([
    receipt.issued_by ? admin.schema("shared").from("staff").select("first_name, last_name, position").eq("id", receipt.issued_by).maybeSingle() : Promise.resolve({ data: null }),
    admin.schema("shared").from("app_settings").select("report_header").eq("id", true).maybeSingle(),
  ]);
  const donor = donation.donors as unknown as { name: string } | null;
  const campaign = donation.campaigns as unknown as { name: string } | null;

  const pdf = buildCashAr({
    arNumber: receipt.sequence_number,
    bookletNumber: receipt.booklet_number ?? undefined,
    date: donation.date,
    donorName: donor?.name ?? "Anonymous donor",
    amount: Number(receipt.amount ?? donation.total_value),
    currency: (receipt.currency ?? donation.currency) as "PHP" | "USD",
    paymentMethod: donation.payment_method ?? undefined,
    campaign: campaign?.name ?? undefined,
    notes: donation.notes ?? undefined,
    receivedBy: issuer ? `${issuer.first_name} ${issuer.last_name}` : undefined,
    receivedByPosition: issuer?.position?.trim() || undefined,
    header: settings?.report_header || undefined,
  });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${receipt.sequence_number}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
