"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { format, parseISO } from "date-fns";
import { CalendarDays, CalendarRange, Clock, Download, LogIn, MapPinOff, PencilLine, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { PersonAvatar } from "@/components/patterns/person-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDtrSessions } from "@/lib/hooks/use-dtr-sessions";
import { csvLines, downloadCsv } from "@/lib/utils/csv";
import { useStaffRoster } from "@/lib/hooks/use-staff-roster";
import { todayIso } from "@/lib/utils/date";
import { dayKey, effectiveStatus, formatMinutes, isLong, sessionMinutes, timeLabel, totalsFor, type DtrSession } from "@/lib/utils/dtr";
import type { PunchLocationStatus, TimePunch } from "@/lib/types/staff";

/** Why a punch has no address, in words a person can act on. */
const LOCATION_STATUS_LABELS: Record<PunchLocationStatus, string> = {
  captured: "Captured",
  permission_denied: "Location not captured — permission denied",
  unavailable: "Location not captured — unavailable on this device",
  geocode_failed: "Coordinates recorded, address lookup failed",
};

interface PunchRow extends TimePunch {
  staffName: string;
  dayKey: string;
  dateLabel: string;
  timeLabel: string;
}

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
  open: { label: "In progress", className: "bg-emerald-50 text-emerald-700 hover:bg-emerald-50 dark:bg-emerald-500/15 dark:text-emerald-400" },
  closed: { label: "Closed", className: "bg-slate-100 text-slate-700 hover:bg-slate-100 dark:bg-slate-500/15 dark:text-slate-300" },
  long: { label: "Long", className: "bg-amber-50 text-amber-700 hover:bg-amber-50 dark:bg-amber-500/15 dark:text-amber-400" },
  missed_out: { label: "Missed clock-out", className: "bg-rose-50 text-rose-700 hover:bg-rose-50 dark:bg-rose-500/15 dark:text-rose-400" },
  orphan_out: { label: "No clock-in", className: "bg-rose-50 text-rose-700 hover:bg-rose-50 dark:bg-rose-500/15 dark:text-rose-400" },
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

function mapsHref(punch: TimePunch) {
  return `https://www.openstreetmap.org/?mlat=${punch.latitude}&mlon=${punch.longitude}#map=18/${punch.latitude}/${punch.longitude}`;
}

function LocationCell({ punch }: { punch: TimePunch }) {
  if (punch.locationStatus === "captured" && punch.addressLabel) {
    return (
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="break-words">{punch.addressLabel}</span>
        <a
          href={mapsHref(punch)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="w-fit text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          {punch.latitude?.toFixed(5)}, {punch.longitude?.toFixed(5)}
          {punch.accuracyMeters !== undefined && ` · ±${Math.round(punch.accuracyMeters)}m`}
        </a>
      </div>
    );
  }
  if (punch.locationStatus === "geocode_failed" && punch.latitude !== undefined) {
    return (
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="italic text-muted-foreground">Address lookup failed</span>
        <a
          href={mapsHref(punch)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="w-fit text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          {punch.latitude?.toFixed(5)}, {punch.longitude?.toFixed(5)}
        </a>
      </div>
    );
  }
  return <span className="italic text-muted-foreground">{LOCATION_STATUS_LABELS[punch.locationStatus]}</span>;
}

function PunchTypeBadge({ punchType }: { punchType: TimePunch["punchType"] }) {
  return punchType === "clock_in" ? (
    <Badge className="bg-blue-50 text-blue-700 hover:bg-blue-50 dark:bg-blue-500/15 dark:text-blue-400">In</Badge>
  ) : (
    <Badge className="bg-emerald-50 text-emerald-700 hover:bg-emerald-50 dark:bg-emerald-500/15 dark:text-emerald-400">
      Out
    </Badge>
  );
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

const punchColumns: ColumnDef<PunchRow>[] = [
  {
    id: "staff",
    header: "Staff",
    accessorFn: (p) => p.staffName,
    cell: ({ row }) => (
      <div className="flex items-center gap-2.5">
        <PersonAvatar name={row.original.staffName} size="sm" />
        <span className="font-medium">{row.original.staffName}</span>
      </div>
    ),
  },
  { id: "date", header: "Date", accessorFn: (p) => p.dateLabel },
  {
    id: "punch",
    header: "Punch",
    accessorFn: (p) => p.punchType,
    cell: ({ row }) => (
      <div className="flex items-center gap-1.5">
        <PunchTypeBadge punchType={row.original.punchType} />
        {/* A punch an admin supplied for a shift nobody clocked out of (0029).
            Marked here so a corrected day is never mistaken for one that was
            actually recorded on a device. */}
        {row.original.source === "adjustment" ? (
          <Badge
            variant="outline"
            className="gap-1 border-amber-300 text-amber-700 dark:border-amber-900 dark:text-amber-400"
            title={row.original.adjustmentReason}
          >
            <PencilLine className="size-3" />
            Added
          </Badge>
        ) : null}
      </div>
    ),
  },
  { id: "time", header: "Time", accessorFn: (p) => p.timeLabel },
  {
    id: "location",
    header: "Location",
    accessorFn: (p) => p.addressLabel ?? LOCATION_STATUS_LABELS[p.locationStatus],
    cell: ({ row }) => <LocationCell punch={row.original} />,
  },
  {
    id: "device",
    header: "Device",
    accessorFn: (p) => p.deviceLabel ?? "",
    cell: ({ row }) => row.original.deviceLabel ?? <span className="text-muted-foreground">—</span>,
  },
  {
    id: "ip",
    header: "Network address",
    accessorFn: (p) => p.ipAddress ?? "",
    cell: ({ row }) => (
      <span className="font-mono text-xs">{row.original.ipAddress ?? "—"}</span>
    ),
  },
];

function punchesToCsv(rows: PunchRow[]): string {
  return csvLines(
    ["Staff", "Date", "Punch", "Time", "Location", "Location status", "Device", "Network address", "Source", "Correction reason"],
    rows.map((r) => [
      r.staffName,
      r.dateLabel,
      r.punchType === "clock_in" ? "In" : "Out",
      r.timeLabel,
      r.addressLabel ?? "",
      LOCATION_STATUS_LABELS[r.locationStatus],
      r.deviceLabel ?? "",
      r.ipAddress ?? "",
      r.source === "adjustment" ? "Added by an admin" : "Device",
      r.adjustmentReason ?? "",
    ])
  );
}

function sessionsToCsv(rows: SessionRow[]): string {
  return csvLines(
    ["Staff", "Date", "In", "Out", "Duration", "Minutes", "Status"],
    rows.map((r) => [r.staffName, r.dateLabel, r.inLabel, r.outLabel, formatMinutes(r.minutes), String(r.minutes), SESSION_STATUS[r.status].label])
  );
}

export default function DtrPage() {
  const { staff } = useStaffRoster();
  const [staffFilter, setStaffFilter] = React.useState("all");
  const [fromDate, setFromDate] = React.useState("");
  const [toDate, setToDate] = React.useState("");
  const [tab, setTab] = React.useState("sessions");

  const staffIds = React.useMemo(() => (staffFilter === "all" ? undefined : [staffFilter]), [staffFilter]);
  const { sessions, totals, punches, loading, now } = useDtrSessions({ staffIds });

  const staffName = React.useCallback(
    (id: string) => {
      const person = staff.find((s) => s.id === id);
      return person ? `${person.firstName} ${person.lastName}` : "Unknown staff";
    },
    [staff]
  );

  const inRange = React.useCallback(
    (staffId: string, day: string) => {
      if (staffFilter !== "all" && staffId !== staffFilter) return false;
      if (fromDate && day < fromDate) return false;
      if (toDate && day > toDate) return false;
      return true;
    },
    [staffFilter, fromDate, toDate]
  );

  const sessionRows: SessionRow[] = React.useMemo(() => {
    const rows: SessionRow[] = [];
    for (const s of sessions) {
      if (!inRange(s.staffId, s.dayKey)) continue;
      rows.push({
        id: s.id,
        staffId: s.staffId,
        staffName: staffName(s.staffId),
        dayKey: s.dayKey,
        dateLabel: formatDayKey(s.dayKey),
        inLabel: s.clockInAt ? timeLabel(s.clockInAt) : "—",
        outLabel: s.clockOutAt ? timeLabel(s.clockOutAt) : "—",
        minutes: sessionMinutes(s, now),
        status: displayStatus(s, now),
      });
    }
    // Newest first, like the punch log.
    return rows.reverse();
  }, [sessions, inRange, staffName, now]);

  const punchRows: PunchRow[] = React.useMemo(() => {
    const rows: PunchRow[] = [];
    for (const p of punches) {
      const day = dayKey(p.punchedAt);
      if (!inRange(p.staffId, day)) continue;
      rows.push({
        ...p,
        staffName: staffName(p.staffId),
        dayKey: day,
        dateLabel: formatDayKey(day),
        timeLabel: timeLabel(p.punchedAt),
      });
    }
    return rows;
  }, [punches, inRange, staffName]);

  const today = todayIso();
  const sessionsToday = sessions.filter((s) => s.dayKey === today && (!staffIds || staffIds.includes(s.staffId)) && s.status !== "orphan_out").length;
  const missingLocation = punchRows.filter((r) => r.locationStatus !== "captured").length;

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
    if (tab === "sessions") downloadCsv(sessionsToCsv(sessionRows), `dtr-sessions-${today}.csv`);
    else downloadCsv(punchesToCsv(punchRows), `dtr-punches-${today}.csv`);
  }

  const exportDisabled = tab === "sessions" ? sessionRows.length === 0 : punchRows.length === 0;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Daily Time Record"
        description="Every clock-in and clock-out session, with hours for today, this week and this month."
        action={
          <Button variant="outline" onClick={handleExport} disabled={exportDisabled}>
            <Download className="size-4" />
            Export CSV
          </Button>
        }
      />

      <KpiGrid className="sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Hours Today"
          value={loading ? "…" : formatMinutes(totals.today)}
          sublabel={totals.openCount > 0 ? `${totals.openCount} in progress` : `${sessionsToday} session${sessionsToday === 1 ? "" : "s"}`}
          icon={Clock}
          color="blue"
        />
        <KpiCard label="This Week" value={loading ? "…" : formatMinutes(totals.week)} sublabel="Monday to Sunday" icon={CalendarDays} color="indigo" />
        <KpiCard label="This Month" value={loading ? "…" : formatMinutes(totals.month)} sublabel={format(parseISO(today), "MMMM yyyy")} icon={CalendarRange} color="purple" />
        <KpiCard label="Currently Clocked In" value={loading ? "…" : totals.openCount} icon={LogIn} color="green" />
      </KpiGrid>

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
        <Field>
          <FieldLabel htmlFor="dtrFrom">From</FieldLabel>
          <Input id="dtrFrom" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="dtrTo">To</FieldLabel>
          <Input id="dtrTo" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </Field>
      </div>

      {/* Who can see this is enforced by row-level security, not by hiding the page —
          so say plainly what each viewer is looking at. */}
      <div className="flex items-start gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-xs text-muted-foreground">
        <ShieldCheck className="size-4 shrink-0 text-primary" />
        <span>
          Staff see their own record here. Admin and Finance see everyone&apos;s — Finance because payroll is
          reconciled against it. Punches cannot be edited or deleted after the fact; corrections go through
          timesheet approvals. Times are Manila time; a session that crosses midnight counts toward the day it started.
        </span>
      </div>

      {teamRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Hours by Staff</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Staff</TableHead>
                  <TableHead className="text-right">Today</TableHead>
                  <TableHead className="text-right">This Week</TableHead>
                  <TableHead className="text-right">This Month</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {teamRows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <PersonAvatar name={r.name} size="sm" />
                        <span className="font-medium">{r.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatMinutes(r.totals.today)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMinutes(r.totals.week)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMinutes(r.totals.month)}</TableCell>
                    <TableCell>{r.totals.openCount > 0 ? <SessionStatusBadge status="open" /> : <span className="text-xs text-muted-foreground">Out</span>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Tabs value={tab} onValueChange={setTab} className="gap-4">
        <TabsList>
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
          <TabsTrigger value="punches">Punches</TabsTrigger>
        </TabsList>

        <TabsContent value="sessions">
          <DataTable
            columns={sessionColumns}
            data={sessionRows}
            searchPlaceholder="Search staff…"
            pageSize={15}
            emptyMessage={loading ? "Loading…" : "No sessions yet. They appear here as staff clock in and out."}
            renderMobileCard={(row) => (
              <div className="flex flex-col gap-2.5 rounded-xl border bg-card p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <PersonAvatar name={row.staffName} size="sm" />
                    <span className="truncate font-medium">{row.staffName}</span>
                  </div>
                  <SessionStatusBadge status={row.status} />
                </div>
                <div className="text-xs text-muted-foreground">
                  {row.dateLabel} · {row.inLabel} – {row.outLabel}
                </div>
                <div className="text-sm font-medium tabular-nums">{formatMinutes(row.minutes)}</div>
              </div>
            )}
          />
        </TabsContent>

        <TabsContent value="punches" className="flex flex-col gap-3">
          {missingLocation > 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <MapPinOff className="size-3.5" />
              {missingLocation} of {punchRows.length} punches without a captured location
            </div>
          )}
          <DataTable
            columns={punchColumns}
            data={punchRows}
            searchPlaceholder="Search staff, address, device…"
            pageSize={15}
            emptyMessage={loading ? "Loading…" : "No punches recorded yet. They appear here as staff clock in and out."}
            renderMobileCard={(row) => (
              <div className="flex flex-col gap-2.5 rounded-xl border bg-card p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <PersonAvatar name={row.staffName} size="sm" />
                    <span className="truncate font-medium">{row.staffName}</span>
                  </div>
                  <PunchTypeBadge punchType={row.punchType} />
                </div>
                <div className="text-xs text-muted-foreground">
                  {row.dateLabel} · {row.timeLabel}
                </div>
                <div className="text-xs">
                  <LocationCell punch={row} />
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 border-t pt-2.5 text-[11px] text-muted-foreground">
                  <span>{row.deviceLabel ?? "Unknown device"}</span>
                  {row.ipAddress && <span className="font-mono">{row.ipAddress}</span>}
                </div>
              </div>
            )}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
