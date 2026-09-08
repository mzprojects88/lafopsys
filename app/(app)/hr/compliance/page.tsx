"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle, CalendarClock, CheckCircle2, ClipboardList, ExternalLink, Pencil, Users } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { StatusBadge } from "@/components/patterns/status-badge";
import { KpiCard } from "@/components/patterns/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HrSubNav } from "@/components/modules/hr/hr-subnav";
import { FilingDialog } from "@/components/modules/hr/filing-dialog";
import { ComplianceItemDialog } from "@/components/modules/hr/compliance-item-dialog";
import { useComplianceItems, useComplianceFilings, complianceItemsStore } from "@/lib/hooks/use-compliance-collections";
import { useHolidays } from "@/lib/hooks/use-hr-reference-collections";
import { useEmployees } from "@/lib/hooks/use-employees-collection";
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import { useNow } from "@/lib/hooks/use-now";
import { useRole } from "@/lib/rbac/use-role";
import { canManageHr } from "@/lib/rbac/roles";
import { dayKey, addDays } from "@/lib/utils/dtr";
import { formatDate } from "@/lib/utils/date";
import { complianceCalendar, headcountThresholds, PAYROLL_ITEM_CODES, type CalendarEntry, type ComplianceContext } from "@/lib/utils/compliance";
import { setComplianceItemActive } from "./actions";
import { COMPLIANCE_CATEGORIES, type ComplianceFiling, type ComplianceItem } from "@/lib/types/hr";

const PAYROLL_CODES = new Set<string>(Object.values(PAYROLL_ITEM_CODES));

/**
 * The compliance calendar: every government obligation with a date, what
 * is due, what was filed, and the switches for the conditional ones. The
 * remittance items link to the month's figures under Reports.
 */
export default function CompliancePage() {
  const { role, isHr } = useRole();
  const manages = canManageHr(role, isHr);
  const { items, loading } = useComplianceItems();
  const { filings } = useComplianceFilings();
  const { holidays } = useHolidays();
  const { employees } = useEmployees();
  const settings = useAppSettings();
  const today = dayKey(useNow());
  const [range, setRange] = React.useState<"90" | "year" | "past">("90");
  const [category, setCategory] = React.useState<string>("all");
  const [recording, setRecording] = React.useState<CalendarEntry<ComplianceFiling, ComplianceItem> | null>(null);
  const [editing, setEditing] = React.useState<ComplianceItem | "new" | null>(null);

  if (!manages) return <EmptyState title="HR only" description="The compliance calendar is kept by admins and HR." />;

  const ctx: ComplianceContext = {
    penLastDigit: settings.compliancePenLastDigit,
    employerInitial: settings.complianceEmployerInitial,
    trackingFrom: settings.complianceTrackingFrom,
    holidays: holidays.map((h) => ({ date: h.date, kind: h.kind })),
  };
  const year = Number(today.slice(0, 4));
  // Window over PERIODS: a year back so overdue items still show, a year ahead for annual ones.
  const window = { from: `${year - 1}-01-01`, to: `${year + 1}-12-31` };
  const all = complianceCalendar(items, filings, window, ctx, today);
  const overdue = all.filter((e) => e.status === "overdue");
  const soon = all.filter((e) => e.status === "due_soon" || e.status === "in_progress");
  const filedThisYear = all.filter((e) => (e.status === "filed" || e.status === "late") && e.filing?.filedOn?.startsWith(String(year)));
  const shown = all
    .filter((e) => {
      if (category !== "all" && e.item.category !== category) return false;
      if (range === "past") return e.dueOn < today;
      if (range === "90") return e.dueOn >= today && e.dueOn <= addDays(today, 90);
      return e.dueOn.startsWith(String(year));
    })
    .concat(range === "90" ? overdue.filter((e) => category === "all" || e.item.category === category) : [])
    .sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : 0));
  const active = employees.filter((e) => e.status === "active" || e.status === "on_leave").length;
  const thresholds = headcountThresholds(active);
  const missingSettings = settings.compliancePenLastDigit === null || !settings.complianceEmployerInitial;

  async function toggle(item: ComplianceItem) {
    const r = await setComplianceItemActive(item.id, !item.active);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    await complianceItemsStore.refetch();
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Compliance" description="Every government deadline the foundation carries, from the compliance list, with what has been filed." action={<HrSubNav />} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Overdue" value={loading ? "…" : overdue.length} icon={AlertTriangle} color="rose" sublabel="Past the due date, not filed" />
        <KpiCard label="Due within 14 days" value={loading ? "…" : soon.length} icon={CalendarClock} color="amber" sublabel="Including those in progress" />
        <KpiCard label={`Filed ${year}`} value={loading ? "…" : filedThisYear.length} icon={CheckCircle2} color="green" sublabel="With reference numbers" />
        <KpiCard label="Headcount" value={active} icon={Users} color="blue" sublabel={`${thresholds.silExempt ? "SIL-exempt (<10)" : "SIL applies (10+)"} · OSH tier ${thresholds.oshTier}`} />
      </div>

      {missingSettings ? (
        <Card>
          <CardContent className="flex items-start gap-2 pt-6 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <div>
              PhilHealth and Pag-IBIG dates need the PEN&apos;s last digit and the employer&apos;s first letter.{" "}
              <Link href="/settings" className="underline">
                Set them in Settings
              </Link>
              .
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Select value={range} onValueChange={(v) => setRange(v as typeof range)}>
          <SelectTrigger className="w-44" aria-label="Range">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="90">Next 90 days + overdue</SelectItem>
            <SelectItem value="year">Due in {year}</SelectItem>
            <SelectItem value="past">Past deadlines</SelectItem>
          </SelectContent>
        </Select>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-44" aria-label="Category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {COMPLIANCE_CATEGORIES.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Deadlines</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : shown.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing in this range.</p>
          ) : (
            shown.map((e) => (
              <div key={`${e.itemId}|${e.periodKey}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-sm">
                <div className="flex min-w-0 flex-col">
                  <span className="font-medium">
                    {e.item.agency} · {e.item.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {e.item.form ? `${e.item.form} · ` : ""}
                    {e.periodLabel} · due {formatDate(e.dueOn)}
                    {e.dueRaw !== e.dueOn ? ` (rolled from ${formatDate(e.dueRaw, "MMM d")})` : ""}
                    {e.filing?.referenceNo ? ` · ref ${e.filing.referenceNo}` : ""}
                    {e.filing?.filedOn ? ` · filed ${formatDate(e.filing.filedOn)}` : ""}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusBadge dot domain="compliance" status={e.status} label={e.status === "due" ? `${e.daysLeft} d` : e.status === "due_soon" ? `${e.daysLeft} d left` : e.status === "overdue" ? `${-e.daysLeft} d late` : undefined} />
                  {PAYROLL_CODES.has(e.code) && /^\d{4}-\d{2}$/.test(e.periodKey) ? (
                    <Button asChild size="sm" variant="ghost">
                      <Link href={`/hr/reports?month=${e.periodKey}`}>Figures</Link>
                    </Button>
                  ) : null}
                  {e.item.portalUrl ? (
                    <Button asChild size="sm" variant="ghost" aria-label="Portal">
                      <a href={e.item.portalUrl} target="_blank" rel="noreferrer">
                        <ExternalLink className="size-3.5" />
                      </a>
                    </Button>
                  ) : null}
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setRecording(e)}>
                    <ClipboardList className="size-3.5" />
                    {e.filing ? "Update" : "Record"}
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">Obligations</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
            Add obligation
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {items.map((i) => (
            <div key={i.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm ${i.active ? "" : "opacity-60"}`}>
              <div className="flex min-w-0 flex-col">
                <span className="font-medium">
                  {i.agency} · {i.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {i.form ? `${i.form} · ` : ""}
                  {i.frequency.replace("_", " ")} · {i.applies === "yes" ? "applies" : i.applies === "if_employees" ? "applies with employees" : i.applies === "conditional" ? "conditional" : "not required"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {i.applies !== "not_required" ? <Switch checked={i.active} onCheckedChange={() => toggle(i)} aria-label={`${i.name} active`} /> : null}
                <Button size="sm" variant="ghost" onClick={() => setEditing(i)} aria-label="Edit">
                  <Pencil className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {recording ? <FilingDialog key={`${recording.itemId}|${recording.periodKey}`} entry={recording} close={() => setRecording(null)} /> : null}
      {editing ? <ComplianceItemDialog key={editing === "new" ? "new" : editing.id} item={editing === "new" ? null : editing} close={() => setEditing(null)} /> : null}
    </div>
  );
}
