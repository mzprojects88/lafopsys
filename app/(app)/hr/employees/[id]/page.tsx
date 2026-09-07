import { createClient } from "@/lib/supabase/server";
import { EmployeeDetail } from "@/components/modules/hr/employee-detail";
import type { EmployeePrivate } from "@/lib/types/hr";

interface PrivateRow {
  employee_id: string;
  sss_no: string | null;
  philhealth_no: string | null;
  pagibig_no: string | null;
  tin: string | null;
  bank_name: string | null;
  bank_account_name: string | null;
  bank_account_no: string | null;
  updated_at: string;
}

/**
 * One employee's 201 file. A Server Component so the government IDs and
 * bank details (hr.employee_private) are read here, under the caller's own
 * RLS, for this one person -- never through a client-side collection that
 * would hold everyone's. The rest of the record streams live from the
 * `hr` stores in the client component.
 */
export default async function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.schema("hr").from("employee_private").select("*").eq("employee_id", id).maybeSingle();
  const row = data as PrivateRow | null;
  const privateRecord: EmployeePrivate | null = row
    ? {
        employeeId: row.employee_id,
        sssNo: row.sss_no,
        philhealthNo: row.philhealth_no,
        pagibigNo: row.pagibig_no,
        tin: row.tin,
        bankName: row.bank_name,
        bankAccountName: row.bank_account_name,
        bankAccountNo: row.bank_account_no,
        updatedAt: row.updated_at,
      }
    : null;

  return <EmployeeDetail employeeId={id} privateRecord={privateRecord} />;
}
