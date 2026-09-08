"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle, CalendarClock, CheckCircle2, ClipboardList, ExternalLink, FileSpreadsheet, Pencil, TimerOff } from "lucide-react";
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
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import { useNow } from "@/lib/hooks/use-now";
import { useRole } from "@/lib/rbac/use-role";
import { canManageHr, canRecordComplianceFilings, canViewCompliance } from "@/lib/rbac/roles";
import { dayKey, addDays } from "@/lib/utils/dtr";
import { formatDate } from "@/lib/utils/date";
import { complianceCalendar, reportSourceFor, type CalendarEntry, type CalendarStatus, type ComplianceContext } from "@/lib/utils/compliance";
import { setComplianceItemActive } from "./actions";
import { COMPLIANCE_CATEGORIES, type ComplianceFiling, type ComplianceItem } from "@/lib/types/hr";

type StatusFilter = "all" | "open" | "behind" | "in_progress" | "filed" | "overdue";
const STATUS_FILTERS: { value: StatusFilter; label: string; matches: (s: CalendarStatus) => boolean }[] = [
  { value: "all", label: "Every status", matches: () => true },
  { value: "open", label: "Not yet filed", matches: (s) => s === "due" || s === "due_soon" || s === "behind" || s === "overdue" || s === "in_progress" },
  { value: "in_progress", label: "In progress", matches: (s) => s === "in_progress" },
  { value: "behind", label: "Behind target", matches: (s) => s === "behind" },
  { value: "overdue", label: "Overdue", matches: (s) => s === "overdue" },
  { value: "filed", label: "Submitted", matches: (s) => s === "filed" || s === "late" || s === "na" },
];

const STATUS_LABEL: Record<CalendarStatus, string> = {
  due: "Due",
  due_soon: "Due soon",
  behind: "Behind target",
  overdue: "Overdue",
  in_progress: "In progress",
  filed: "Submitted",
  late: "Submitted late",
  na: "Not applicable",
};

/**
 * The Compliances tracker: every government obligation with its agency
 * deadline and the foundation's own earlier target to file by, what was
 * filed, and which reports the system drafts the figures for. Admins and
 * HR keep the obligations; finance records filings as well.
 */
export default function CompliancePage() {
  const { role, isHr } = useRole();
  const manages = canManageHr(role, isHr);
  const records = canRecordComplianceFilings(role, isHr);
  const views = canViewCompliance(role, isHr);
  const { items, loading } = useComplianceItems();
  const { filings } = useComplianceFilings();
  const { holidays } = useHolidays();
  const settings = useAppSettings();
  const today = dayKey(useNow());
  const [range, setRange] = React.useState<"90" | "year" | "past">("90");
  const [category, setCategory] = React.useState<string>("all");
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("all");
  const [recording, setRecording] = React.useState<CalendarEntry<ComplianceFiling, ComplianceItem> | null>(null);
  const [editing, setEditing] = React.useState<ComplianceItem | "new" | null>(null);

  if (!views) return <EmptyState title="Admins, finance and HR only" description="The Compliances tracker is kept by the CEO and super admin; finance records what was filed." />;

  const ctx: ComplianceContext = {
    penLastDigit: settings.compliancePenLastDigit,
    employerInitial: settings.complianceEmployerInitial,
    trackingFrom: settings.complianceTrackingFrom,
    leadDays: settings.complianceLeadDays,
    holidays: holidays.map((h) => ({ date: h.date, kind: h.kind })),
  };
  const year = Number(today.slice(0, 4));
  // Window over PERIODS: a year back so overdue items still show, a year ahead for annual ones.
  const window = { from: `${year - 1}-01-01`, to: `${year + 1}-12-31` };
  const all = complianceCalendar(items, filings, window, ctx, today);
  const overdue = all.filter((e) => e.status === "overdue");
  const behind = all.filter((e) => e.status === "behind");
  const soon = all.filter((e) => e.status === "due_soon" || e.status === "in_progress");
  const filedThisYear = all.filter((e) => (e.status === "filed" || e.status === "late") && e.filing?.filedOn?.startsWith(String(year)));
  const statusMatch = STATUS_FILTERS.find((f) => f.value === statusFilter)?.matches ?? (() => true);
  const shown = all
    .filter((e) => {
      if (category !== "all" && e.item.category !== category) return false;
      if (!statusMatch(e.status)) return false;
      if (range === "past") return e.dueOn < today;
      if (range === "90") return e.dueOn >= today && e.dueOn <= addDays(today, 90);
      return e.dueOn.startsWith(String(year));
    })
    // Overdue rows fail the "from today" test, so the 90-day view re-adds them; behind rows still pass it and need no re-adding.
    .concat(range === "90" ? overdue.filter((e) => (category === "all" || e.item.category === category) && statusMatch(e.status)) : [])
    .sort((a, b) => (a.targetOn < b.targetOn ? -1 : a.targetOn > b.targetOn ? 1 : 0));
  const missingSettings = settings.compliancePenLastDigit === null || !settings.complianceEmployerInitial;
  const trackingYear = Number(settings.complianceTrackingFrom.slice(0, 4)) || year;
  const dswdYears = Array.from({ length: year - Math.min(trackingYear, 2024) + 1 }, (_, i) => year - i);

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
      <PageHeader
        title="Compliances"
        description={`Every government submission the foundation owes, with the agency's deadline and the date to submit by (${settings.complianceLeadDays} day${settings.complianceLeadDays === 1 ? "" : "s"} ahead), what has been filed, and which reports the system drafts.`}
        action={manages ? <HrSubNav /> : undefined}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Overdue" value={loading ? "…" : overdue.length} icon={AlertTriangle} color="rose" sublabel="Past the agency's deadline, not filed" />
        <KpiCard label="Behind target" value={loading ? "…" : behind.length} icon={TimerOff} color="amber" sublabel="Past our submit-by date, still before the deadline" />
        <KpiCard label="Due within 14 days" value={loading ? "…" : soon.length} icon={CalendarClock} color="blue" sublabel="Counting to the submit-by date, in-progress included" />
        <KpiCard label={`Submitted ${year}`} value={loading ? "…" : filedThisYear.length} icon={CheckCircle2} color="green" sublabel="With reference numbers" />
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
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-44" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
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
            shown.map((e) => {
              const source = reportSourceFor(e.code);
              // The payroll figures live under HR, which finance cannot open; the DSWD figures are open to everyone here.
              const canGenerate = source !== null && (manages || !source.href(e.periodKey).startsWith("/hr/"));
              const badgeLabel =
                e.status === "due" || e.status === "due_soon"
                  ? `${STATUS_LABEL[e.status]} · ${e.daysLeft} d to target`
                  : e.status === "behind"
                    ? `${STATUS_LABEL.behind} · ${e.daysToDeadline} d to deadline`
                    : e.status === "overdue"
                      ? `${STATUS_LABEL.overdue} · ${-e.daysToDeadline} d late`
                      : STATUS_LABEL[e.status];
              return (
                <div key={`${e.itemId}|${e.periodKey}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-sm">
                  <div className="flex min-w-0 flex-col">
                    <span className="font-medium">
                      {e.item.agency} · {e.item.name}
                    </span>
                    <span className="text-xs">
                      <span className="font-medium">Submit by {formatDate(e.targetOn)}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {e.item.agency} deadline {formatDate(e.dueOn)}
                        {e.dueRaw !== e.dueOn ? ` (rolled from ${formatDate(e.dueRaw, "MMM d")})` : ""}
                        {e.overridden ? " · agency-published date" : ""}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {e.item.form ? `${e.item.form} · ` : ""}
                      {e.periodLabel}
                      {" · "}
                      {source ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                          <FileSpreadsheet className="size-3" /> {source.label}
                        </span>
                      ) : (
                        "Manual: filed from records kept outside the system"
                      )}
                      {e.filing?.referenceNo ? ` · ref ${e.filing.referenceNo}` : ""}
                      {e.filing?.filedOn ? ` · filed ${formatDate(e.filing.filedOn)}` : ""}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge dot domain="compliance" status={e.status} label={badgeLabel} />
                    {source && canGenerate ? (
                      <Button asChild size="sm" variant="ghost">
                        <Link href={source.href(e.periodKey)}>Generate</Link>
                      </Button>
                    ) : null}
                    {e.item.portalUrl ? (
                      <Button asChild size="sm" variant="ghost" aria-label="Portal">
                        <a href={e.item.portalUrl} target="_blank" rel="noreferrer">
                          <ExternalLink className="size-3.5" />
                        </a>
                      </Button>
                    ) : null}
                    {records ? (
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setRecording(e)}>
                        <ClipboardList className="size-3.5" />
                        {e.filing ? "Update" : "Record"}
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">DSWD annual figures</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <p className="text-muted-foreground">The Annex E financial report and Annex G accomplishment report drafted from the bank statement, receipts, patients, the census and the meal logs. Print or copy the figures onto the DSWD forms.</p>
          <div className="flex flex-wrap gap-2">
            {dswdYears.map((y) => (
              <Button key={y} asChild size="sm" variant="outline">
                <Link href={`/compliance/dswd/${y}`}>{y}</Link>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">Obligations</CardTitle>
          {manages ? (
            <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
              Add obligation
            </Button>
          ) : null}
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
              {manages ? (
                <div className="flex items-center gap-2">
                  {i.applies !== "not_required" ? <Switch checked={i.active} onCheckedChange={() => toggle(i)} aria-label={`${i.name} active`} /> : null}
                  <Button size="sm" variant="ghost" onClick={() => setEditing(i)} aria-label="Edit">
                    <Pencil className="size-3.5" />
                  </Button>
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">{i.active ? "On the calendar" : "Off"}</span>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {recording ? <FilingDialog key={`${recording.itemId}|${recording.periodKey}`} entry={recording} close={() => setRecording(null)} canDelete={manages} /> : null}
      {editing ? <ComplianceItemDialog key={editing === "new" ? "new" : editing.id} item={editing === "new" ? null : editing} close={() => setEditing(null)} /> : null}
    </div>
  );
}
