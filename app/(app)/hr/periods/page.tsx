"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CalendarPlus, Pencil } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HrSubNav } from "@/components/modules/hr/hr-subnav";
import { usePayPeriods, payPeriodsStore } from "@/lib/hooks/use-pay-periods-collection";
import { useNow } from "@/lib/hooks/use-now";
import { useRole } from "@/lib/rbac/use-role";
import { canManageHr } from "@/lib/rbac/roles";
import { dayKey } from "@/lib/utils/dtr";
import { formatDate } from "@/lib/utils/date";
import { payPeriodKey, payPeriodLabel } from "@/lib/utils/pay-period";
import { generatePayPeriods, updatePayPeriod } from "./actions";
import { PAY_PERIOD_STATUSES, type PayPeriod } from "@/lib/types/hr";

const STATUS_LABEL = Object.fromEntries(PAY_PERIOD_STATUSES.map((s) => [s.value, s.label]));

/** The semi-monthly calendar: cutoffs, pay dates and where each period is in its life. */
export default function PayPeriodsPage() {
  const { role, isHr } = useRole();
  const { periods, loading, error } = usePayPeriods();
  const today = dayKey(useNow());
  const thisYear = Number(today.slice(0, 4));
  const [year, setYear] = React.useState(String(thisYear));
  const [generating, setGenerating] = React.useState(false);
  const [editing, setEditing] = React.useState<PayPeriod | null>(null);

  if (!canManageHr(role, isHr)) return <EmptyState title="HR only" description="Pay periods are managed by admins and HR." />;

  const years = Array.from(new Set([String(thisYear), String(thisYear + 1), ...periods.map((p) => String(p.year))])).sort();
  const rows = periods.filter((p) => String(p.year) === year).sort((a, b) => a.seq - b.seq);
  const current = periods.find((p) => p.startsOn <= today && p.endsOn >= today);

  async function generate() {
    setGenerating(true);
    const result = await generatePayPeriods(Number(year));
    setGenerating(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    await payPeriodsStore.refetch();
    toast.success(result.data?.created ? `${result.data.created} periods created for ${year}.` : `${year} already has all its periods.`);
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Pay Periods" description="Semi-monthly cutoffs (1st–15th, 16th–end) and their pay dates — at least twice a month, never more than sixteen days apart (Art. 103)." action={<HrSubNav />} />

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">
            {current ? (
              <>
                Current period: {payPeriodLabel({ year: current.year, seq: current.seq, from: current.startsOn, to: current.endsOn, isSecondCutoff: current.seq % 2 === 0 })} · pay date {formatDate(current.payDate)}
              </>
            ) : (
              "No period covers today — generate the year."
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger className="w-28" aria-label="Year">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={y}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" className="gap-1.5" disabled={generating || rows.length === 24} onClick={generate}>
              <CalendarPlus className="size-3.5" />
              {generating ? "Generating…" : rows.length === 24 ? "All 24 exist" : `Generate ${year}`}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5">
          {error ? (
            <p className="text-sm text-rose-700">{error}</p>
          ) : loading && periods.length === 0 ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No periods for {year}. Generating uses the pay-date rule from Settings; pay dates can be adjusted afterwards.</p>
          ) : (
            rows.map((p) => {
              const isCurrent = p.id === current?.id;
              return (
                <div key={p.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm ${isCurrent ? "border-primary/40 bg-primary/5" : ""}`}>
                  <div className="flex min-w-0 flex-col">
                    <span className="font-medium">
                      {payPeriodLabel({ year: p.year, seq: p.seq, from: p.startsOn, to: p.endsOn, isSecondCutoff: p.seq % 2 === 0 })}
                      <span className="text-xs text-muted-foreground"> · {payPeriodKey(p)}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Pay date {formatDate(p.payDate, "EEE, MMM d")}
                      {p.notes ? ` — ${p.notes}` : ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <StatusBadge dot domain="payPeriod" status={p.status} label={STATUS_LABEL[p.status]} />
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/hr/timesheets?period=${p.id}`}>Timesheets</Link>
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label="Edit pay date" onClick={() => setEditing(p)} disabled={p.status === "paid" || p.status === "closed"}>
                      <Pencil className="size-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {editing ? <EditPeriodDialog key={editing.id} period={editing} close={() => setEditing(null)} /> : null}
    </div>
  );
}

function EditPeriodDialog({ period, close }: { period: PayPeriod; close: () => void }) {
  const [payDate, setPayDate] = React.useState(period.payDate);
  const [notes, setNotes] = React.useState(period.notes ?? "");
  const [saving, setSaving] = React.useState(false);

  async function handleSave() {
    setSaving(true);
    const result = await updatePayPeriod(period.id, { payDate, notes });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    await payPeriodsStore.refetch();
    toast.success("Period updated.");
    close();
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{payPeriodLabel({ year: period.year, seq: period.seq, from: period.startsOn, to: period.endsOn, isSecondCutoff: period.seq % 2 === 0 })}</DialogTitle>
          <DialogDescription>Cutoff dates are fixed; the pay date and a note can change.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="pp-date">Pay date</FieldLabel>
            <Input id="pp-date" type="date" value={payDate} min={period.endsOn} onChange={(e) => setPayDate(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="pp-notes">Notes</FieldLabel>
            <Input id="pp-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Bank holiday, moved earlier…" />
          </Field>
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
