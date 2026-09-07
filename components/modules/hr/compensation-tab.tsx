"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/patterns/status-badge";
import { useCompensationHistory, compensationFamily } from "@/lib/hooks/use-employee-detail-collections";
import { useRateTables } from "@/lib/hooks/use-hr-reference-collections";
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import { formatDate } from "@/lib/utils/date";
import { DE_MINIMIS_LIMITS, minimumWageAt } from "@/lib/utils/statutory";
import { addCompensation, type CompensationInput } from "@/app/(app)/hr/actions";
import type { Allowance, Compensation, DaysFactor, Employee, PayBasis } from "@/lib/types/hr";

const peso = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Daily and hourly equivalents of a compensation row (DOLE handbook factors). */
export function equivalentRates(c: Pick<Compensation, "payBasis" | "basicMonthly" | "dailyRate" | "daysFactor" | "hoursPerDay">) {
  const daily = c.payBasis === "daily" ? (c.dailyRate ?? 0) : ((c.basicMonthly ?? 0) * 12) / c.daysFactor;
  return { daily, hourly: daily / c.hoursPerDay };
}

/**
 * Pay history. A new rate is a new row effective from a date; the previous
 * one closes on that day (0036 trigger). The current rate is compared with
 * the minimum wage in force so an underpayment is visible here, before it
 * reaches a payslip.
 */
export function CompensationTab({ employee, manages, today }: { employee: Employee; manages: boolean; today: string }) {
  const { history, current, loading } = useCompensationHistory(employee.id);
  const { rateTables } = useRateTables();
  const { minimumWageRegion } = useAppSettings();

  let wage: ReturnType<typeof minimumWageAt> | null = null;
  try {
    wage = rateTables.length ? minimumWageAt(minimumWageRegion, today, rateTables) : null;
  } catch {
    wage = null;
  }
  const rates = current ? equivalentRates(current) : null;
  const fullTime = current ? current.hoursPerDay >= 8 : false;
  const belowMinimum = wage && rates && fullTime && !current?.isMinimumWageEarner && rates.daily < wage.rate - 0.005;

  return (
    <div className="flex flex-col gap-4">
      {belowMinimum && wage && rates ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          The current rate works out to {peso(rates.daily)} a day, below the {peso(wage.rate)} minimum wage under {wage.wageOrder}. A full-time employee cannot be paid less; a part-time schedule must
          be recorded on the Schedule tab if that is what this is.
        </p>
      ) : null}
      {wage?.pending ? (
        <p className="text-xs text-muted-foreground">
          {wage.pending.wageOrder} ({peso(wage.pending.rate)}/day from {formatDate(wage.pending.effectiveFrom)}) is {wage.pending.status === "enjoined" ? "under a court injunction" : "not yet in force"}. If
          it takes effect, a wage differential may be due retroactively.
        </p>
      ) : null}

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Pay</CardTitle>
          {manages ? <CompensationDialog employee={employee} current={current} /> : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {loading && history.length === 0 ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pay on file. Payroll cannot run for this person until a rate is set.</p>
          ) : (
            history.map((c) => {
              const r = equivalentRates(c);
              return (
                <div key={c.id} className="flex flex-wrap items-start justify-between gap-2 rounded-xl border px-3 py-2.5 text-sm">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-medium">
                      {c.payBasis === "monthly" ? `${peso(c.basicMonthly ?? 0)} / month` : `${peso(c.dailyRate ?? 0)} / day`}
                      <span className="text-muted-foreground"> · {peso(r.daily)}/day · {peso(r.hourly)}/hr</span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      From {formatDate(c.effectiveFrom)}
                      {c.effectiveTo ? ` to ${formatDate(c.effectiveTo)}` : " (current)"} · factor {c.daysFactor} · {c.hoursPerDay} h/day
                      {c.isMinimumWageEarner ? " · minimum wage earner (tax-exempt)" : ""}
                      {c.reason ? ` — ${c.reason}` : ""}
                    </span>
                    {c.allowances.length ? (
                      <span className="text-xs text-muted-foreground">
                        Allowances: {c.allowances.map((a) => `${a.label} ${peso(a.amountMonthly)}/mo (${a.tax === "de_minimis" ? "de minimis" : "taxable"})`).join(", ")}
                      </span>
                    ) : null}
                  </div>
                  {c.effectiveTo === null ? <StatusBadge domain="employee" status="active" label="Current" /> : null}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CompensationDialog({ employee, current }: { employee: Employee; current: Compensation | null }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState<CompensationInput>(() => blank(current));

  function blank(from: Compensation | null): CompensationInput {
    return {
      effectiveFrom: "",
      payBasis: from?.payBasis ?? "monthly",
      basicMonthly: from?.basicMonthly ?? null,
      dailyRate: from?.dailyRate ?? null,
      daysFactor: from?.daysFactor ?? 365,
      hoursPerDay: from?.hoursPerDay ?? 8,
      allowances: from?.allowances.map((a) => ({ ...a })) ?? [],
      isMinimumWageEarner: from?.isMinimumWageEarner ?? false,
      reason: "",
    };
  }

  async function handleSave() {
    setSaving(true);
    const result = await addCompensation(employee.id, form);
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    await compensationFamily.get(employee.id).refetch();
    toast.success("New rate recorded.");
    setOpen(false);
    router.refresh();
  }

  const setAllowance = (i: number, patch: Partial<Allowance>) => setForm((f) => ({ ...f, allowances: f.allowances.map((a, j) => (j === i ? { ...a, ...patch } : a)) }));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setForm(blank(current));
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Plus className="size-3.5" />
          {current ? "New rate" : "Set pay"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{current ? "New rate" : "Set pay"}</DialogTitle>
          <DialogDescription>Takes effect from the date given; the previous rate ends the day before. Rates cannot be back-dated behind a later one.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="comp-from">Effective from</FieldLabel>
            <Input id="comp-from" type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} />
          </Field>
          <Field>
            <FieldLabel htmlFor="comp-basis">Pay basis</FieldLabel>
            <Select value={form.payBasis} onValueChange={(v) => setForm({ ...form, payBasis: v as PayBasis })}>
              <SelectTrigger id="comp-basis" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">Fixed monthly</SelectItem>
                <SelectItem value="daily">Daily rate</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {form.payBasis === "monthly" ? (
            <Field>
              <FieldLabel htmlFor="comp-basic">Basic salary per month</FieldLabel>
              <Input id="comp-basic" type="number" min="0" step="0.01" value={form.basicMonthly ?? ""} onChange={(e) => setForm({ ...form, basicMonthly: e.target.value === "" ? null : Number(e.target.value) })} />
            </Field>
          ) : (
            <Field>
              <FieldLabel htmlFor="comp-daily">Daily rate</FieldLabel>
              <Input id="comp-daily" type="number" min="0" step="0.01" value={form.dailyRate ?? ""} onChange={(e) => setForm({ ...form, dailyRate: e.target.value === "" ? null : Number(e.target.value) })} />
            </Field>
          )}
          <Field>
            <FieldLabel htmlFor="comp-hours">Hours per day</FieldLabel>
            <Input id="comp-hours" type="number" min="1" max="12" step="0.5" value={form.hoursPerDay} onChange={(e) => setForm({ ...form, hoursPerDay: Number(e.target.value) })} />
          </Field>
          {form.payBasis === "monthly" ? (
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="comp-factor">Days factor</FieldLabel>
              <Select value={String(form.daysFactor)} onValueChange={(v) => setForm({ ...form, daysFactor: Number(v) as DaysFactor })}>
                <SelectTrigger id="comp-factor" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="365">365 — paid every day, rest days and holidays included</SelectItem>
                  <SelectItem value="313">313 — six days a week, holidays paid</SelectItem>
                  <SelectItem value="261">261 — five days a week, holidays paid</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Daily rate = monthly × 12 ÷ factor (DOLE Handbook on Workers&apos; Statutory Monetary Benefits). It decides whether a holiday or rest day is already in the monthly pay.</p>
            </Field>
          ) : null}

          <div className="flex items-center justify-between gap-3 sm:col-span-2">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">Minimum wage earner</span>
              <span className="text-xs text-muted-foreground">Paid exactly the statutory minimum: exempt from income tax and withholding (NIRC s.24(A)(2)).</span>
            </div>
            <Switch checked={form.isMinimumWageEarner} onCheckedChange={(v) => setForm({ ...form, isMinimumWageEarner: v })} />
          </div>

          <div className="flex flex-col gap-2 sm:col-span-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Allowances</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setForm({ ...form, allowances: [...form.allowances, { code: "", label: "Communication allowance", amountMonthly: 0, tax: "taxable" }] })}
              >
                <Plus className="size-3.5" />
                Add
              </Button>
            </div>
            {form.allowances.map((a, i) => (
              <div key={i} className="grid grid-cols-[1fr_7rem_9rem_auto] items-center gap-2">
                <Input value={a.label} onChange={(e) => setAllowance(i, { label: e.target.value })} placeholder="Name" aria-label="Allowance name" />
                <Input type="number" min="0" step="0.01" value={a.amountMonthly} onChange={(e) => setAllowance(i, { amountMonthly: Number(e.target.value) })} aria-label="Monthly amount" />
                <Select
                  value={a.tax === "de_minimis" ? `dm:${a.deMinimisKind ?? "rice"}` : "taxable"}
                  onValueChange={(v) => (v === "taxable" ? setAllowance(i, { tax: "taxable", deMinimisKind: undefined }) : setAllowance(i, { tax: "de_minimis", deMinimisKind: v.slice(3) }))}
                >
                  <SelectTrigger aria-label="Tax treatment">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="taxable">Taxable</SelectItem>
                    {Object.entries(DE_MINIMIS_LIMITS)
                      .filter(([, l]) => (l.perMonth ?? l.perYear ?? 0) > 0)
                      .map(([k, l]) => (
                        <SelectItem key={k} value={`dm:${k}`}>
                          De minimis: {l.label}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove allowance" onClick={() => setForm({ ...form, allowances: form.allowances.filter((_, j) => j !== i) })}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">De minimis benefits are tax-free within RR 11-2018&apos;s limits; the excess, and any other allowance, is taxable compensation.</p>
          </div>

          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="comp-reason">Reason</FieldLabel>
            <Input id="comp-reason" value={form.reason ?? ""} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Annual increase, regularisation, wage order…" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save rate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
