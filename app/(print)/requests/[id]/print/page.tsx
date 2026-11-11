import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "@/app/(print)/hr/payslips/[id]/print/print-button";
import { KIND_LABEL, PAY_LABEL, STATUS_LABEL, type VoucherKind, type VoucherStatus } from "@/lib/utils/vouchers";

const TITLE: Record<string, string> = { PV: "Payment Voucher", PCV: "Petty Cash Voucher", GCV: "GCash Fund Voucher", JV: "Journal Voucher (liquidation)" };
const SIGNS = [
  { action: "submit", label: "Requested by" },
  { action: "endorse", label: "Endorsed by" },
  { action: "prepare", label: "Prepared by" },
  { action: "review", label: "Reviewed by" },
  { action: "approve", label: "Approved by" },
];
const peso = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** Manila time whatever the server's clock zone (12-hour, as every time in the apps). */
const manila = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

/**
 * A payment request or voucher on paper (0134): its number, the items with their coding, and each signature from
 * its history (latest round). Read under the caller's RLS, so only someone who can see it prints it.
 */
export default async function RequestPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: v } = await supabase.schema("ops").from("vouchers").select("*").eq("id", id).maybeSingle();
  if (!v) notFound();
  const [{ data: lines }, { data: events }, { data: codes }, { data: accounts }, { data: payees }] = await Promise.all([
    supabase.schema("ops").from("voucher_lines").select("*").eq("voucher_id", id).order("sort"),
    supabase.schema("ops").from("voucher_events").select("action, actor, signer_text, at").eq("voucher_id", id).order("at"),
    supabase.schema("ops").from("fin_codes").select("id, code, name"),
    supabase.schema("ops").from("coa_accounts").select("id, code, name"),
    supabase.schema("ops").rpc("payee_choices"),
  ]);
  const evs = (events ?? []) as { action: string; actor: string | null; signer_text: string | null; at: string }[];
  const start = evs.map((e) => e.action).lastIndexOf("submit");
  // A voucher from the registers has no submit: its signatures are the register's.
  const round = start < 0 ? evs : evs.slice(start);
  const actorIds = [...new Set([v.requested_by, ...round.map((e) => e.actor)].filter(Boolean))] as string[];
  const { data: people } = actorIds.length ? await supabase.schema("shared").from("staff").select("id, first_name, last_name").in("id", actorIds) : { data: [] };
  const person = (sid: string | null) => {
    const p = (people ?? []).find((x) => x.id === sid);
    return p ? `${p.first_name} ${p.last_name}` : "";
  };
  const code = (cid: string | null) => (codes ?? []).find((c) => c.id === cid)?.code ?? "";
  const account = (aid: string | null) => (accounts ?? []).find((a) => a.id === aid);
  const payee = v.payee_id ? ((payees ?? []) as { id: string; name: string }[]).find((p) => p.id === v.payee_id)?.name : null;
  const items = (lines ?? []) as { id: string; description: string; qty: number; unit_cost: number; amount: number; or_number: string | null; account_id: string | null; t1_id: string | null; t3_id: string | null; legacy_code: string | null; ewt_atc: string | null; ewt_rate: number | null }[];
  const ewt = Number(v.ewt_total ?? 0);
  const atcs = [...new Set(items.filter((l) => l.ewt_atc).map((l) => `${l.ewt_atc} ${Number(l.ewt_rate)}%`))].join(", ");

  return (
    <div className="mx-auto max-w-3xl p-6 text-sm text-neutral-900 print:max-w-none print:p-0">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href={`/requests/${id}`} className="text-xs underline">Back to the request</Link>
        <PrintButton />
      </div>
      <div className="rounded-xl border border-neutral-300 p-8 print:rounded-none print:border-0 print:p-0">
        <header className="flex items-start justify-between gap-4 border-b border-neutral-300 pb-4">
          <div className="flex items-center gap-3">
            <Image src="/logo/laf-mark.png" alt="" width={48} height={51} />
            <div>
              <h1 className="text-lg font-semibold">{v.voucher_type ? TITLE[v.voucher_type] : "Payment Request"}</h1>
              <p className="text-xs text-neutral-600">Little Ark Foundation, Inc.</p>
            </div>
          </div>
          <div className="text-right text-xs text-neutral-700">
            <p className="text-base font-semibold text-neutral-900">{v.voucher_number ?? v.legacy_number ?? v.request_number}</p>
            {v.voucher_number && v.request_number ? <p>Request {v.request_number}</p> : null}
            <p>{STATUS_LABEL[v.status as VoucherStatus]}{v.urgent ? " · Urgent" : ""}</p>
          </div>
        </header>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
          <div><dt className="text-neutral-500">Pay to</dt><dd className="font-medium">{v.to_person ? v.recipient_name : (payee ?? v.payee_text ?? person(v.requested_by))}</dd></div>
          <div><dt className="text-neutral-500">Kind</dt><dd>{KIND_LABEL[v.kind as VoucherKind]} · {PAY_LABEL[v.pay_method]}</dd></div>
          <div className="col-span-2"><dt className="text-neutral-500">For</dt><dd>{v.purpose}</dd></div>
          <div><dt className="text-neutral-500">Fund (T2)</dt><dd>{code(v.t2_id) || "—"}</dd></div>
          <div><dt className="text-neutral-500">Employee (T4)</dt><dd>{v.t4_code ?? "—"}</dd></div>
        </dl>
        <table className="mt-4 w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-neutral-400 text-left text-neutral-600">
              <th className="py-2 pr-2">Particulars</th>
              <th className="py-2 pr-2">OR / invoice</th>
              <th className="py-2 pr-2">Account</th>
              <th className="py-2 pr-2">Class</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((l) => (
              <tr key={l.id} className="border-b border-neutral-200">
                <td className="py-2 pr-2">{l.description}<span className="block text-neutral-500">{Number(l.qty)} × {peso(Number(l.unit_cost))}</span></td>
                <td className="py-2 pr-2">{l.or_number ?? ""}</td>
                <td className="py-2 pr-2">{[account(l.account_id)?.code ?? l.legacy_code, account(l.account_id)?.name].filter(Boolean).join(" ")}</td>
                <td className="py-2 pr-2">{[code(l.t1_id), code(l.t3_id)].filter(Boolean).join(":")}</td>
                <td className="py-2 text-right tabular-nums">{peso(Number(l.amount))}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={4} className="py-2 text-right font-semibold">Total</td>
              <td className="py-2 text-right font-semibold tabular-nums">{peso(Number(v.total))}</td>
            </tr>
            {ewt > 0 ? (
              <>
                <tr>
                  <td colSpan={4} className="py-1 text-right text-neutral-600">Less tax withheld ({atcs})</td>
                  <td className="py-1 text-right tabular-nums">({peso(ewt)})</td>
                </tr>
                <tr>
                  <td colSpan={4} className="py-1 text-right font-semibold">Net to pay</td>
                  <td className="py-1 text-right font-semibold tabular-nums">{peso(Number(v.total) - ewt)}</td>
                </tr>
              </>
            ) : null}
          </tbody>
        </table>
        <section className="mt-8 grid grid-cols-2 gap-6 text-xs sm:grid-cols-3 print:grid-cols-3">
          {SIGNS.map((s) => {
            const e = round.find((x) => x.action === s.action || (s.action === "endorse" && x.action === "skip_endorse"));
            return (
              <div key={s.action}>
                <div className="h-8 border-b border-neutral-400" />
                <p className="mt-1 font-medium">{e?.action === "skip_endorse" ? "Not needed" : e ? person(e.actor) || e.signer_text : ""}</p>
                <p className="text-neutral-500">{s.label}{e ? ` · ${manila(e.at)}` : ""}</p>
              </div>
            );
          })}
          <div>
            <div className="h-8 border-b border-neutral-400" />
            <p className="mt-1 font-medium">&nbsp;</p>
            <p className="text-neutral-500">Received by · date</p>
          </div>
        </section>
      </div>
    </div>
  );
}
