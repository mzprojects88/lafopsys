import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils/date";
import { dayKey } from "@/lib/utils/dtr";
import { serviceMonths } from "@/lib/utils/employment";
import { PrintButton } from "@/app/(print)/hr/payslips/[id]/print/print-button";

/**
 * Certificate of Employment (DOLE Labor Advisory 06-20: issued within
 * three days of the request): name, position, dates of employment, and
 * -- only when the person asks -- nothing about pay. Under the caller's
 * RLS: HR for anyone, an employee for themselves.
 */
export default async function CoePage({ params, searchParams }: { params: Promise<{ employeeId: string }>; searchParams: Promise<{ date?: string; purpose?: string }> }) {
  const { employeeId } = await params;
  const q = await searchParams;
  const supabase = await createClient();
  const { data: e } = await supabase.schema("hr").from("employees").select("employee_code, first_name, middle_name, last_name, suffix, position, department, employment_type, status, hire_date, separation_date").eq("id", employeeId).maybeSingle();
  if (!e) notFound();
  const today = dayKey(new Date());
  const issued = q.date && /^\d{4}-\d{2}-\d{2}$/.test(q.date) ? q.date : today;
  const name = `${e.first_name}${e.middle_name ? ` ${e.middle_name}` : ""} ${e.last_name}${e.suffix ? ` ${e.suffix}` : ""}`;
  const separated = e.separation_date && e.separation_date <= issued;
  const until = separated ? e.separation_date! : issued;
  const months = serviceMonths(e.hire_date, until);
  const tenure = months >= 12 ? `${Math.floor(months / 12)} year${Math.floor(months / 12) === 1 ? "" : "s"}${months % 12 ? ` and ${months % 12} month${months % 12 === 1 ? "" : "s"}` : ""}` : `${months} month${months === 1 ? "" : "s"}`;

  return (
    <div className="mx-auto max-w-2xl p-6 text-sm text-neutral-900 print:max-w-none print:p-0">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href="/hr/employees" className="text-xs underline">
          Back to employees
        </Link>
        <PrintButton />
      </div>
      <div className="rounded-xl border border-neutral-300 p-10 print:rounded-none print:border-0 print:p-0">
        <header className="flex flex-col items-center gap-2 border-b border-neutral-300 pb-6 text-center">
          <Image src="/logo/laf-mark.png" alt="" width={64} height={68} />
          <div className="text-lg font-semibold">Little Ark Foundation</div>
        </header>
        <h1 className="mt-10 text-center text-xl font-bold tracking-wide">CERTIFICATE OF EMPLOYMENT</h1>
        <p className="mt-8 leading-7">To whom it may concern:</p>
        <p className="mt-4 leading-7">
          This certifies that <strong>{name}</strong> {separated ? "was" : "is"} employed by Little Ark Foundation as <strong>{e.position}</strong>
          {e.department ? ` in ${e.department}` : ""} from <strong>{formatDate(e.hire_date, "MMMM d, yyyy")}</strong> {separated ? <>to <strong>{formatDate(e.separation_date!, "MMMM d, yyyy")}</strong></> : "to the present"}, a period of {tenure}.
        </p>
        {q.purpose ? <p className="mt-4 leading-7">This certificate is issued upon the request of the employee for {q.purpose}.</p> : <p className="mt-4 leading-7">This certificate is issued upon the request of the employee for whatever legal purpose it may serve.</p>}
        <p className="mt-4 leading-7">Issued on {formatDate(issued, "MMMM d, yyyy")} in Mandaluyong City.</p>
        <div className="mt-16 w-64">
          <div className="border-t border-neutral-400 pt-1 text-xs">Authorised representative</div>
          <div className="text-xs text-neutral-600">Little Ark Foundation</div>
        </div>
        <p className="mt-10 text-[10px] text-neutral-500">Employee ID {e.employee_code} · Issued under DOLE Labor Advisory 06-20.</p>
      </div>
    </div>
  );
}
