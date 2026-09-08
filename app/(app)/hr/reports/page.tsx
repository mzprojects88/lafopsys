"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Download, Printer } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { HrSubNav } from "@/components/modules/hr/hr-subnav";
import { useYearPayslips, useYtdOpenings } from "@/lib/hooks/use-payroll-collections";
import { useEmployees } from "@/lib/hooks/use-employees-collection";
import { useHolidays } from "@/lib/hooks/use-hr-reference-collections";
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import { useNow } from "@/lib/hooks/use-now";
import { useRole } from "@/lib/rbac/use-role";
import { canManageHr } from "@/lib/rbac/roles";
import { dayKey } from "@/lib/utils/dtr";
import { formatDate } from "@/lib/utils/date";
import { formatAmount2, toCentavos } from "@/lib/utils/money";
import { downloadCsv } from "@/lib/utils/csv";
import { monthlyRemittanceDeadlines, yearEndDeadlines } from "@/lib/utils/compliance";
import { alphalistCsv, remittanceListCsv } from "./actions";
import { employeeFullName, type Employee } from "@/lib/types/hr";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * The government figures, from settled payslips: a month's remittances
 * (SSS, PhilHealth, Pag-IBIG) and 1601-C, the year's alphalist and 2316s,
 * the 13th month. On screen: names and amounts. The downloads that carry
 * SSS/PhilHealth/Pag-IBIG numbers and TINs are built on the server.
 */
export default function ReportsPage() {
  return (
    <React.Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
      <ReportsInner />
    </React.Suspense>
  );
}

function ReportsInner() {
  const params = useSearchParams();
  const { role, isHr } = useRole();
  const manages = canManageHr(role, isHr);
  const today = dayKey(useNow());
  const initial = params.get("month") && /^\d{4}-\d{2}$/.test(params.get("month")!) ? params.get("month")! : today.slice(0, 7);
  const [month, setMonth] = React.useState(initial);
  const year = Number(month.slice(0, 4));
  const { payslips, loading } = useYearPayslips(year);
  const { employees } = useEmployees();
  const { openings } = useYtdOpenings();
  const { holidays } = useHolidays();
  const settings = useAppSettings();
  const [busy, setBusy] = React.useState<string | null>(null);

  if (!manages) return <EmptyState title="HR only" description="Reports are for admins and HR." />;

  const byEmployee = new Map(employees.map((e) => [e.id, e]));
  const settled = payslips.filter((p) => ["approved", "paid", "closed"].includes(p.runStatus));
  const monthSlips = settled.filter((p) => p.periodStartsOn?.startsWith(month));
  const ctx = { penLastDigit: settings.compliancePenLastDigit, employerInitial: settings.complianceEmployerInitial, trackingFrom: settings.complianceTrackingFrom, holidays: holidays.map((h) => ({ date: h.date, kind: h.kind })) };
  const deadlines = monthlyRemittanceDeadlines(year, Number(month.slice(5, 7)), ctx);
  const due = (code: string) => deadlines.find((d) => d.code === code)?.dueOn ?? null;

  type Agg = { e: Employee | undefined; gross: number; taxable: number; nonTaxable: number; tax: number; sssEe: number; sssEr: number; ec: number; mpfEe: number; mpfEr: number; phEe: number; phEr: number; piEe: number; piEr: number; basic: number; thirteenth: number };
  const aggregate = (slips: typeof settled) => {
    const m = new Map<string, Agg>();
    for (const p of slips) {
      const a = m.get(p.employeeId) ?? { e: byEmployee.get(p.employeeId), gross: 0, taxable: 0, nonTaxable: 0, tax: 0, sssEe: 0, sssEr: 0, ec: 0, mpfEe: 0, mpfEr: 0, phEe: 0, phEr: 0, piEe: 0, piEr: 0, basic: 0, thirteenth: 0 };
      a.gross += p.gross;
      a.taxable += p.taxableGross;
      a.nonTaxable += p.nonTaxable;
      a.tax += p.taxWithheld;
      a.sssEe += p.sssEe;
      a.sssEr += p.sssEr;
      a.ec += p.ec;
      a.mpfEe += p.mpfEe;
      a.mpfEr += p.mpfEr;
      a.phEe += p.philhealthEe;
      a.phEr += p.philhealthEr;
      a.piEe += p.pagibigEe;
      a.piEr += p.pagibigEr;
      a.basic += p.basicEarned;
      a.thirteenth += p.lines.filter((l) => l.code.startsWith("thirteenth_month")).reduce((s, l) => s + l.amount / 100, 0);
      m.set(p.employeeId, a);
    }
    return [...m.values()].sort((x, y) => (x.e?.lastName ?? "").localeCompare(y.e?.lastName ?? ""));
  };
  const monthAgg = aggregate(monthSlips);
  const yearAgg = aggregate(settled);
  const sum = (rows: Agg[], pick: (a: Agg) => number) => rows.reduce((s, a) => s + toCentavos(pick(a)), 0);
  const peso = (v: number) => formatAmount2(toCentavos(v));

  // 13th month projection: opening basic + settled regular basic this year, / 12.
  const openingBy = new Map(openings.filter((o) => o.year === year).map((o) => [o.employeeId, o]));
  const active = employees.filter((e) => e.status === "active" || e.status === "on_leave");
  const thirteenth = active.map((e) => {
    const o = openingBy.get(e.id);
    const basic = (o?.basicEarned ?? 0) + settled.filter((p) => p.employeeId === e.id).reduce((s, p) => s + p.basicEarned, 0);
    const paid = (o?.thirteenthMonthPaid ?? 0) + settled.filter((p) => p.employeeId === e.id).reduce((s, p) => s + p.lines.filter((l) => l.code.startsWith("thirteenth_month")).reduce((t, l) => t + l.amount / 100, 0), 0);
    return { e, basic, projected: Math.round((basic / 12) * 100) / 100, paid };
  });

  async function download(kind: "sss" | "philhealth" | "pagibig" | "alphalist") {
    setBusy(kind);
    const r = kind === "alphalist" ? await alphalistCsv(year) : await remittanceListCsv(kind, month);
    setBusy(null);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    downloadCsv(r.data!.csv, r.data!.filename);
  }

  const months: string[] = [];
  for (let y = year - 1; y <= year; y++) for (let m = 1; m <= 12; m++) months.push(`${y}-${String(m).padStart(2, "0")}`);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Reports" description="Government figures from approved payroll. A payslip belongs to its run's year; a month is the pay periods that start in it." action={<HrSubNav />} />

      <div className="flex flex-wrap items-center gap-2">
        <Select value={month} onValueChange={setMonth}>
          <SelectTrigger className="w-48" aria-label="Month">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {months
              .filter((m) => m <= today.slice(0, 7))
              .reverse()
              .map((m) => (
                <SelectItem key={m} value={m}>
                  {MONTHS[Number(m.slice(5, 7)) - 1]} {m.slice(0, 4)}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          {loading ? "Loading…" : `${monthSlips.length} settled payslip(s) in ${MONTHS[Number(month.slice(5, 7)) - 1]}`}
        </span>
      </div>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">
            Monthly remittances · {MONTHS[Number(month.slice(5, 7)) - 1]} {year}
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => download("sss")} disabled={busy !== null || monthAgg.length === 0}>
              <Download className="size-3.5" />
              SSS list{due("sss_prn") ? ` · due ${formatDate(due("sss_prn")!, "MMM d")}` : ""}
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => download("philhealth")} disabled={busy !== null || monthAgg.length === 0}>
              <Download className="size-3.5" />
              PhilHealth list{due("philhealth_eprs") ? ` · due ${formatDate(due("philhealth_eprs")!, "MMM d")}` : ""}
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => download("pagibig")} disabled={busy !== null || monthAgg.length === 0}>
              <Download className="size-3.5" />
              Pag-IBIG list{due("pagibig_mcrf") ? ` · due ${formatDate(due("pagibig_mcrf")!, "MMM d")}` : ""}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {monthAgg.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No approved payroll for this month yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead className="text-right">SSS EE</TableHead>
                  <TableHead className="text-right">SSS ER + EC</TableHead>
                  <TableHead className="text-right">MPF EE / ER</TableHead>
                  <TableHead className="text-right">PhilHealth EE / ER</TableHead>
                  <TableHead className="text-right">Pag-IBIG EE / ER</TableHead>
                  <TableHead className="text-right">Total to remit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {monthAgg.map((a, i) => (
                  <TableRow key={a.e?.id ?? i}>
                    <TableCell>{a.e ? employeeFullName(a.e) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{peso(a.sssEe)}</TableCell>
                    <TableCell className="text-right tabular-nums">{peso(a.sssEr + a.ec)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {peso(a.mpfEe)} / {peso(a.mpfEr)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {peso(a.phEe)} / {peso(a.phEr)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {peso(a.piEe)} / {peso(a.piEr)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{peso(a.sssEe + a.sssEr + a.ec + a.mpfEe + a.mpfEr + a.phEe + a.phEr + a.piEe + a.piEr)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-medium">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right tabular-nums">{formatAmount2(sum(monthAgg, (a) => a.sssEe))}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatAmount2(sum(monthAgg, (a) => a.sssEr + a.ec))}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatAmount2(sum(monthAgg, (a) => a.mpfEe))} / {formatAmount2(sum(monthAgg, (a) => a.mpfEr))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatAmount2(sum(monthAgg, (a) => a.phEe))} / {formatAmount2(sum(monthAgg, (a) => a.phEr))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatAmount2(sum(monthAgg, (a) => a.piEe))} / {formatAmount2(sum(monthAgg, (a) => a.piEr))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatAmount2(sum(monthAgg, (a) => a.sssEe + a.sssEr + a.ec + a.mpfEe + a.mpfEr + a.phEe + a.phEr + a.piEe + a.piEr))}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            BIR 1601-C · {MONTHS[Number(month.slice(5, 7)) - 1]} {year}
            {due("bir_1601c") ? <span className="text-xs font-normal text-muted-foreground"> · due {formatDate(due("bir_1601c")!)}</span> : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
          <Figure label="Employees paid" value={String(monthAgg.length)} />
          <Figure label="Total compensation" value={formatAmount2(sum(monthAgg, (a) => a.gross))} />
          <Figure label="Non-taxable (de minimis, 13th, contributions)" value={formatAmount2(sum(monthAgg, (a) => a.nonTaxable + a.sssEe + a.mpfEe + a.phEe + a.piEe))} />
          <Figure label="Taxable compensation" value={formatAmount2(sum(monthAgg, (a) => a.taxable - a.sssEe - a.mpfEe - a.phEe - a.piEe))} />
          <Figure label="Tax withheld" value={formatAmount2(sum(monthAgg, (a) => a.tax))} strong />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">Year {year} · 1604-C, alphalist, 2316</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">{yearEndDeadlines(year, ctx).map((d) => `${d.label} ${formatDate(d.dueOn, "MMM d")}`).slice(2, 4).join(" · ")}</span>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => download("alphalist")} disabled={busy !== null || (yearAgg.length === 0 && openings.length === 0)}>
              <Download className="size-3.5" />
              Alphalist CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {yearAgg.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No approved payroll in {year} yet. Opening figures entered under Payroll still feed the alphalist and 2316.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Non-taxable</TableHead>
                  <TableHead className="text-right">EE contributions</TableHead>
                  <TableHead className="text-right">Tax withheld</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {yearAgg.map((a, i) => (
                  <TableRow key={a.e?.id ?? i}>
                    <TableCell>{a.e ? employeeFullName(a.e) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{peso(a.gross)}</TableCell>
                    <TableCell className="text-right tabular-nums">{peso(a.nonTaxable)}</TableCell>
                    <TableCell className="text-right tabular-nums">{peso(a.sssEe + a.mpfEe + a.phEe + a.piEe)}</TableCell>
                    <TableCell className="text-right tabular-nums">{peso(a.tax)}</TableCell>
                    <TableCell className="text-right">
                      {a.e ? (
                        <Button asChild size="sm" variant="ghost" aria-label="2316">
                          <Link href={`/hr/reports/2316/${a.e.id}/${year}`} target="_blank">
                            <Printer className="size-3.5" />
                            2316
                          </Link>
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            13th month {year} · pay by Dec 24, DOLE report by {formatDate(yearEndDeadlines(year, ctx)[1].dueOn)}
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead className="text-right">Basic earned so far</TableHead>
                <TableHead className="text-right">÷ 12</TableHead>
                <TableHead className="text-right">Paid</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {thirteenth.map((t) => (
                <TableRow key={t.e.id}>
                  <TableCell>{employeeFullName(t.e)}</TableCell>
                  <TableCell className="text-right tabular-nums">{peso(t.basic)}</TableCell>
                  <TableCell className="text-right tabular-nums">{peso(t.projected)}</TableCell>
                  <TableCell className="text-right tabular-nums">{peso(t.paid)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="font-medium">
                <TableCell>Total</TableCell>
                <TableCell className="text-right tabular-nums">{formatAmount2(thirteenth.reduce((s, t) => s + toCentavos(t.basic), 0))}</TableCell>
                <TableCell className="text-right tabular-nums">{formatAmount2(thirteenth.reduce((s, t) => s + toCentavos(t.projected), 0))}</TableCell>
                <TableCell className="text-right tabular-nums">{formatAmount2(thirteenth.reduce((s, t) => s + toCentavos(t.paid), 0))}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border px-3 py-2.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`tabular-nums ${strong ? "text-lg font-bold" : "font-medium"}`}>{value}</span>
    </div>
  );
}
