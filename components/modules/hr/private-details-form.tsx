"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { updateEmployeePrivate, type EmployeePrivateInput } from "@/app/(app)/hr/actions";
import type { Employee, EmployeePrivate } from "@/lib/types/hr";

/**
 * Government ID numbers and bank details -- sensitive personal information
 * under RA 10173. The record arrives from the Server Component page, read
 * under the viewer's own RLS for this one person, and is saved back through
 * a server action; it never sits in a client-side store.
 */
export function PrivateDetailsForm({ employee, record, manages }: { employee: Employee; record: EmployeePrivate | null; manages: boolean }) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState<EmployeePrivateInput>({
    sssNo: record?.sssNo ?? "",
    philhealthNo: record?.philhealthNo ?? "",
    pagibigNo: record?.pagibigNo ?? "",
    tin: record?.tin ?? "",
    bankName: record?.bankName ?? "",
    bankAccountName: record?.bankAccountName ?? "",
    bankAccountNo: record?.bankAccountNo ?? "",
  });
  const set = (k: keyof EmployeePrivateInput, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function handleSave() {
    setSaving(true);
    const result = await updateEmployeePrivate(employee.id, form);
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("IDs and bank details saved.");
    router.refresh();
  }

  const field = (id: string, label: string, k: keyof EmployeePrivateInput, placeholder?: string) => (
    <Field key={id}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} value={form[k] ?? ""} onChange={(e) => set(k, e.target.value)} placeholder={placeholder} disabled={!manages} autoComplete="off" />
    </Field>
  );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="flex-row items-center gap-2 space-y-0">
          <ShieldCheck className="size-4 text-muted-foreground" />
          <CardTitle className="text-base">Government IDs</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4">
          {field("pv-sss", "SSS No.", "sssNo", "00-0000000-0")}
          {field("pv-ph", "PhilHealth No.", "philhealthNo", "00-000000000-0")}
          {field("pv-pi", "Pag-IBIG MID No.", "pagibigNo", "0000-0000-0000")}
          {field("pv-tin", "TIN", "tin", "000-000-000-000")}
          <p className="text-xs text-muted-foreground">Used on the SSS, PhilHealth and Pag-IBIG remittance lists and on BIR 1601-C / 2316. Sensitive personal information: visible to HR and to the person only.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bank</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4">
          {field("pv-bank", "Bank", "bankName", "BDO, GCash…")}
          {field("pv-acct-name", "Account name", "bankAccountName")}
          {field("pv-acct-no", "Account number", "bankAccountNo")}
          <p className="text-xs text-muted-foreground">Where net pay is transferred. Payslips show the last four digits only.</p>
          {manages ? (
            <div className="flex justify-end">
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : "Save IDs & bank"}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
