import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "@/app/(print)/hr/payslips/[id]/print/print-button";
import { dayKey } from "@/lib/utils/dtr";
import { quarterOf, SPENDING } from "@/lib/utils/vouchers";

const peso = (n: number) => n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** 123456789 / 123456789000 as the BIR writes it: 123-456-789(-000). */
const tin = (t: string | null) => (t ? t.replace(/^(\d{3})(\d{3})(\d{3})(\d*)$/, (_, a, b, c, d) => [a, b, c, d].filter(Boolean).join("-")) : "—");

/**
 * The details for one payee's BIR Form 2307 in a quarter (0138): payer and payee, and per ATC the income paid and
 * the tax withheld in each month of the quarter, from the vouchers Finance prepared. Finance copies them onto the
 * official form; this sheet is not the form. Read under the caller's RLS.
 */
export default async function Form2307Page({ searchParams }: { searchParams: Promise<{ payee?: string; q?: string }> }) {
  const { payee: payeeId, q } = await searchParams;
  if (!payeeId || !/^[0-9a-f-]{36}$/i.test(payeeId) || !q || !/^\d{4}-Q[1-4]$/.test(q)) notFound();
  const year = Number(q.slice(0, 4));
  const first = (Number(q.slice(-1)) - 1) * 3 + 1;
  const supabase = await createClient();
  const [{ data: payee }, { data: settings }, { data: vouchers }] = await Promise.all([
    supabase.schema("ops").from("payees").select("name, tin, address").eq("id", payeeId).maybeSingle(),
    supabase.schema("ops").from("finance_settings").select("payer_name, payer_tin, payer_address").maybeSingle(),
    supabase.schema("ops").from("vouchers").select("id, voucher_number, submitted_at, created_at").eq("payee_id", payeeId).gt("ewt_total", 0).in("status", [...SPENDING]),
  ]);
  if (!payee) notFound();
  const ids = (vouchers ?? []).map((v) => v.id);
  const [{ data: lines }, { data: prepares }] = ids.length
    ? await Promise.all([
        supabase.schema("ops").from("voucher_lines").select("voucher_id, amount, ewt_atc, ewt_rate, ewt_amount").in("voucher_id", ids).gt("ewt_amount", 0),
        supabase.schema("ops").from("voucher_events").select("voucher_id, at").eq("action", "prepare").in("voucher_id", ids),
      ])
    : [{ data: [] }, { data: [] }];
  // Each voucher's month: the Manila day Finance prepared it (as on the Funds page).
  const monthOf = new Map(
    (vouchers ?? []).map((v) => {
      const day = dayKey((prepares ?? []).filter((e) => e.voucher_id === v.id).map((e) => e.at).sort().at(-1) ?? v.submitted_at ?? v.created_at);
      return [v.id, quarterOf(day).key === q ? Number(day.slice(5, 7)) - first : -1];
    })
  );
  const byAtc = new Map<string, { rate: number; base: number[]; tax: number[] }>();
  for (const l of lines ?? []) {
    const m = monthOf.get(l.voucher_id) ?? -1;
    if (m < 0) continue;
    const r = byAtc.get(l.ewt_atc) ?? { rate: Number(l.ewt_rate), base: [0, 0, 0], tax: [0, 0, 0] };
    r.base[m] += Number(l.amount);
    r.tax[m] += Number(l.ewt_amount);
    byAtc.set(l.ewt_atc, r);
  }
  const total = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
  const rows = [...byAtc.entries()].sort(([a], [b]) => a.localeCompare(b));
  const { from, to } = quarterOf(`${year}-${String(first).padStart(2, "0")}-01`);

  return (
    <div className="mx-auto max-w-3xl p-6 text-sm text-neutral-900 print:max-w-none print:p-0">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href="/finance/funds" className="text-xs underline">Back to Funds & advances</Link>
        <PrintButton />
      </div>
      <div className="rounded-xl border border-neutral-300 p-8 print:rounded-none print:border-0 print:p-0">
        <header className="border-b border-neutral-300 pb-3">
          <h1 className="text-lg font-semibold">Details for BIR Form 2307</h1>
          <p className="text-xs text-neutral-600">Certificate of Creditable Tax Withheld at Source · for the period {from} to {to}. Copy these onto the official form; this sheet is not the form.</p>
        </header>
        <section className="mt-4 grid grid-cols-2 gap-6 text-xs">
          <div>
            <h2 className="font-semibold">Payee</h2>
            <p>{payee.name}</p>
            <p>TIN {tin(payee.tin)}</p>
            <p className="text-neutral-600">{payee.address ?? "No address on file"}</p>
          </div>
          <div>
            <h2 className="font-semibold">Payor</h2>
            <p>{settings?.payer_name ?? "Set the payer in Financial Settings › General"}</p>
            <p>TIN {tin(settings?.payer_tin ?? null)}</p>
            <p className="text-neutral-600">{settings?.payer_address ?? ""}</p>
          </div>
        </section>
        <table className="mt-6 w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-neutral-400 text-left text-neutral-600">
              <th className="py-2 pr-2">ATC</th>
              {[0, 1, 2].map((m) => <th key={m} className="py-2 pr-2 text-right">{MONTHS[first - 1 + m]}</th>)}
              <th className="py-2 pr-2 text-right">Total income</th>
              <th className="py-2 text-right">Tax withheld</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([atc, r]) => (
              <tr key={atc} className="border-b border-neutral-200">
                <td className="py-2 pr-2">{atc} ({r.rate}%)</td>
                {r.base.map((b, m) => <td key={m} className="py-2 pr-2 text-right tabular-nums">{peso(b)}</td>)}
                <td className="py-2 pr-2 text-right tabular-nums">{peso(total(r.base))}</td>
                <td className="py-2 text-right tabular-nums">{peso(total(r.tax))}</td>
              </tr>
            ))}
            {rows.length === 0 ? <tr><td colSpan={6} className="py-4 text-center text-neutral-500">Nothing withheld from this payee in {q.replace("-", " ")}.</td></tr> : null}
            <tr>
              <td colSpan={4} className="py-2 pr-2 text-right font-semibold">Total</td>
              <td className="py-2 pr-2 text-right font-semibold tabular-nums">{peso(total(rows.flatMap(([, r]) => r.base)))}</td>
              <td className="py-2 text-right font-semibold tabular-nums">{peso(total(rows.flatMap(([, r]) => r.tax)))}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-6 text-xs text-neutral-500">Vouchers: {(vouchers ?? []).filter((v) => (monthOf.get(v.id) ?? -1) >= 0).map((v) => v.voucher_number).join(", ") || "none"}.</p>
      </div>
    </div>
  );
}
