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
import { bedPositions, units } from "@/lib/mock-data";
import type { Patient, Stay } from "@/lib/types/patient";
import { formatDate } from "@/lib/utils/date";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";

function unitCodeFor(bedPositionId: string) {
  const unit = units.find((u) => u.id === bedPositions.find((b) => b.id === bedPositionId)?.unitId);
  return unit?.code ?? "—";
}

function buildColumns(patients: Patient[]): ColumnDef<Stay>[] {
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
              {p && <span className="text-xs text-muted-foreground">{p.patientNumber}</span>}
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
        const end = row.original.checkOutAt ? parseISO(row.original.checkOutAt) : new Date("2026-08-04T00:00:00Z");
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
  const columns = buildColumns(patients);

  const inHouseCount = stays.filter((s) => s.status === "in_house").length;
  const discharged = stays.filter((s) => s.status === "checked_out").length;
  const avgLengthDays = Math.round(
    stays.reduce((sum, s) => {
      const start = parseISO(s.checkInAt);
      const end = s.checkOutAt ? parseISO(s.checkOutAt) : new Date("2026-08-04T00:00:00Z");
      return sum + Math.max(0, differenceInCalendarDays(end, start));
    }, 0) / (stays.length || 1)
  );

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Stay History" description="Every house stay on record, past and present." />

      <KpiGrid>
        <KpiCard label="Total Stays" value={stays.length} icon={BedDouble} color="indigo" />
        <KpiCard label="Currently In-House" value={inHouseCount} icon={DoorOpen} color="blue" />
        <KpiCard label="Discharged" value={discharged} icon={LogOut} color="slate" />
        <KpiCard label="Avg. Length of Stay" value={`${avgLengthDays}d`} icon={Timer} color="purple" />
      </KpiGrid>

      <DataTable
        columns={columns}
        data={stays}
        searchPlaceholder="Search stays…"
        onRowClick={(s) => router.push(`/patients/${s.patientId}`)}
      />
    </div>
  );
}
