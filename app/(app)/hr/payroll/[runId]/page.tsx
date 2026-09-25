"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Check, Download, RefreshCw, Banknote, XCircle, Printer, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { StatusBadge } from "@/components/patterns/status-badge";
import { ReasonDialog } from "@/components/patterns/reason-dialog";
import { SectionCard } from "@/components/patterns/section-card";
import { LoadingState } from "@/components/patterns/loading-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { HrSubNav } from "@/components/modules/hr/hr-subnav";
import { usePayrollRuns, useRunPayslips, payrollRunsStore, payslipsFamily } from "@/lib/hooks/use-payroll-collections";
import { usePayPeriods, payPeriodsStore } from "@/lib/hooks/use-pay-periods-collection";
import { useEmployees } from "@/lib/hooks/use-employees-collection";
import { useStaffRoster } from "@/lib/hooks/use-staff-roster";
import { useRole } from "@/lib/rbac/use-role";
import { canManageHr } from "@/lib/rbac/roles";
import { useNow } from "@/lib/hooks/use-now";
import { dayKey } from "@/lib/utils/dtr";
import { formatDate } from "@/lib/utils/date";
import { formatAmount2, toCentavos } from "@/lib/utils/money";
import { csvLines, downloadCsv } from "@/lib/utils/csv";
import { payPeriodKey, payPeriodLabel } from "@/lib/utils/pay-period";
import { approvePayrollRun, cancelPayrollRun, computeAdjustmentRun, computeRegularRun, computeThirteenthMonthRun, markPayrollRunPaid } from "../actions";
import { employeeFullName, PAYROLL_RUN_KINDS, type Payslip } from "@/lib/types/hr";

/** Inventory table look: header and body cells. */
const TH = "h-11 px-5 text-theme-xs font-medium text-muted-foreground";
const TD = "px-5 py-3";

const WARNING_LABEL: Record<string, string> = {
  below_minimum_wage: "Below minimum wage",
  mwe_flag_mismatch: "MWE flag does not match the rate",
  negative_net: "Negative net",
  no_approved_timesheet: "No approved timesheet: paid as a full period",
  missed_punches: "Missed punches in the timesheet",
  approver_is_payee: "The person computing is on this payroll",
  projected_basic: "Cutoffs not yet paid were projected at the current basic",
};

/**
 * The payroll register for one run (Labor Code Book III Rule X s.6: name,
 * rate, hours, gross, every deduction, net), with the run's actions:
 * recompute while draft, approve (a second person, or a logged waiver),
 * mark paid with the bank reference, cancel before approval, CSV.
 */
export default function PayrollRunPage() {
  const { runId } = useParams<{ runId: string }>();
  const { role, isHr, staffId } = useRole();
  const manages = canManageHr(role, isHr);
  const { runs, loading: runsLoading } = usePayrollRuns();
  const { payslips, loading } = useRunPayslips(runId);
  const { periods } = usePayPeriods();
  const { employees } = useEmployees();
  const { staff } = useStaffRoster();
  const today = dayKey(useNow());
  const [busy, setBusy] = React.useState<string | null>(null);
  const [approving, setApproving] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const [paying, setPaying] = React.useState(false);

  if (!manages) return <EmptyState title="HR only" description="Payroll runs are for admins and HR." />;
  const run = runs.find((r) => r.id === runId);
  if (!run) return runsLoading ? <LoadingState /> : <EmptyState title="No such run" description="It may have been cancelled." />;

  const period = run.periodId ? periods.find((p) => p.id === run.periodId) : null;
  const byEmployee = new Map(employees.map((e) => [e.id, e]));
  const staffName = (id: string | null) => {
    const s = id ? staff.find((x) => x.id === id) : null;
    return s ? `${s.firstName} ${s.lastName}` : "someone";
  };
  const title = period ? payPeriodLabel({ year: period.year, seq: period.seq, from: period.startsOn, to: period.endsOn, isSecondCutoff: period.seq % 2 === 0 }) : `${PAYROLL_RUN_KINDS[run.kind]} ${run.label ?? run.year}`;
  const editable = run.status === "draft" || run.status === "computed";
  const t = run.totals as Record<string, number | undefined>;
  const skipped = (run.totals.skipped as { employeeId: string; employeeCode: string; reason: string }[] | undefined) ?? [];
  const sorted = [...payslips].sort((a, b) => {
    const ea = byEmployee.get(a.employeeId);
    const eb = byEmployee.get(b.employeeId);
    return (ea?.lastName ?? "").localeCompare(eb?.lastName ?? "");
  });

  async function refresh() {
    await Promise.all([payrollRunsStore.refetch(), payslipsFamily.get(runId).refetch(), payPeriodsStore.refetch()]);
  }

  async function recompute() {
    if (!run) return;
    setBusy("compute");
    const r =
      run.kind === "regular" && run.periodId
        ? await computeRegularRun(run.periodId)
        : run.kind === "thirteenth_month"
          ? await computeThirteenthMonthRun(run.year, sorted[0]?.payDate ?? today)
          : run.kind === "adjustment" && run.periodId
            ? await computeAdjustmentRun(run.periodId, run.notes ?? "recompute")
            : { ok: false as const, error: "Recompute final pay from the Payroll page." };
    setBusy(null);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    await refresh();
    toast.success(`${r.data!.count} payslip(s) recomputed.`);
  }

  async function approve(waiver: string | null) {
    setApproving(false);
    setBusy("approve");
    const r = await approvePayrollRun(runId, waiver);
    setBusy(null);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    await refresh();
    toast.success("Run approved. Payslips are now locked.");
  }

  async function cancel(reason: string) {
    setCancelling(false);
    setBusy("cancel");
    const r = await cancelPayrollRun(runId, reason);
    setBusy(null);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    await refresh();
    toast.success("Run cancelled.");
  }

  function exportCsv() {
    const header = ["Employee ID", "Employee", "Position", "Basis", "Basic earned", "Gross", "Taxable", "Non-taxable", "SSS EE", "MPF EE", "PhilHealth EE", "Pag-IBIG EE", "Tax", "Other deductions", "Total deductions", "Net", "SSS ER", "EC", "MPF ER", "PhilHealth ER", "Pag-IBIG ER", "Warnings"];
    const rows = sorted.map((p) => {
      const e = byEmployee.get(p.employeeId);
      const other = p.totalDeductions - p.sssEe - p.mpfEe - p.philhealthEe - p.pagibigEe - p.taxWithheld;
      return [
        e?.employeeCode ?? "",
        e ? employeeFullName(e) : "",
        e?.position ?? "",
        p.payBasis,
        ...[p.basicEarned, p.gross, p.taxableGross, p.nonTaxable, p.sssEe, p.mpfEe, p.philhealthEe, p.pagibigEe, p.taxWithheld, other, p.totalDeductions, p.net, p.sssEr, p.ec, p.mpfEr, p.philhealthEr, p.pagibigEr].map((n) => n.toFixed(2)),
        p.warnings.map((w) => WARNING_LABEL[w] ?? w).join("; "),
      ];
    });
    downloadCsv(csvLines(header, rows), `payroll-${period ? payPeriodKey(period) : runId.slice(0, 8)}.csv`);
  }

  const computedByMe = run.computedBy !== null && run.computedBy === staffId;
  const sum = (pick: (p: Payslip) => number) => sorted.reduce((a, p) => a + toCentavos(pick(p)), 0);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title={title}
        description={`${PAYROLL_RUN_KINDS[run.kind]}${period ? ` · pay date ${formatDate(period.payDate)}` : ""}`}
        action={<HrSubNav />}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="ghost" className="gap-1.5">
            <Link href="/hr/payroll">
              <ArrowLeft className="size-3.5" />
              Payroll
            </Link>
          </Button>
          <StatusBadge dot domain="payrollRun" status={run.status} />
          <span className="text-theme-xs text-muted-foreground">
            {run.computedAt ? `computed ${formatDate(run.computedAt, "MMM d, HH:mm")} by ${staffName(run.computedBy)}` : "not computed"}
            {run.approvedAt ? ` · approved ${formatDate(run.approvedAt, "MMM d, HH:mm")} by ${staffName(run.approvedBy)}${run.segregationWaiver ? " (waiver)" : ""}` : ""}
            {run.paidOn ? ` · paid ${formatDate(run.paidOn)}${run.paidReference ? ` ref ${run.paidReference}` : ""}` : ""}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={exportCsv} disabled={sorted.length === 0}>
            <Download className="size-3.5" />
            Register CSV
          </Button>
          {editable && run.kind !== "final_pay" ? (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={recompute} disabled={busy !== null}>
              <RefreshCw className="size-3.5" />
              {busy === "compute" ? "Computing…" : "Recompute"}
            </Button>
          ) : null}
          {editable ? (
            <Button size="sm" variant="destructive" className="gap-1.5" onClick={() => setCancelling(true)} disabled={busy !== null}>
              <XCircle className="size-3.5" />
              Cancel run
            </Button>
          ) : null}
          {run.status === "computed" ? (
            <Button size="sm" className="gap-1.5" onClick={() => setApproving(true)} disabled={busy !== null || sorted.length === 0}>
              <Check className="size-3.5" />
              Approve
            </Button>
          ) : null}
          {run.status === "approved" ? (
            <Button size="sm" className="gap-1.5" onClick={() => setPaying(true)} disabled={busy !== null}>
              <Banknote className="size-3.5" />
              Mark paid
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Payslips" value={String(sorted.length)} />
        <Stat label="Gross" value={`₱${formatAmount2(sum((p) => p.gross))}`} />
        <Stat label="Deductions" value={`₱${formatAmount2(sum((p) => p.totalDeductions))}`} />
        <Stat label="Net to pay" value={`₱${formatAmount2(sum((p) => p.net))}`} strong />
      </div>

      {skipped.length > 0 ? (
        <div className="flex items-start gap-2 rounded-2xl border border-warning/30 bg-warning/10 px-5 py-3 text-theme-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-foreground dark:text-warning" />
            <div>
              <span className="font-medium">Not on this run: </span>
              {skipped.map((s) => `${byEmployee.get(s.employeeId) ? employeeFullName(byEmployee.get(s.employeeId)!) : s.employeeCode} (${s.reason.toLowerCase()})`).join("; ")}. Set their compensation on the employee page and recompute.
            </div>
        </div>
      ) : null}

      <SectionCard title="Register" flush>
          {loading ? (
            <div className="p-5">
              <LoadingState />
            </div>
          ) : sorted.length === 0 ? (
            <p className="px-5 py-4 text-theme-sm text-muted-foreground">No payslips. Recompute once compensation and timesheets are in place.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className={TH}>Employee</TableHead>
                  <TableHead className={`${TH} text-right`}>Basic earned</TableHead>
                  <TableHead className={`${TH} text-right`}>Gross</TableHead>
                  <TableHead className={`${TH} text-right`}>SSS</TableHead>
                  <TableHead className={`${TH} text-right`}>PhilHealth</TableHead>
                  <TableHead className={`${TH} text-right`}>Pag-IBIG</TableHead>
                  <TableHead className={`${TH} text-right`}>Tax</TableHead>
                  <TableHead className={`${TH} text-right`}>Other</TableHead>
                  <TableHead className={`${TH} text-right`}>Net</TableHead>
                  <TableHead className={`${TH} text-right`}>Employer</TableHead>
                  <TableHead className={TH} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((p) => {
                  const e = byEmployee.get(p.employeeId);
                  const other = p.totalDeductions - p.sssEe - p.mpfEe - p.philhealthEe - p.pagibigEe - p.taxWithheld;
                  return (
                    <TableRow key={p.id} className="text-theme-sm hover:bg-muted/60">
                      <TableCell className={TD}>
                        <div className="flex flex-col">
                          <span className="font-medium">{e ? employeeFullName(e) : p.employeeId}</span>
                          <span className="text-theme-xs text-muted-foreground">
                            {e?.employeeCode} · {p.payBasis === "daily" ? "daily" : "monthly"}
                            {p.warnings.length ? ` · ${p.warnings.map((w) => WARNING_LABEL[w] ?? w).join("; ")}` : ""}
                          </span>
                        </div>
                      </TableCell>
                      <Money v={p.basicEarned} />
                      <Money v={p.gross} />
                      <Money v={p.sssEe + p.mpfEe} />
                      <Money v={p.philhealthEe} />
                      <Money v={p.pagibigEe} />
                      <Money v={p.taxWithheld} />
                      <Money v={other} />
                      <Money v={p.net} strong />
                      <Money v={p.employerTotal} muted />
                      <TableCell className={`${TD} text-right`}>
                        <Button asChild size="sm" variant="ghost" aria-label="Payslip">
                          <Link href={`/hr/payslips/${p.id}/print`} target="_blank">
                            <Printer className="size-3.5" />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                <TableRow className="text-theme-sm font-medium hover:bg-transparent">
                  <TableCell className={TD}>Total</TableCell>
                  <Money v={sum((p) => p.basicEarned) / 100} />
                  <Money v={sum((p) => p.gross) / 100} />
                  <Money v={sum((p) => p.sssEe + p.mpfEe) / 100} />
                  <Money v={sum((p) => p.philhealthEe) / 100} />
                  <Money v={sum((p) => p.pagibigEe) / 100} />
                  <Money v={sum((p) => p.taxWithheld) / 100} />
                  <Money v={sum((p) => p.totalDeductions - p.sssEe - p.mpfEe - p.philhealthEe - p.pagibigEe - p.taxWithheld) / 100} />
                  <Money v={sum((p) => p.net) / 100} strong />
                  <Money v={sum((p) => p.employerTotal) / 100} muted />
                  <TableCell className={TD} />
                </TableRow>
              </TableBody>
            </Table>
          )}
      </SectionCard>

      {run.rateSnapshot.length > 0 ? (
        <p className="text-theme-xs text-muted-foreground">
          Tables used: {run.rateSnapshot.map((s) => `${s.kind} from ${formatDate(s.effectiveFrom)}`).join(" · ")}
          {t.employerTotal !== undefined ? ` · employer shares ₱${formatAmount2(toCentavos(t.employerTotal))}` : ""}
        </p>
      ) : null}

      <ReasonDialog
        open={approving}
        onOpenChange={setApproving}
        title="Approve this run"
        description={
          computedByMe
            ? "You computed this run. The rule is that a second person approves; if nobody else can, write why and it is logged as a waiver."
            : `Approving locks ${sorted.length} payslip(s). Corrections after this are a separate adjustment run.`
        }
        confirmLabel="Approve"
        requireReason={Boolean(computedByMe)}
        onConfirm={(reason) => approve(computedByMe ? reason : null)}
      />
      <ReasonDialog open={cancelling} onOpenChange={setCancelling} title="Cancel this run" description="The payslips are discarded and the period goes back to timesheets approved." confirmLabel="Cancel run" requireReason destructive onConfirm={cancel} />
      {paying ? <MarkPaidDialog runId={runId} today={today} defaultDate={period?.payDate ?? today} close={() => setPaying(false)} onDone={refresh} /> : null}
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-2xl border border-border bg-card px-5 py-4">
      <span className="text-theme-xs text-muted-foreground">{label}</span>
      <span className={`tabular-nums ${strong ? "text-lg font-semibold" : "font-medium"}`}>{value}</span>
    </div>
  );
}

function Money({ v, strong, muted }: { v: number; strong?: boolean; muted?: boolean }) {
  return <TableCell className={`${TD} text-right tabular-nums ${strong ? "font-semibold" : ""} ${muted ? "text-muted-foreground" : ""}`}>{formatAmount2(toCentavos(v))}</TableCell>;
}

function MarkPaidDialog({ runId, today, defaultDate, close, onDone }: { runId: string; today: string; defaultDate: string; close: () => void; onDone: () => Promise<void> }) {
  const [paidOn, setPaidOn] = React.useState(defaultDate <= today ? defaultDate : today);
  const [reference, setReference] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  async function handleSave() {
    setSaving(true);
    const r = await markPayrollRunPaid(runId, { paidOn, reference });
    setSaving(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    await onDone();
    toast.success("Marked paid.");
    close();
  }

  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark paid</DialogTitle>
          <DialogDescription>Record the day the net amounts were transferred and the bank&apos;s reference. Paying itself stays a bank transfer.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <Field>
            <FieldLabel htmlFor="mp-date">Paid on</FieldLabel>
            <Input id="mp-date" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="mp-ref">Bank reference</FieldLabel>
            <Input id="mp-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Batch no., memo" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Mark paid"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
