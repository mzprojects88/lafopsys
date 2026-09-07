"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EMPLOYMENT_TYPES, type Employee, type EmploymentType, type Sex } from "@/lib/types/hr";
import { employeesStore } from "@/lib/hooks/use-employees-collection";
import { createEmployee, updateEmployee, type EmployeeInput } from "@/app/(app)/hr/actions";

const NONE = "__none__";

/**
 * Create or edit a 201 record. The masterlist's columns, one for one, minus
 * the government IDs and bank details (IDs & Bank tab, their own table) and
 * minus status/type/position changes after hiring (Employment tab, as
 * events). Plain useState dialog like CreateStaffDialog.
 */
export function EmployeeFormDialog({ employee, onCreated }: { employee?: Employee; onCreated?: (id: string) => void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {employee ? (
          <Button variant="outline" size="sm" className="gap-1.5">
            <Pencil className="size-3.5" />
            Edit profile
          </Button>
        ) : (
          <Button>
            <Plus />
            Add employee
          </Button>
        )}
      </DialogTrigger>
      {/* Remounted per opening so a cancelled edit never leaks into the next. */}
      {open ? <EmployeeForm key={employee?.updatedAt ?? "new"} employee={employee} close={() => setOpen(false)} onCreated={onCreated} /> : null}
    </Dialog>
  );
}

function EmployeeForm({ employee, close, onCreated }: { employee?: Employee; close: () => void; onCreated?: (id: string) => void }) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState<EmployeeInput>(() => ({
    employeeCode: employee?.employeeCode ?? "",
    firstName: employee?.firstName ?? "",
    middleName: employee?.middleName ?? "",
    lastName: employee?.lastName ?? "",
    suffix: employee?.suffix ?? "",
    position: employee?.position ?? "",
    department: employee?.department ?? "",
    employmentType: employee?.employmentType ?? "probationary",
    hireDate: employee?.hireDate ?? "",
    birthdate: employee?.birthdate ?? "",
    sex: employee?.sex ?? null,
    civilStatus: employee?.civilStatus ?? "",
    contactNumber: employee?.contactNumber ?? "",
    email: employee?.email ?? "",
    address: employee?.address ?? "",
    emergencyContact: { ...employee?.emergencyContact },
    notes: employee?.notes ?? "",
  }));
  const set = <K extends keyof EmployeeInput>(k: K, v: EmployeeInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setEc = (k: "name" | "relationship" | "phone" | "address", v: string) => setForm((f) => ({ ...f, emergencyContact: { ...f.emergencyContact, [k]: v } }));

  async function handleSave() {
    setSaving(true);
    const result = employee ? await updateEmployee(employee.id, form) : await createEmployee(form);
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    await employeesStore.refetch();
    toast.success(employee ? "Profile saved." : `${form.firstName} ${form.lastName} added.`);
    close();
    if (!employee && result.data?.id) onCreated?.(result.data.id);
    router.refresh();
  }

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{employee ? "Edit profile" : "New employee"}</DialogTitle>
        <DialogDescription>
          {employee ? "Name, contact and personal details. Position, status and dates change on the Employment tab." : "The 201 record. IDs, bank details, pay and schedule are added on the employee's page afterwards."}
        </DialogDescription>
      </DialogHeader>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="emp-code">Employee ID</FieldLabel>
          <Input id="emp-code" value={form.employeeCode} onChange={(e) => set("employeeCode", e.target.value)} placeholder="EMP-3010" />
        </Field>
        {!employee ? (
          <Field>
            <FieldLabel htmlFor="emp-type">Employment</FieldLabel>
            <Select value={form.employmentType} onValueChange={(v) => set("employmentType", v as EmploymentType)}>
              <SelectTrigger id="emp-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EMPLOYMENT_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : (
          <div />
        )}
        <Field>
          <FieldLabel htmlFor="emp-first">First name</FieldLabel>
          <Input id="emp-first" value={form.firstName} onChange={(e) => set("firstName", e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="emp-middle">Middle name</FieldLabel>
          <Input id="emp-middle" value={form.middleName ?? ""} onChange={(e) => set("middleName", e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="emp-last">Last name</FieldLabel>
          <Input id="emp-last" value={form.lastName} onChange={(e) => set("lastName", e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="emp-suffix">Suffix</FieldLabel>
          <Input id="emp-suffix" value={form.suffix ?? ""} onChange={(e) => set("suffix", e.target.value)} placeholder="Jr., III" />
        </Field>
        {!employee ? (
          <>
            <Field>
              <FieldLabel htmlFor="emp-position">Position</FieldLabel>
              <Input id="emp-position" value={form.position} onChange={(e) => set("position", e.target.value)} placeholder="Resident Social Worker" />
            </Field>
            <Field>
              <FieldLabel htmlFor="emp-hired">Date hired</FieldLabel>
              <Input id="emp-hired" type="date" value={form.hireDate} onChange={(e) => set("hireDate", e.target.value)} />
            </Field>
          </>
        ) : null}
        <Field>
          <FieldLabel htmlFor="emp-dept">Department</FieldLabel>
          <Input id="emp-dept" value={form.department ?? ""} onChange={(e) => set("department", e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="emp-birth">Birthdate</FieldLabel>
          <Input id="emp-birth" type="date" value={form.birthdate ?? ""} onChange={(e) => set("birthdate", e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="emp-sex">Sex</FieldLabel>
          <Select value={form.sex ?? NONE} onValueChange={(v) => set("sex", v === NONE ? null : (v as Sex))}>
            <SelectTrigger id="emp-sex" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Not stated</SelectItem>
              <SelectItem value="female">Female</SelectItem>
              <SelectItem value="male">Male</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Decides maternity, paternity and women&apos;s special leave eligibility.</p>
        </Field>
        <Field>
          <FieldLabel htmlFor="emp-civil">Civil status</FieldLabel>
          <Input id="emp-civil" value={form.civilStatus ?? ""} onChange={(e) => set("civilStatus", e.target.value)} placeholder="Single, Married, …" />
        </Field>
        <Field>
          <FieldLabel htmlFor="emp-contact">Contact number</FieldLabel>
          <Input id="emp-contact" value={form.contactNumber ?? ""} onChange={(e) => set("contactNumber", e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="emp-email">Email</FieldLabel>
          <Input id="emp-email" type="email" value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} />
        </Field>
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor="emp-address">Address</FieldLabel>
          <Input id="emp-address" value={form.address ?? ""} onChange={(e) => set("address", e.target.value)} />
        </Field>

        <p className="text-sm font-medium sm:col-span-2">Emergency contact</p>
        <Field>
          <FieldLabel htmlFor="ec-name">Name</FieldLabel>
          <Input id="ec-name" value={form.emergencyContact?.name ?? ""} onChange={(e) => setEc("name", e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="ec-rel">Relationship</FieldLabel>
          <Input id="ec-rel" value={form.emergencyContact?.relationship ?? ""} onChange={(e) => setEc("relationship", e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="ec-phone">Contact number</FieldLabel>
          <Input id="ec-phone" value={form.emergencyContact?.phone ?? ""} onChange={(e) => setEc("phone", e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="ec-address">Address</FieldLabel>
          <Input id="ec-address" value={form.emergencyContact?.address ?? ""} onChange={(e) => setEc("address", e.target.value)} />
        </Field>

        <Field className="sm:col-span-2">
          <FieldLabel htmlFor="emp-notes">Notes</FieldLabel>
          <Textarea id="emp-notes" rows={2} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
        </Field>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={close} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : employee ? "Save" : "Add employee"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
