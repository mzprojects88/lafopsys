"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { BedDouble, DoorOpen, LogOut, Timer } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { StatusBadge } from "@/components/patterns/status-badge";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { PersonAvatar } from "@/components/patterns/person-avatar";
import type { Patient, Stay } from "@/lib/types/patient";
import type { BedPosition, Unit } from "@/lib/types/house-ops";
import { useHouseLayout } from "@/lib/hooks/use-house-layout-collection";
import { isActiveStay, unitForBedPosition } from "@/lib/utils/beds";
import { formatDate, todayIso } from "@/lib/utils/date";
import { visitNights, visitsOf } from "@/lib/utils/visits";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";
import * as React from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { csvLines, downloadCsv } from "@/lib/utils/csv";

function buildColumns(patients: Patient[], units: Unit[], bedPositions: BedPosition[]): ColumnDef<Stay>[] {
  const unitCodeFor = (bedPositionId: string) => unitForBedPosition(bedPositionId, units, bedPositions)?.code ?? "—";
  return [
    {
      id: "patient",
      header: "Patient",
      accessorFn: (s) => {
        const p = patients.find((pt) => pt.id === s.patientId);
        return p ? `${p.firstName} ${p.lastName}` : s.patientId;
      },
      cell: ({ row }) => {
        const p = patients.find((pt) => pt.id === row.original.patientId);
        const name = p ? `${p.firstName} ${p.lastName}` : "Unknown patient";
        return (
          <div className="flex items-center gap-2.5">
            <PersonAvatar name={name} size="sm" />
            <div className="flex flex-col">
              <span className="font-medium">{name}</span>
              {p && <span className="text-theme-xs text-muted-foreground">{p.patientNumber}</span>}
            </div>
          </div>
        );
      },
    },
    {
      id: "unit",
      header: "Bed / Unit",
      cell: ({ row }) => `Bed ${unitCodeFor(row.original.bedPositionId)}`,
    },
    {
      id: "checkIn",
      header: "Check-in",
      accessorFn: (s) => s.checkInAt,
      cell: ({ row }) => formatDate(row.original.checkInAt),
    },
    {
      id: "checkOut",
      header: "Check-out",
      accessorFn: (s) => s.checkOutAt ?? "",
      cell: ({ row }) => (row.original.checkOutAt ? formatDate(row.original.checkOutAt) : "current"),
    },
    {
      id: "length",
      header: "Length of Stay",
      cell: ({ row }) => {
        const start = parseISO(row.original.checkInAt);
        const end = row.original.checkOutAt ? parseISO(row.original.checkOutAt) : parseISO(todayIso());
        const days = Math.max(0, differenceInCalendarDays(end, start));
        return `${days} day${days === 1 ? "" : "s"}`;
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <StatusBadge domain="stay" status={row.original.status} />,
    },
    {
      id: "destination",
      header: "Destination",
      cell: ({ row }) => row.original.destination ?? "—",
    },
  ];
}

export default function StayHistoryPage() {
  const router = useRouter();
  const { patients, stays } = usePatientsData();
  const { units, bedPositions } = useHouseLayout();
  const columns = buildColumns(patients, units, bedPositions);

  // In the house = checked in, not checked out (overdue included): one count everywhere.
  const inHouseCount = stays.filter(isActiveStay).length;
  // A stay is one night (0089): visits group the nights back together.
  const visits = visitsOf(stays);
  const ended = visits.filter((v) => !v.active).length;
  const avgVisitNights = Math.round(visits.reduce((sum, v) => sum + visitNights(v), 0) / (visits.length || 1));
  // The table and the CSV cover the nights in a date range (default: this month); the KPIs stay whole-record.
  const [from, setFrom] = React.useState(`${todayIso().slice(0, 7)}-01`);
  const [to, setTo] = React.useState(todayIso());
  const shown = stays.filter((s) => s.checkInAt >= from && s.checkInAt <= to);
  const { carers } = usePatientsData();
  function exportCsv() {
    const byId = new Map(patients.map((p) => [p.id, p]));
    const lines = shown.map((s) => {
      const p = byId.get(s.patientId);
      const unit = unitForBedPosition(s.bedPositionId, units, bedPositions);
      const visit = visitsOf(stays.filter((x) => (x.visitId ?? x.id) === (s.visitId ?? s.id)))[0];
      return [
        s.checkInAt,
        p ? `${p.lastName}, ${p.firstName}` : "",
        p?.patientNumber ?? "",
        s.carerId ? (carers.find((c) => c.id === s.carerId)?.name ?? "") : "",
        unit?.code ?? "",
        s.visitId ?? s.id,
        visit ? visit.firstNight : s.checkInAt,
        visit ? String(visit.stays.length) : "1",
        s.status,
        s.checkOutAt ?? "",
        s.checkOutReason ?? "",
        s.arrivalMode ?? "",
      ];
    });
    downloadCsv(csvLines(["Night", "Patient", "LFCN", "Carer", "Bed", "Visit", "Visit started", "Nights in visit", "Status", "Checked out", "Reason", "Arrival"], lines), `stays-${from}-to-${to}.csv`);
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Stay History" description="Every night in the house on record; a visit is its nights together." />

      <KpiGrid>
        <KpiCard label="Visits" value={visits.length} icon={BedDouble} />
        <KpiCard label="In the house now" value={inHouseCount} icon={DoorOpen} />
        <KpiCard label="Visits ended" value={ended} icon={LogOut} />
        <KpiCard label="Avg. nights per visit" value={`${avgVisitNights}`} icon={Timer} />
      </KpiGrid>

      <div className="flex flex-wrap items-center gap-2 text-theme-sm">
        Nights from
        <Input type="date" aria-label="From" className="w-40" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        to
        <Input type="date" aria-label="To" className="w-40" value={to} min={from} max={todayIso()} onChange={(e) => setTo(e.target.value)} />
        <Button size="sm" variant="outline" disabled={!shown.length} onClick={exportCsv}>
          <Download /> CSV ({shown.length})
        </Button>
      </div>
      <DataTable
        columns={columns}
        data={shown}
        searchPlaceholder="Search stays…"
        onRowClick={(s) => router.push(`/patients/${s.patientId}`)}
      />
    </div>
  );
}
