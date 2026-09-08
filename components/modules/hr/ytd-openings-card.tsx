"use client";

import * as React from "react";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useYtdOpenings, ytdOpeningsStore } from "@/lib/hooks/use-payroll-collections";
import { saveYtdOpening, type YtdOpeningInput } from "@/app/(app)/hr/payroll/actions";
import { formatDate } from "@/lib/utils/date";
import { formatAmount2, toCentavos } from "@/lib/utils/money";
import { employeeFullName, type Employee, type YtdOpening } from "@/lib/types/hr";

/**
 * The year's figures paid before the system went live, per employee, so
 * December annualisation, the 90,000 ceiling and the 2316 cover the whole
 * year. Taken from the spreadsheet payroll; entered once, corrected here.
 */
export function YtdOpeningsCard({ employees, year }: { employees: Employee[]; year: number }) {
  const { openings, loading } = useYtdOpenings();
  const [editing, setEditing] = React.useState<Employee | null>(null);
  const active = employees.filter((e) => e.status === "active" || e.status === "on_leave" || (e.separationDate ?? "") >= `${year}-01-01`);
  const byEmployee = new Map(openings.filter((o) => o.year === year).map((o) => [o.employeeId, o]));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Opening figures {year}</CardTitle>
        <p className="text-xs text-muted-foreground">What was paid from January until the system took over: basic earned, taxable income, tax withheld and contributions. Needed for the year-end tax true-up and the 2316.</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          active.map((e) => {
            const o = byEmployee.get(e.id);
            return (
              <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-sm">
                <div className="flex min-w-0 flex-col">
                  <span className="font-medium">{employeeFullName(e)}</span>
                  <span className="text-xs text-muted-foreground">
                    {o ? `To ${formatDate(o.asOf)} · basic ₱${formatAmount2(toCentavos(o.basicEarned))} · taxable ₱${formatAmount2(toCentavos(o.taxableIncome))} · tax ₱${formatAmount2(toCentavos(o.taxWithheld))}` : "Not entered: the year starts at zero for this person."}
                  </span>
                </div>
                <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setEditing(e)}>
                  <Pencil className="size-3.5" />
                  {o ? "Edit" : "Enter"}
                </Button>
              </div>
            );
          })
        )}
      </CardContent>
      {editing ? <YtdDialog key={editing.id} employee={editing} year={year} existing={byEmployee.get(editing.id) ?? null} close={() => setEditing(null)} /> : null}
    </Card>
  );
}

const FIELDS: { key: keyof Omit<YtdOpeningInput, "employeeId" | "year" | "asOf" | "source">; label: string }[] = [
  { key: "basicEarned", label: "Basic salary earned" },
  { key: "taxableIncome", label: "Taxable income (after contributions)" },
  { key: "nonTaxable", label: "Non-taxable pay (de minimis etc.)" },
  { key: "taxWithheld", label: "Tax withheld" },
  { key: "sssEe", label: "SSS employee share (incl. MPF)" },
  { key: "philhealthEe", label: "PhilHealth employee share" },
  { key: "pagibigEe", label: "Pag-IBIG employee share" },
  { key: "thirteenthMonthPaid", label: "13th month already paid" },
];

function YtdDialog({ employee, year, existing, close }: { employee: Employee; year: number; existing: YtdOpening | null; close: () => void }) {
  const [form, setForm] = React.useState<YtdOpeningInput>({
    employeeId: employee.id,
    year,
    asOf: existing?.asOf ?? `${year}-08-31`,
    basicEarned: existing?.basicEarned ?? 0,
    taxableIncome: existing?.taxableIncome ?? 0,
    nonTaxable: existing?.nonTaxable ?? 0,
    taxWithheld: existing?.taxWithheld ?? 0,
    sssEe: existing?.sssEe ?? 0,
    philhealthEe: existing?.philhealthEe ?? 0,
    pagibigEe: existing?.pagibigEe ?? 0,
    thirteenthMonthPaid: existing?.thirteenthMonthPaid ?? 0,
    source: existing?.source ?? "Spreadsheet payroll",
  });
  const [saving, setSaving] = React.useState(false);

  async function handleSave() {
    setSaving(true);
    const r = await saveYtdOpening(form);
    setSaving(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    await ytdOpeningsStore.refetch();
    toast.success("Opening figures saved.");
    close();
  }

  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : close())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{employeeFullName(employee)} · {year} opening figures</DialogTitle>
          <DialogDescription>Totals from January 1 up to the date below, in pesos.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="ytd-asof">Figures run to</FieldLabel>
              <Input id="ytd-asof" type="date" value={form.asOf} onChange={(e) => setForm((f) => ({ ...f, asOf: e.target.value }))} />
            </Field>
            <Field>
              <FieldLabel htmlFor="ytd-source">Source</FieldLabel>
              <Input id="ytd-source" value={form.source} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {FIELDS.map((f) => (
              <Field key={f.key}>
                <FieldLabel htmlFor={`ytd-${f.key}`}>{f.label}</FieldLabel>
                <Input id={`ytd-${f.key}`} type="number" min={0} step="0.01" value={form[f.key] || ""} onChange={(e) => setForm((s) => ({ ...s, [f.key]: Number(e.target.value) }))} />
              </Field>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
