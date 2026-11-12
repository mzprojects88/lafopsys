import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/app/(print)/hr/payslips/[id]/print/print-button";
import { createClient } from "@/lib/supabase/server";
import { SETTINGS_COLUMNS, orgFrom, ownSignatureLink, printedNow, sheetFor, siteOrigin } from "@/components/modules/requests/voucher-sheet";

/** A sample time, some hours ago. */
function at(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

/**
 * Preview the voucher (0149): the printed layout with made-up items and today's Settings › Documents, for the Super
 * Admin and Finance to check the letterhead, the certification and their own signature before a real voucher prints.
 * Nothing here is a record: the voucher, its lines and the other signers are samples.
 */
export default async function VoucherPreviewPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();
  const { data: me } = await supabase.schema("shared").from("staff").select("id, first_name, last_name, position, role, extra_roles").eq("id", user.id).maybeSingle();
  const roles = me ? [me.role, ...((me.extra_roles as string[] | null) ?? [])] : [];
  if (!roles.some((r) => ["admin", "finance", "office_admin"].includes(r))) notFound();
  const { data: settings } = await supabase.schema("shared").from("app_settings").select(SETTINGS_COLUMNS).maybeSingle();
  const sample = { id: "sample-a", first_name: "Sample", last_name: "Signer", position: "Position" };
  const sheet = sheetFor(
    {
      id: "sample", kind: "supplier", fund_id: null, voucher_type: "PV", voucher_number: "PV-2026-0000", request_number: "PR-2026-0000", status: "released", released_at: at(1),
      payee_text: "Sample Supplier, Inc.", purpose: "Sample: meals for staff during the accreditation meeting", pay_method: "check", pay_reference: "Check 000000",
      t2_id: null, total: 2300, ewt_total: 23, urgent: false, submitted_at: at(30), created_at: at(30),
    },
    {
      lines: [
        { id: "l1", description: "Sample item", qty: 25, unit_cost: 40, amount: 1000, or_number: "62240", account_id: null, legacy_code: "5932", t1_id: null, t3_id: null, ewt_atc: "WC158", ewt_rate: 1 },
        { id: "l2", description: "Another sample item", qty: 10, unit_cost: 130, amount: 1300, or_number: "62240", account_id: null, legacy_code: "5932", t1_id: null, t3_id: null, ewt_atc: "WC158", ewt_rate: 1 },
      ],
      events: [
        { action: "submit", actor: sample.id, signer_text: null, at: at(30) },
        { action: "skip_endorse", actor: null, signer_text: null, at: at(29) },
        { action: "prepare", actor: user.id, signer_text: null, at: at(26) },
        { action: "review", actor: sample.id, signer_text: null, at: at(20) },
        { action: "approve", actor: sample.id, signer_text: null, at: at(10) },
        { action: "prepare_payment", actor: sample.id, signer_text: null, at: at(6) },
        { action: "approve_payment", actor: sample.id, signer_text: null, at: at(4) },
        { action: "release", actor: sample.id, signer_text: null, at: at(1) },
      ],
      people: [sample, me],
      codes: [], accounts: [], payees: [],
      files: [{ kind: "receipt", file_name: "sample-receipt.jpg" }],
      // Your own signature on "Prepared by", to see how it prints; the others are samples.
      signatures: await ownSignatureLink(),
      org: orgFrom(settings),
      link: `${await siteOrigin()}/requests/…`,
      printedAt: printedNow(),
      place: "Sample",
    },
  );
  return (
    <div className="mx-auto max-w-3xl p-6 text-sm text-neutral-900 print:max-w-none print:p-0">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href="/settings" className="text-xs underline">Back to Settings</Link>
        <span className="text-xs text-neutral-600">A sample: made-up items, your signature on &quot;Prepared by&quot;</span>
        <PrintButton />
      </div>
      {sheet}
    </div>
  );
}
