"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { format, parseISO } from "date-fns";
import Link from "next/link";
import { CalendarDays, CalendarRange, Clock, Download, LogIn, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { PersonAvatar } from "@/components/patterns/person-avatar";
import { LoadingState } from "@/components/patterns/loading-state";
import { SectionCard } from "@/components/patterns/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PrintDtrButton } from "@/components/modules/staff/print-dtr-button";
import { CorrectionRequestsPanel } from "@/components/modules/staff/correction-requests-panel";
import { useCorrectionRequests } from "@/lib/hooks/use-correction-requests";
import { useRole } from "@/lib/rbac/use-role";
import { canManageHr, holdsPower } from "@/lib/rbac/roles";
import { useDtrSessions } from "@/lib/hooks/use-dtr-sessions";
import { csvLines, downloadCsv } from "@/lib/utils/csv";
import { useStaffRoster } from "@/lib/hooks/use-staff-roster";
import { todayIso } from "@/lib/utils/date";
import { PeriodPresetsBar, usePeriodPresets } from "@/components/patterns/period-presets";
import { ClearFilters, FilterSelect, useFilters } from "@/components/patterns/filters";
import { optionsOf } from "@/lib/utils/filters";
import { ROLES } from "@/lib/types/common";
import { effectiveStatus, formatMinutes, isLong, sessionMinutes, timeLabel12, totalsFor, type DtrSession } from "@/lib/utils/dtr";
import { STATUS_TONE_CLASSES } from "@/lib/utils/status-colors";
import { doesFinance } from "@/lib/rbac/roles";

/** Inventory table look: header cell. */
const TH = "h-11 px-5 text-theme-xs font-medium text-muted-foreground";

type SessionDisplayStatus = "open" | "closed" | "long" | "missed_out" | "orphan_out";

interface SessionRow {
  id: string;
  staffId: string;
  staffName: string;
  dayKey: string;
  dateLabel: string;
  inLabel: string;
  outLabel: string;
  minutes: number;
  status: SessionDisplayStatus;
}

const SESSION_STATUS: Record<SessionDisplayStatus, { label: string; className: string }> = {
  open: { label: "In progress", className: STATUS_TONE_CLASSES.positive },
  closed: { label: "Closed", className: STATUS_TONE_CLASSES.neutral },
  long: { label: "Long", className: STATUS_TONE_CLASSES.warning },
  missed_out: { label: "Missed clock-out", className: STATUS_TONE_CLASSES.negative },
  orphan_out: { label: "No clock-in", className: STATUS_TONE_CLASSES.negative },
};

function displayStatus(s: DtrSession, now: Date): SessionDisplayStatus {
  const status = effectiveStatus(s, now);
  if ((status === "open" || status === "closed") && isLong(s, now)) return "long";
  return status;
}

/** "Sep 4, 2026" from a yyyy-MM-dd key (date-only, so no timezone shift). */
function formatDayKey(key: string) {
  return format(parseISO(key), "MMM d, yyyy");
}

function SessionStatusBadge({ status }: { status: SessionDisplayStatus }) {
  const s = SESSION_STATUS[status];
  return <Badge className={s.className}>{s.label}</Badge>;
}

const sessionColumns: ColumnDef<SessionRow>[] = [
  {
    id: "staff",
    header: "Staff",
    accessorFn: (s) => s.staffName,
    cell: ({ row }) => (
      <div className="flex items-center gap-2.5">
        <PersonAvatar name={row.original.staffName} size="sm" />
        <span className="font-medium">{row.original.staffName}</span>
      </div>
    ),
  },
  { id: "date", header: "Date", accessorFn: (s) => s.dateLabel },
  { id: "in", header: "In", accessorFn: (s) => s.inLabel },
  { id: "out", header: "Out", accessorFn: (s) => s.outLabel },
  {
    id: "duration",
    header: "Duration",
    accessorFn: (s) => s.minutes,
    cell: ({ row }) => <span className="tabular-nums">{formatMinutes(row.original.minutes)}</span>,
  },
  {
    id: "status",
    header: "Status",
    accessorFn: (s) => SESSION_STATUS[s.status].label,
    cell: ({ row }) => <SessionStatusBadge status={row.original.status} />,
  },
];

function sessionsToCsv(rows: SessionRow[]): string {
  return csvLines(
    ["Staff", "Date", "In", "Out", "Duration", "Minutes", "Status"],
    rows.map((r) => [r.staffName, r.dateLabel, r.inLabel, r.outLabel, formatMinutes(r.minutes), String(r.minutes), SESSION_STATUS[r.status].label])
  );
}

export default function DtrPage() {
  return (
    <React.Suspense fallback={<LoadingState />}>
      <DtrContent />
    </React.Suspense>
  );
}

function DtrContent() {
  const { staff } = useStaffRoster();
  const [staffFilter, setStaffFilter] = React.useState("all");
  // The list and the CSV cover the period (this month by default, or All time); the cards stay today / this week / this month.
  const period = usePeriodPresets("dtr", "this_month", true);
  const fromDate = period.window?.from ?? "";
  const toDate = period.window?.to ?? "";
  const [tab, setTab] = React.useState("sessions");
  const { roles, isHr, staffId: myId } = useRole();
  const { requests } = useCorrectionRequests();
  // Those who decide: requests waiting on them (not their own); everyone else: their own still waiting.
  const pendingRequests = requests.filter((r) => r.status === "pending" && (holdsPower(roles, "manage_punches") || isHr ? r.staffId !== myId : true)).length;
  // Those who manage punches decide the requests (0146).
  const decides = holdsPower(roles, "manage_punches") || isHr;
  const staffIds = React.useMemo(() => (staffFilter === "all" ? undefined : [staffFilter]), [staffFilter]);
  const { sessions, totals, punches, loading, now } = useDtrSessions({ staffIds });

  const staffName = React.useCallback(
    (id: string) => {
      const person = staff.find((s) => s.id === id);
      return person ? `${person.firstName} ${person.lastName}` : "Unknown staff";
    },
    [staff]
  );

  // Role narrows whose records show; session status finds the open, long and missing punches.
  const f = useFilters("role", "status");
  const roleFilter = f.values.role;
  const statusFilter = f.values.status;
  const inRange = React.useCallback(
    (staffId: string, day: string) => {
      if (staffFilter !== "all" && staffId !== staffFilter) return false;
      if (roleFilter !== "all" && staff.find((x) => x.id === staffId)?.role !== roleFilter) return false;
      if (fromDate && day < fromDate) return false;
      if (toDate && day > toDate) return false;
      return true;
    },
    [staffFilter, roleFilter, staff, fromDate, toDate]
  );

  const sessionRows: SessionRow[] = React.useMemo(() => {
    const rows: SessionRow[] = [];
    for (const s of sessions) {
      if (!inRange(s.staffId, s.dayKey)) continue;
      if (statusFilter !== "all" && displayStatus(s, now) !== statusFilter) continue;
      rows.push({
        id: s.id,
        staffId: s.staffId,
        staffName: staffName(s.staffId),
        dayKey: s.dayKey,
        dateLabel: formatDayKey(s.dayKey),
        inLabel: s.clockInAt ? timeLabel12(s.clockInAt) : "—",
        outLabel: s.clockOutAt ? timeLabel12(s.clockOutAt) : "—",
        minutes: sessionMinutes(s, now),
        status: displayStatus(s, now),
      });
    }
    // Newest first, like the punch log.
    return rows.reverse();
  }, [sessions, inRange, staffName, now, statusFilter]);

  const today = todayIso();
  const sessionsToday = sessions.filter((s) => s.dayKey === today && (!staffIds || staffIds.includes(s.staffId)) && s.status !== "orphan_out").length;

  // RLS decides who is in the punches: one person for most roles, everyone for
  // admin and finance. A per-staff table only means something in the second case.
  const teamRows = React.useMemo(() => {
    const ids = [...new Set(punches.map((p) => p.staffId))];
    if (ids.length < 2) return [];
    return ids
      .map((id) => ({ id, name: staffName(id), totals: totalsFor(sessions, { now, staffIds: [id] }) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [punches, sessions, now, staffName]);

  function handleExport() {
    downloadCsv(sessionsToCsv(sessionRows), `dtr-sessions-${today}.csv`);
  }

  // Whose DTR prints: your own, or for those who read everyone's (0017/0041), whoever the filter picked.
  const readsEveryone = canManageHr(roles, isHr) || doesFinance(roles);
  const printTarget = readsEveryone ? (staffFilter === "all" ? null : staffFilter) : (myId ?? null);

  const exportDisabled = sessionRows.length === 0;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Daily Time Record"
        description="Every clock-in and clock-out session, with hours for today, this week and this month."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <PrintDtrButton staffId={printTarget} />
            <Button variant="outline" onClick={handleExport} disabled={exportDisabled}>
              <Download className="size-4" />
              Export CSV
            </Button>
          </div>
        }
      />

      <KpiGrid className="sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Hours Today"
          value={loading ? "…" : formatMinutes(totals.today)}
          sublabel={totals.openCount > 0 ? `${totals.openCount} in progress` : `${sessionsToday} session${sessionsToday === 1 ? "" : "s"}`}
          icon={Clock}
        />
        <KpiCard label="This Week" value={loading ? "…" : formatMinutes(totals.week)} sublabel="Monday to Sunday" icon={CalendarDays} />
        <KpiCard label="This Month" value={loading ? "…" : formatMinutes(totals.month)} sublabel={format(parseISO(today), "MMMM yyyy")} icon={CalendarRange} />
        <KpiCard label="Currently Clocked In" value={loading ? "…" : totals.openCount} icon={LogIn} />
      </KpiGrid>

      <PeriodPresetsBar state={period.state} onChange={period.setState} today={period.today} allowAll />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field>
          <FieldLabel htmlFor="dtrStaff">Staff</FieldLabel>
          <Select value={staffFilter} onValueChange={setStaffFilter}>
            <SelectTrigger id="dtrStaff" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All staff</SelectItem>
              {staff.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.firstName} {s.lastName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="flex flex-wrap items-end gap-2 sm:col-span-2">
          <FilterSelect all="All roles" value={f.values.role} onChange={f.set("role")} options={optionsOf(staff, (s) => s.role, (v) => ROLES.find((r) => r.value === v)?.label ?? v)} className="w-44" />
          <FilterSelect all="Any session status" value={f.values.status} onChange={f.set("status")} options={(Object.keys(SESSION_STATUS) as SessionDisplayStatus[]).map((k) => ({ value: k, label: SESSION_STATUS[k].label }))} className="w-48" />
          <ClearFilters active={f.active} onClear={f.clear} />
        </div>
      </div>

      {/* Who can see this is enforced by row-level security, not by hiding the page —
          so say plainly what each viewer is looking at. */}
      <div className="flex items-start gap-2.5 rounded-2xl border border-border bg-card px-5 py-3 text-theme-sm text-muted-foreground">
        <ShieldCheck className="size-4 shrink-0 text-primary" />
        <span>
          Staff see their own record here. HR, Finance, the CEO and the Super Admin see everyone&apos;s. Each IN and
          OUT is on <Link className="text-primary underline underline-offset-2" href="/staff/punches">Punches</Link>: those who manage punches add a
          missing one (marked Added, signed with their name), change a time or delete a mistake, always with a reason,
          and every change is logged. Times are Manila time; a session that crosses midnight counts toward the day it started.
        </span>
      </div>

      {teamRows.length > 0 && (
        <SectionCard title="Hours by Staff" flush>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className={TH}>Staff</TableHead>
                <TableHead className={`${TH} text-right`}>Today</TableHead>
                <TableHead className={`${TH} text-right`}>This Week</TableHead>
                <TableHead className={`${TH} text-right`}>This Month</TableHead>
                <TableHead className={TH}>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {teamRows.map((r) => (
                <TableRow key={r.id} className="text-theme-sm hover:bg-muted/60">
                  <TableCell className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <PersonAvatar name={r.name} size="sm" />
                      <span className="font-medium">{r.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="px-5 py-3 text-right tabular-nums">{formatMinutes(r.totals.today)}</TableCell>
                  <TableCell className="px-5 py-3 text-right tabular-nums">{formatMinutes(r.totals.week)}</TableCell>
                  <TableCell className="px-5 py-3 text-right tabular-nums">{formatMinutes(r.totals.month)}</TableCell>
                  <TableCell className="px-5 py-3">{r.totals.openCount > 0 ? <SessionStatusBadge status="open" /> : <span className="text-theme-xs text-muted-foreground">Out</span>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>
      )}

      <Tabs value={tab} onValueChange={setTab} className="gap-4">
        <TabsList>
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
          <TabsTrigger value="requests">
            Requests{pendingRequests > 0 ? ` (${pendingRequests})` : ""}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="requests">
          <CorrectionRequestsPanel canDecide={decides} myId={myId ?? undefined} staffName={staffName} />
        </TabsContent>

        <TabsContent value="sessions">
          {loading ? <LoadingState /> : <DataTable
            columns={sessionColumns}
            data={sessionRows}
            searchPlaceholder="Search staff…"
            pageSize={15}
            emptyMessage="No sessions yet. They appear here as staff clock in and out."
            renderMobileCard={(row) => (
              <div className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card p-4 text-theme-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <PersonAvatar name={row.staffName} size="sm" />
                    <span className="truncate font-medium">{row.staffName}</span>
                  </div>
                  <SessionStatusBadge status={row.status} />
                </div>
                <div className="text-theme-xs text-muted-foreground">
                  {row.dateLabel} · {row.inLabel} – {row.outLabel}
                </div>
                <div className="font-medium tabular-nums">{formatMinutes(row.minutes)}</div>
              </div>
            )}
          />}
        </TabsContent>

      </Tabs>
    </div>
  );
}
