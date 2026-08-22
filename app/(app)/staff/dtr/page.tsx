"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { format, parseISO } from "date-fns";
import { Download, Fingerprint, LogIn, MapPinOff, ShieldCheck, Users } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { PersonAvatar } from "@/components/patterns/person-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTimePunchesData } from "@/lib/hooks/use-time-punches-collection";
import { useStaffRoster } from "@/lib/hooks/use-staff-roster";
import { todayIso } from "@/lib/utils/date";
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
  dateLabel: string;
  timeLabel: string;
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

const columns: ColumnDef<PunchRow>[] = [
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
    cell: ({ row }) => <PunchTypeBadge punchType={row.original.punchType} />,
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

function toCsv(rows: PunchRow[]): string {
  const header = ["Staff", "Date", "Punch", "Time", "Location", "Location status", "Device", "Network address"];
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const lines = rows.map((r) =>
    [
      r.staffName,
      r.dateLabel,
      r.punchType === "clock_in" ? "In" : "Out",
      r.timeLabel,
      r.addressLabel ?? "",
      LOCATION_STATUS_LABELS[r.locationStatus],
      r.deviceLabel ?? "",
      r.ipAddress ?? "",
    ]
      .map((v) => escape(String(v)))
      .join(",")
  );
  return [header.map(escape).join(","), ...lines].join("\n");
}

export default function DtrPage() {
  const { punches, loading } = useTimePunchesData();
  const { staff } = useStaffRoster();
  const [staffFilter, setStaffFilter] = React.useState("all");
  const [fromDate, setFromDate] = React.useState("");
  const [toDate, setToDate] = React.useState("");

  const rows: PunchRow[] = React.useMemo(() => {
    return punches.map((p) => {
      const person = staff.find((s) => s.id === p.staffId);
      const punchedAt = parseISO(p.punchedAt);
      return {
        ...p,
        staffName: person ? `${person.firstName} ${person.lastName}` : "Unknown staff",
        dateLabel: format(punchedAt, "MMM d, yyyy"),
        timeLabel: format(punchedAt, "HH:mm"),
      };
    });
  }, [punches, staff]);

  const filtered = React.useMemo(() => {
    return rows.filter((r) => {
      if (staffFilter !== "all" && r.staffId !== staffFilter) return false;
      const day = r.punchedAt.slice(0, 10);
      if (fromDate && day < fromDate) return false;
      if (toDate && day > toDate) return false;
      return true;
    });
  }, [rows, staffFilter, fromDate, toDate]);

  const today = todayIso();
  const punchesToday = rows.filter((r) => r.punchedAt.slice(0, 10) === today).length;
  const missingLocation = filtered.filter((r) => r.locationStatus !== "captured").length;
  // Latest punch per person; anyone whose latest is a clock-in is still in.
  const currentlyIn = React.useMemo(() => {
    const latest = new Map<string, PunchRow>();
    for (const r of rows) if (!latest.has(r.staffId)) latest.set(r.staffId, r); // rows are newest-first
    return [...latest.values()].filter((r) => r.punchType === "clock_in").length;
  }, [rows]);

  function handleExport() {
    const blob = new Blob([toCsv(filtered)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `dtr-${today}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Daily Time Record"
        description="Every clock-in and clock-out, with where it happened and on what device."
        action={
          <Button variant="outline" onClick={handleExport} disabled={filtered.length === 0}>
            <Download className="size-4" />
            Export CSV
          </Button>
        }
      />

      <KpiGrid className="sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Punches Today" value={loading ? "…" : punchesToday} icon={Fingerprint} color="blue" />
        <KpiCard label="Currently Clocked In" value={loading ? "…" : currentlyIn} icon={LogIn} color="green" />
        <KpiCard label="Records Shown" value={loading ? "…" : filtered.length} icon={Users} color="indigo" />
        <KpiCard label="Without Location" value={loading ? "…" : missingLocation} icon={MapPinOff} color="amber" />
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
          timesheet approvals.
        </span>
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        searchPlaceholder="Search staff, address, device…"
        pageSize={15}
        emptyMessage={
          loading ? "Loading…" : "No punches recorded yet. They appear here as staff clock in and out."
        }
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
    </div>
  );
}
