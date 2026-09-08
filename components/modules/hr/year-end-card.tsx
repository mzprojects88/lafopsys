"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Gift, LogOut, SlidersHorizontal } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { payrollRunsStore } from "@/lib/hooks/use-payroll-collections";
import { payPeriodsStore } from "@/lib/hooks/use-pay-periods-collection";
import { computeAdjustmentRun, computeFinalPayRun, computeThirteenthMonthRun } from "@/app/(app)/hr/payroll/actions";
import { payPeriodLabel } from "@/lib/utils/pay-period";
import { employeeFullName, type Employee, type PayPeriod, type PayrollRun } from "@/lib/types/hr";

/** The three run kinds beyond the regular cutoff: 13th month, final pay, adjustment. */
export function YearEndCard({ employees, periods, runs, year, today }: { employees: Employee[]; periods: PayPeriod[]; runs: PayrollRun[]; year: number; today: string }) {
  const router = useRouter();
  const [which, setWhich] = React.useState<"thirteenth" | "final" | "adjustment" | null>(null);
  const thirteenth = runs.find((r) => r.kind === "thirteenth_month" && r.year === year && r.status !== "cancelled");
  const separated = employees.filter((e) => (e.status === "resigned" || e.status === "terminated") && e.separationDate);
  const adjustable = periods.filter((p) => runs.some((r) => r.kind === "regular" && r.periodId === p.id && ["approved", "paid", "closed"].includes(r.status)));

  async function done(runId: string, msg: string) {
    await Promise.all([payrollRunsStore.refetch(), payPeriodsStore.refetch()]);
    toast.success(msg);
    setWhich(null);
    router.push(`/hr/payroll/${runId}`);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Year-end and one-off runs</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Action icon={Gift} title={`13th month ${year}`} hint={thirteenth ? `Run exists (${thirteenth.status}).` : "Basic salary earned this year ÷ 12, by December 24 (PD 851). Approve it before December's second cutoff."} label={thirteenth ? "Open" : "Compute"} onClick={() => (thirteenth ? router.push(`/hr/payroll/${thirteenth.id}`) : setWhich("thirteenth"))} />
        <Action icon={LogOut} title="Final pay" hint={separated.length ? `${separated.length} separated person(s) on file. Within 30 days of separation (LA 06-20).` : "Nobody separated on file. Record the separation on the Employment tab first."} label="Compute" disabled={separated.length === 0} onClick={() => setWhich("final")} />
        <Action icon={SlidersHorizontal} title="Adjustment" hint={adjustable.length ? "Recompute an approved period with today's rates and pay only the difference (a wage order, a corrected rate)." : "Needs an approved period."} label="Compute" disabled={adjustable.length === 0} onClick={() => setWhich("adjustment")} />
      </CardContent>
      {which === "thirteenth" ? <ThirteenthDialog year={year} today={today} close={() => setWhich(null)} done={done} /> : null}
      {which === "final" ? <FinalPayDialog separated={separated} today={today} close={() => setWhich(null)} done={done} /> : null}
      {which === "adjustment" ? <AdjustmentDialog periods={adjustable} close={() => setWhich(null)} done={done} /> : null}
    </Card>
  );
}

function Action({ icon: Icon, title, hint, label, disabled, onClick }: { icon: React.ComponentType<{ className?: string }>; title: string; hint: string; label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <div className="flex flex-col justify-between gap-2 rounded-xl border p-3">
      <div className="flex flex-col gap-1">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <Icon className="size-4 text-muted-foreground" />
          {title}
        </span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </div>
      <Button size="sm" variant="outline" className="w-fit" onClick={onClick} disabled={disabled}>
        {label}
      </Button>
    </div>
  );
}

function ThirteenthDialog({ year, today, close, done }: { year: number; today: string; close: () => void; done: (runId: string, msg: string) => Promise<void> }) {
  const [payDate, setPayDate] = React.useState(`${year}-12-15` > today ? `${year}-12-15` : today);
  const [saving, setSaving] = React.useState(false);
  async function go() {
    setSaving(true);
    const r = await computeThirteenthMonthRun(year, payDate);
    setSaving(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    await done(r.data!.runId, `${r.data!.count} 13th month payslip(s) computed.`);
  }
  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>13th month {year}</DialogTitle>
          <DialogDescription>Total basic salary earned in {year} (opening figures plus approved payslips) divided by twelve, less any advance. Exempt within the ₱90,000 ceiling.</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="tm-date">Pay date</FieldLabel>
          <Input id="tm-date" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={go} disabled={saving}>
            {saving ? "Computing…" : "Compute"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FinalPayDialog({ separated, today, close, done }: { separated: Employee[]; today: string; close: () => void; done: (runId: string, msg: string) => Promise<void> }) {
  const [form, setForm] = React.useState({ employeeId: separated[0]?.id ?? "", payDate: today, vlDays: 0, accountabilities: 0, notes: "" });
  const [saving, setSaving] = React.useState(false);
  async function go() {
    setSaving(true);
    const r = await computeFinalPayRun(form);
    setSaving(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    await done(r.data!.runId, "Final pay computed.");
  }
  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Final pay</DialogTitle>
          <DialogDescription>The last partial period from its approved timesheet, the pro-rated 13th month, unused vacation leave when the policy pays it out, separation pay by cause, less accountabilities.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="fp-who">Employee</FieldLabel>
            <Select value={form.employeeId} onValueChange={(v) => setForm((f) => ({ ...f, employeeId: v }))}>
              <SelectTrigger id="fp-who" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {separated.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {employeeFullName(e)} · separated {e.separationDate}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-3 gap-4">
            <Field>
              <FieldLabel htmlFor="fp-date">Pay date</FieldLabel>
              <Input id="fp-date" type="date" value={form.payDate} onChange={(e) => setForm((f) => ({ ...f, payDate: e.target.value }))} />
            </Field>
            <Field>
              <FieldLabel htmlFor="fp-vl">Unused VL days</FieldLabel>
              <Input id="fp-vl" type="number" min={0} step={0.5} value={form.vlDays} onChange={(e) => setForm((f) => ({ ...f, vlDays: Number(e.target.value) }))} />
            </Field>
            <Field>
              <FieldLabel htmlFor="fp-acc">Accountabilities (₱)</FieldLabel>
              <Input id="fp-acc" type="number" min={0} step="0.01" value={form.accountabilities} onChange={(e) => setForm((f) => ({ ...f, accountabilities: Number(e.target.value) }))} />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="fp-notes">Notes</FieldLabel>
            <Input id="fp-notes" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Clearance reference, items returned" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={go} disabled={saving || !form.employeeId}>
            {saving ? "Computing…" : "Compute"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdjustmentDialog({ periods, close, done }: { periods: PayPeriod[]; close: () => void; done: (runId: string, msg: string) => Promise<void> }) {
  const [periodId, setPeriodId] = React.useState(periods[0]?.id ?? "");
  const [reason, setReason] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  async function go() {
    setSaving(true);
    const r = await computeAdjustmentRun(periodId, reason);
    setSaving(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    await done(r.data!.runId, r.data!.count === 0 ? "Nothing changed for anyone; the run is empty." : `${r.data!.count} adjustment payslip(s) computed.`);
  }
  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjustment run</DialogTitle>
          <DialogDescription>Recomputes the period with the compensation rows and rate tables in force today and pays only the difference. The approved run is untouched.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="adj-period">Period</FieldLabel>
            <Select value={periodId} onValueChange={setPeriodId}>
              <SelectTrigger id="adj-period" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {periods.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {payPeriodLabel({ year: p.year, seq: p.seq, from: p.startsOn, to: p.endsOn, isSecondCutoff: p.seq % 2 === 0 })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="adj-reason">What changed</FieldLabel>
            <Input id="adj-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="NCR-27 in force from Jul 25; corrected rate for …" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={go} disabled={saving || !periodId || !reason.trim()}>
            {saving ? "Computing…" : "Compute"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
