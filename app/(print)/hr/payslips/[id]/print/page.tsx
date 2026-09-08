import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils/date";
import { formatAmount2 } from "@/lib/utils/money";
import { payPeriodLabel } from "@/lib/utils/pay-period";
import type { PayLine } from "@/lib/utils/payroll";
import { PrintButton } from "./print-button";

interface PayslipRow {
  id: string;
  employee_id: string;
  period_id: string | null;
  pay_date: string;
  pay_basis: "monthly" | "daily";
  lines: PayLine[];
  gross: string;
  total_deductions: string;
  net: string;
  taxable_gross: string;
  non_taxable: string;
  employer_total: string;
  acknowledged_at: string | null;
  paid_reference: string | null;
  ytd: Record<string, number>;
}

const num = (s: string | number) => Number(s);

/**
 * A payslip to print or save as PDF from the browser (Labor Code Art. 103
 * and DOLE LA 11-14: every worker gets a written statement of pay each
 * period; electronic counts). A Server Component under the caller's own
 * RLS: an employee reaches only their own, and only once the run is
 * approved; HR reaches all. Outside the app shell so nothing but the
 * payslip prints.
 */
export default async function PayslipPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: slip } = await supabase.schema("hr").from("payslips").select("*").eq("id", id).maybeSingle();
  if (!slip) notFound();
  const p = slip as unknown as PayslipRow;
  const [{ data: employee }, { data: period }] = await Promise.all([
    supabase.schema("hr").from("employees").select("employee_code, first_name, last_name, suffix, position, department").eq("id", p.employee_id).maybeSingle(),
    p.period_id ? supabase.schema("hr").from("pay_periods").select("year, seq, starts_on, ends_on").eq("id", p.period_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const earnings = p.lines.filter((l) => l.kind === "earning");
  const deductions = p.lines.filter((l) => l.kind === "deduction");
  const employer = p.lines.filter((l) => l.kind === "employer");
  const info = p.lines.filter((l) => l.kind === "info");
  const name = employee ? `${employee.first_name} ${employee.last_name}${employee.suffix ? ` ${employee.suffix}` : ""}` : "—";
  const periodLabel = period ? payPeriodLabel({ year: period.year, seq: period.seq, from: period.starts_on, to: period.ends_on, isSecondCutoff: period.seq % 2 === 0 }) : formatDate(p.pay_date, "MMMM yyyy");

  return (
    <div className="mx-auto max-w-2xl p-6 text-sm text-neutral-900 print:max-w-none print:p-0">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href="/hr/payslips" className="text-xs underline">
          Back to payslips
        </Link>
        <PrintButton />
      </div>
      <div className="rounded-xl border border-neutral-300 p-6 print:rounded-none print:border-0 print:p-0">
        <header className="flex items-start justify-between gap-4 border-b border-neutral-300 pb-4">
          <div className="flex items-center gap-3">
            <Image src="/logo/laf-mark.png" alt="" width={48} height={51} />
            <div>
              <div className="text-base font-semibold">Little Ark Foundation</div>
              <div className="text-xs text-neutral-600">Payslip</div>
            </div>
          </div>
          <div className="text-right text-xs">
            <div className="font-medium">{periodLabel}</div>
            <div>Pay date {formatDate(p.pay_date)}</div>
            {p.paid_reference ? <div>Ref. {p.paid_reference}</div> : null}
          </div>
        </header>

        <section className="grid grid-cols-2 gap-x-6 gap-y-1 py-4 text-xs">
          <div>
            <span className="text-neutral-500">Employee</span> <span className="font-medium">{name}</span>
          </div>
          <div>
            <span className="text-neutral-500">Employee ID</span> {employee?.employee_code ?? "—"}
          </div>
          <div>
            <span className="text-neutral-500">Position</span> {employee?.position ?? "—"}
          </div>
          <div>
            <span className="text-neutral-500">Pay basis</span> {p.pay_basis === "daily" ? "Daily rate" : "Monthly"}
          </div>
        </section>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 print:grid-cols-2">
          <Lines title="Earnings" lines={earnings} total={num(p.gross)} totalLabel="Gross pay" />
          <Lines title="Deductions" lines={deductions} total={num(p.total_deductions)} totalLabel="Total deductions" />
        </div>

        <div className="mt-6 flex items-center justify-between rounded-lg bg-neutral-100 px-4 py-3 print:border print:border-neutral-400 print:bg-transparent">
          <span className="font-semibold">Net pay</span>
          <span className="text-lg font-bold tabular-nums">₱{formatAmount2(Math.round(num(p.net) * 100))}</span>
        </div>

        {info.length > 0 ? (
          <ul className="mt-3 text-xs text-neutral-600">
            {info.map((l, i) => (
              <li key={i}>
                {l.label}
                {l.amount !== 0 ? `: ${l.amount < 0 ? "-" : ""}₱${formatAmount2(Math.abs(l.amount))}` : ""}
              </li>
            ))}
          </ul>
        ) : null}

        <section className="mt-6 grid grid-cols-2 gap-x-6 gap-y-1 border-t border-neutral-300 pt-4 text-xs text-neutral-600">
          <div>Taxable compensation this period: ₱{formatAmount2(Math.round(num(p.taxable_gross) * 100))}</div>
          <div>Non-taxable: ₱{formatAmount2(Math.round(num(p.non_taxable) * 100))}</div>
          {employer.length > 0 ? (
            <div className="col-span-2 mt-2">
              <span className="font-medium text-neutral-700">Employer contributions (not deducted from you): </span>
              {employer.map((l) => `${l.label} ₱${formatAmount2(l.amount)}`).join(" · ")}
            </div>
          ) : null}
          {p.ytd && typeof p.ytd.taxWithheld === "number" ? (
            <div className="col-span-2">
              Year to date before this payslip: taxable income ₱{formatAmount2(Math.round((p.ytd.taxableIncome ?? 0) * 100))} · tax withheld ₱{formatAmount2(Math.round((p.ytd.taxWithheld ?? 0) * 100))}
            </div>
          ) : null}
        </section>

        <footer className="mt-6 flex items-center justify-between text-[10px] text-neutral-500">
          <span>{p.acknowledged_at ? `Acknowledged ${formatDate(p.acknowledged_at, "MMM d, yyyy HH:mm")}` : "Not yet acknowledged"}</span>
          <span>Generated by LAF Operating System · payslip {p.id.slice(0, 8)}</span>
        </footer>
      </div>
    </div>
  );
}

function Lines({ title, lines, total, totalLabel }: { title: string; lines: PayLine[]; total: number; totalLabel: string }) {
  return (
    <div>
      <div className="mb-1 border-b border-neutral-300 pb-1 text-xs font-semibold uppercase tracking-wide text-neutral-600">{title}</div>
      <table className="w-full text-xs">
        <tbody>
          {lines.length === 0 ? (
            <tr>
              <td className="py-1 text-neutral-500">None</td>
            </tr>
          ) : (
            lines.map((l, i) => (
              <tr key={i}>
                <td className="py-0.5 pr-2">
                  {l.label}
                  {l.qty !== undefined && l.rate !== undefined ? <span className="text-neutral-500"> · {l.qty} × ₱{formatAmount2(l.rate)}{l.multiplier && l.multiplier !== 1 ? ` × ${l.multiplier}` : ""}</span> : null}
                </td>
                <td className="py-0.5 text-right tabular-nums">{formatAmount2(l.amount)}</td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr className="border-t border-neutral-300 font-semibold">
            <td className="pt-1">{totalLabel}</td>
            <td className="pt-1 text-right tabular-nums">{formatAmount2(Math.round(total * 100))}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
