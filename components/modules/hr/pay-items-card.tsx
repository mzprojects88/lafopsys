"use client";

import * as React from "react";
import { toast } from "sonner";
import { Plus, Pencil, Power } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Field, FieldLabel } from "@/components/ui/field";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePayItems, payItemsStore } from "@/lib/hooks/use-payroll-collections";
import { savePayItem, setPayItemActive, type PayItemInput } from "@/app/(app)/hr/payroll/actions";
import { formatDate } from "@/lib/utils/date";
import { formatAmount2, toCentavos } from "@/lib/utils/money";
import { payPeriodLabel } from "@/lib/utils/pay-period";
import { DE_MINIMIS_LIMITS } from "@/lib/utils/statutory";
import { employeeFullName, PAY_ITEM_CODES, type Employee, type PayItem, type PayItemCode, type PayPeriod } from "@/lib/types/hr";

/**
 * Pay items: what rides on a payslip besides salary and the statutory
 * lines. A deduction is refused without the date the person authorised it
 * (Labor Code Art. 113). Balances are never edited here -- they are what
 * approved payslips have applied.
 */
export function PayItemsCard({ employees, periods }: { employees: Employee[]; periods: PayPeriod[] }) {
  const { items, loading } = usePayItems();
  const [editing, setEditing] = React.useState<PayItem | "new" | null>(null);
  const [showInactive, setShowInactive] = React.useState(false);
  const byEmployee = new Map(employees.map((e) => [e.id, e]));
  const periodBy = new Map(periods.map((p) => [p.id, p]));
  const shown = items.filter((i) => showInactive || i.active);

  async function toggle(item: PayItem) {
    const r = await setPayItemActive(item.id, !item.active);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    await payItemsStore.refetch();
    toast.success(item.active ? "Item stopped." : "Item active again.");
  }

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Pay items</CardTitle>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={showInactive} onCheckedChange={setShowInactive} />
            Show stopped
          </label>
          <Button size="sm" className="gap-1.5" onClick={() => setEditing("new")} disabled={employees.length === 0}>
            <Plus className="size-3.5" />
            Add item
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing yet. Loans, advances, one-off allowances and retro pay go here.</p>
        ) : (
          shown.map((i) => {
            const e = byEmployee.get(i.employeeId);
            const p = i.periodId ? periodBy.get(i.periodId) : null;
            return (
              <div key={i.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-sm ${i.active ? "" : "opacity-60"}`}>
                <div className="flex min-w-0 flex-col">
                  <span className="font-medium">
                    {e ? employeeFullName(e) : "—"} · {i.label}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {i.kind === "deduction" ? "Deduction" : "Earning"} · ₱{formatAmount2(toCentavos(i.amount))}
                    {i.isRecurring ? " per cutoff" : p ? ` · ${payPeriodLabel({ year: p.year, seq: p.seq, from: p.startsOn, to: p.endsOn, isSecondCutoff: p.seq % 2 === 0 })}` : ""}
                    {i.amountTotal !== null ? ` · of ₱${formatAmount2(toCentavos(i.amountTotal))}` : ""}
                    {i.authorizedOn ? ` · authorised ${formatDate(i.authorizedOn)}` : ""}
                    {i.reference ? ` · ${i.reference}` : ""}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(i)} aria-label="Edit">
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => toggle(i)} aria-label={i.active ? "Stop" : "Reactivate"}>
                    <Power className="size-3.5" />
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
      {editing ? <PayItemDialog key={editing === "new" ? "new" : editing.id} item={editing === "new" ? null : editing} employees={employees} periods={periods} close={() => setEditing(null)} /> : null}
    </Card>
  );
}

function PayItemDialog({ item, employees, periods, close }: { item: PayItem | null; employees: Employee[]; periods: PayPeriod[]; close: () => void }) {
  const active = employees.filter((e) => e.status === "active" || e.status === "on_leave");
  const upcoming = periods.filter((p) => p.status === "open" || p.status === "timesheets_approved" || p.status === "computed").sort((a, b) => (a.startsOn < b.startsOn ? -1 : 1));
  const [form, setForm] = React.useState<PayItemInput>({
    employeeId: item?.employeeId ?? active[0]?.id ?? "",
    kind: item?.kind ?? "deduction",
    code: item?.code ?? "salary_advance",
    label: item?.label ?? "",
    amount: item?.amount ?? 0,
    periodId: item?.periodId ?? upcoming[0]?.id ?? null,
    isRecurring: item?.isRecurring ?? false,
    startsOn: item?.startsOn ?? null,
    endsOn: item?.endsOn ?? null,
    amountTotal: item?.amountTotal ?? null,
    authorizedOn: item?.authorizedOn ?? null,
    reference: item?.reference ?? "",
    deMinimisKind: item?.deMinimisKind ?? null,
    notes: item?.notes ?? "",
  });
  const [saving, setSaving] = React.useState(false);
  const codes = PAY_ITEM_CODES.filter((c) => c.kind === form.kind);
  const set = <K extends keyof PayItemInput>(k: K, v: PayItemInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function handleSave() {
    setSaving(true);
    const r = await savePayItem(item?.id ?? null, form);
    setSaving(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    await payItemsStore.refetch();
    toast.success("Pay item saved.");
    close();
  }

  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : close())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item ? "Edit pay item" : "Add pay item"}</DialogTitle>
          <DialogDescription>Deductions need the person&apos;s written authorisation and its date (Labor Code Arts. 113-116).</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="pi-who">Employee</FieldLabel>
            <Select value={form.employeeId} onValueChange={(v) => set("employeeId", v)} disabled={Boolean(item)}>
              <SelectTrigger id="pi-who" className="w-full">
                <SelectValue placeholder="Choose" />
              </SelectTrigger>
              <SelectContent>
                {active.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {employeeFullName(e)} · {e.employeeCode}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="pi-kind">Kind</FieldLabel>
              <Select
                value={form.kind}
                onValueChange={(v) => {
                  const kind = v as PayItemInput["kind"];
                  setForm((f) => ({ ...f, kind, code: PAY_ITEM_CODES.find((c) => c.kind === kind)!.value }));
                }}
              >
                <SelectTrigger id="pi-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="earning">Earning</SelectItem>
                  <SelectItem value="deduction">Deduction</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="pi-code">Type</FieldLabel>
              <Select value={form.code} onValueChange={(v) => set("code", v as PayItemCode)}>
                <SelectTrigger id="pi-code" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {codes.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{codes.find((c) => c.value === form.code)?.hint}</p>
            </Field>
          </div>
          {form.code === "de_minimis" ? (
            <Field>
              <FieldLabel htmlFor="pi-dm">De minimis limit</FieldLabel>
              <Select value={form.deMinimisKind ?? ""} onValueChange={(v) => set("deMinimisKind", v || null)}>
                <SelectTrigger id="pi-dm" className="w-full">
                  <SelectValue placeholder="Which benefit" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(DE_MINIMIS_LIMITS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
          <Field>
            <FieldLabel htmlFor="pi-label">Label on the payslip</FieldLabel>
            <Input id="pi-label" value={form.label} onChange={(e) => set("label", e.target.value)} placeholder="SSS salary loan, Retro Jul 1-15, …" />
          </Field>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">Recurring every cutoff</span>
            <Switch checked={form.isRecurring} onCheckedChange={(v) => set("isRecurring", v)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="pi-amount">{form.isRecurring ? "Per cutoff (₱)" : "Amount (₱)"}</FieldLabel>
              <Input id="pi-amount" type="number" min={0} step="0.01" value={form.amount || ""} onChange={(e) => set("amount", Number(e.target.value))} />
            </Field>
            {form.isRecurring ? (
              <Field>
                <FieldLabel htmlFor="pi-total">Total to collect (₱, optional)</FieldLabel>
                <Input id="pi-total" type="number" min={0} step="0.01" value={form.amountTotal ?? ""} onChange={(e) => set("amountTotal", e.target.value === "" ? null : Number(e.target.value))} />
                <p className="text-xs text-muted-foreground">Stops once approved payslips reach it.</p>
              </Field>
            ) : (
              <Field>
                <FieldLabel htmlFor="pi-period">Period</FieldLabel>
                <Select value={form.periodId ?? ""} onValueChange={(v) => set("periodId", v || null)}>
                  <SelectTrigger id="pi-period" className="w-full">
                    <SelectValue placeholder="Choose" />
                  </SelectTrigger>
                  <SelectContent>
                    {upcoming.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {payPeriodLabel({ year: p.year, seq: p.seq, from: p.startsOn, to: p.endsOn, isSecondCutoff: p.seq % 2 === 0 })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </div>
          {form.isRecurring ? (
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="pi-from">From</FieldLabel>
                <Input id="pi-from" type="date" value={form.startsOn ?? ""} onChange={(e) => set("startsOn", e.target.value || null)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="pi-to">Until (optional)</FieldLabel>
                <Input id="pi-to" type="date" value={form.endsOn ?? ""} onChange={(e) => set("endsOn", e.target.value || null)} />
              </Field>
            </div>
          ) : null}
          {form.kind === "deduction" ? (
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="pi-auth">Authorised on</FieldLabel>
                <Input id="pi-auth" type="date" value={form.authorizedOn ?? ""} onChange={(e) => set("authorizedOn", e.target.value || null)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="pi-ref">Reference</FieldLabel>
                <Input id="pi-ref" value={form.reference} onChange={(e) => set("reference", e.target.value)} placeholder="Loan no., authorisation form" />
              </Field>
            </div>
          ) : (
            <Field>
              <FieldLabel htmlFor="pi-ref">Reference (optional)</FieldLabel>
              <Input id="pi-ref" value={form.reference} onChange={(e) => set("reference", e.target.value)} />
            </Field>
          )}
          <Field>
            <FieldLabel htmlFor="pi-notes">Notes</FieldLabel>
            <Input id="pi-notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !form.employeeId}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
