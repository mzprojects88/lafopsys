import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils/date";
import { formatAmount2 } from "@/lib/utils/money";
import { PrintButton } from "@/app/(print)/hr/payslips/[id]/print/print-button";

const n = (v: string | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const peso = (v: number) => formatAmount2(Math.round(v * 100));

/**
 * BIR Form 2316 figures for one employee and year: the certificate of
 * compensation payment and tax withheld, laid out in the form's parts so
 * the numbers can be copied onto the official form (or attached to it).
 * A Server Component under the caller's RLS: HR reaches anyone, an
 * employee only themselves. The TIN comes from hr.employee_private here
 * and nowhere near a client collection.
 */
export default async function Form2316Page({ params }: { params: Promise<{ employeeId: string; year: string }> }) {
  const { employeeId, year: yearStr } = await params;
  const year = Number(yearStr);
  if (!Number.isInteger(year)) notFound();
  const supabase = await createClient();
  const [{ data: e }, { data: priv }, { data: slips }, { data: opening }] = await Promise.all([
    supabase.schema("hr").from("employees").select("employee_code, first_name, middle_name, last_name, suffix, address, birthdate, hire_date, separation_date, contact_number").eq("id", employeeId).maybeSingle(),
    supabase.schema("hr").from("employee_private").select("tin").eq("employee_id", employeeId).maybeSingle(),
    supabase
      .schema("hr")
      .from("payslips")
      .select("gross, basic_earned, taxable_gross, non_taxable, taxable_income, tax_withheld, sss_ee, mpf_ee, philhealth_ee, pagibig_ee, lines, payroll_runs!inner(status, year)")
      .eq("employee_id", employeeId)
      .eq("payroll_runs.year", year)
      .in("payroll_runs.status", ["approved", "paid", "closed"]),
    supabase.schema("hr").from("ytd_openings").select("*").eq("employee_id", employeeId).eq("year", year).maybeSingle(),
  ]);
  if (!e) notFound();

  type Slip = { gross: string; basic_earned: string; taxable_gross: string; non_taxable: string; taxable_income: string; tax_withheld: string; sss_ee: string; mpf_ee: string; philhealth_ee: string; pagibig_ee: string; lines: { code: string; amount: number }[] };
  const rows = (slips ?? []) as unknown as Slip[];
  const sum = (pick: (s: Slip) => number) => rows.reduce((a, s) => a + pick(s), 0);
  const thirteenth = n(opening?.thirteenth_month_paid) + sum((s) => (s.lines ?? []).filter((l) => l.code === "thirteenth_month").reduce((b, l) => b + l.amount / 100, 0));
  const basic = n(opening?.basic_earned) + sum((s) => n(s.basic_earned));
  // The opening's gross: its taxable income is net of contributions, so add them back, plus the non-taxable part (basic is inside taxable income already).
  const openingGross = n(opening?.taxable_income) + n(opening?.sss_ee) + n(opening?.philhealth_ee) + n(opening?.pagibig_ee) + n(opening?.non_taxable);
  const gross = openingGross + sum((s) => n(s.gross));
  const contributions = n(opening?.sss_ee) + n(opening?.philhealth_ee) + n(opening?.pagibig_ee) + sum((s) => n(s.sss_ee) + n(s.mpf_ee) + n(s.philhealth_ee) + n(s.pagibig_ee));
  const nonTaxableOther = Math.max(0, n(opening?.non_taxable) + sum((s) => n(s.non_taxable)) - thirteenth);
  const taxable = n(opening?.taxable_income) + sum((s) => n(s.taxable_income));
  const withheld = n(opening?.tax_withheld) + sum((s) => n(s.tax_withheld));
  const name = `${e.last_name}, ${e.first_name}${e.middle_name ? ` ${e.middle_name}` : ""}${e.suffix ? ` ${e.suffix}` : ""}`;
  const from = e.hire_date > `${year}-01-01` ? e.hire_date : `${year}-01-01`;
  const to = e.separation_date && e.separation_date <= `${year}-12-31` ? e.separation_date : `${year}-12-31`;

  return (
    <div className="mx-auto max-w-2xl p-6 text-sm text-neutral-900 print:max-w-none print:p-0">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href="/hr/reports" className="text-xs underline">
          Back to reports
        </Link>
        <PrintButton />
      </div>
      <div className="rounded-xl border border-neutral-300 p-6 print:rounded-none print:border-0 print:p-0">
        <header className="flex items-start justify-between gap-4 border-b border-neutral-300 pb-4">
          <div className="flex items-center gap-3">
            <Image src="/logo/laf-mark.png" alt="" width={48} height={51} />
            <div>
              <div className="text-base font-semibold">Little Ark Foundation</div>
              <div className="text-xs text-neutral-600">Certificate of Compensation Payment / Tax Withheld (BIR Form 2316 figures)</div>
            </div>
          </div>
          <div className="text-right text-xs">
            <div className="font-medium">Calendar year {year}</div>
            <div>Period {formatDate(from)} to {formatDate(to)}</div>
          </div>
        </header>

        <Section title="Part I · Employee">
          <Row k="Name" v={name} />
          <Row k="TIN" v={priv?.tin ?? "—"} />
          <Row k="Address" v={e.address ?? "—"} />
          <Row k="Employee ID" v={e.employee_code} />
          {e.birthdate ? <Row k="Date of birth" v={formatDate(e.birthdate)} /> : null}
        </Section>

        <Section title="Part IV-A · Non-taxable / exempt compensation">
          <Row k="13th month pay and other benefits (within ₱90,000)" v={peso(thirteenth)} />
          <Row k="De minimis benefits" v={peso(nonTaxableOther)} />
          <Row k="SSS, PhilHealth, Pag-IBIG contributions (employee share)" v={peso(contributions)} />
          <Row k="Total non-taxable" v={peso(thirteenth + nonTaxableOther + contributions)} strong />
        </Section>

        <Section title="Part IV-B · Taxable compensation">
          <Row k="Basic salary" v={peso(basic)} />
          <Row k="Taxable compensation income (net of contributions)" v={peso(taxable)} strong />
          <Row k="Gross compensation income" v={peso(gross)} />
        </Section>

        <Section title="Summary">
          <Row k="Tax due (annualised)" v={peso(withheld)} />
          <Row k="Tax withheld" v={peso(withheld)} strong />
          <Row k="Amount of taxes withheld as adjusted" v={peso(withheld)} />
        </Section>

        <p className="mt-6 text-[11px] text-neutral-600">
          Figures from approved payroll runs of {year}{opening ? ` and the opening figures to ${formatDate(opening.as_of)} (${opening.source ?? "prior payroll"})` : ""}. The employee&apos;s signature on the official form attests substituted filing where qualified (RR 11-2018 s.2.83.4).
        </p>
        <div className="mt-8 grid grid-cols-2 gap-8 text-xs">
          <div className="border-t border-neutral-400 pt-1">Employer&apos;s authorised representative</div>
          <div className="border-t border-neutral-400 pt-1">Employee</div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-600">{title}</div>
      <table className="w-full text-xs">
        <tbody>{children}</tbody>
      </table>
    </section>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <tr className={strong ? "font-semibold" : ""}>
      <td className="py-0.5 pr-2">{k}</td>
      <td className="py-0.5 text-right tabular-nums">{v}</td>
    </tr>
  );
}
