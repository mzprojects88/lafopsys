"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { Users, UserCheck, CalendarPlus, KanbanSquare, ListOrdered, Share2, CalendarClock, Bus } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { StatusBadge } from "@/components/patterns/status-badge";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { PersonAvatar } from "@/components/patterns/person-avatar";
import { ModuleSubNav, type ModuleSubNavItem } from "@/components/patterns/module-subnav";
import { patients, cities, diagnoses } from "@/lib/mock-data";
import type { Patient } from "@/lib/types/patient";
import { computeAge } from "@/lib/utils/age";
import { TODAY_ISO } from "@/lib/utils/seeded-random";

const SUB_NAV: ModuleSubNavItem[] = [
  { href: "/patients/today", label: "Today Board", icon: KanbanSquare, color: "blue" },
  { href: "/patients/waitlist", label: "Waitlist", icon: ListOrdered, color: "amber" },
  { href: "/patients/referrals", label: "Referrals", icon: Share2, color: "purple" },
  { href: "/patients/appointments", label: "Appointments", icon: CalendarClock, color: "cyan" },
  { href: "/patients/manifest", label: "Manifest", icon: Bus, color: "green" },
];

const columns: ColumnDef<Patient>[] = [
  { accessorKey: "patientNumber", header: "Patient #" },
  {
    id: "name",
    header: "Name",
    accessorFn: (p) => `${p.firstName} ${p.lastName}`,
    cell: ({ row }) => {
      const name = `${row.original.firstName} ${row.original.lastName}`;
      return (
        <div className="flex items-center gap-2.5">
          <PersonAvatar name={name} size="sm" />
          <span className="font-medium">{name}</span>
        </div>
      );
    },
  },
  {
    id: "age",
    header: "Age",
    accessorFn: (p) => computeAge(p.birthDate),
  },
  { accessorKey: "sex", header: "Sex" },
  {
    id: "diagnosis",
    header: "Diagnosis",
    cell: ({ row }) =>
      row.original.diagnosisIds
        .map((id) => diagnoses.find((d) => d.id === id)?.name)
        .filter(Boolean)
        .join(", "),
  },
  {
    id: "city",
    header: "City",
    cell: ({ row }) => cities.find((c) => c.id === row.original.cityId)?.name ?? "—",
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <StatusBadge domain="patient" status={row.original.status} />,
  },
];

export default function PatientsPage() {
  const router = useRouter();
  const ongoingCount = patients.filter((p) => p.status === "ongoing").length;
  const admittedThisMonth = patients.filter(
    (p) => p.admittedAt.slice(0, 7) === TODAY_ISO.slice(0, 7)
  ).length;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Patients & Admissions"
        description="Full patient master, migrated from FINAL_PATIENTS DATABASE."
        action={<ModuleSubNav items={SUB_NAV} />}
      />

      <KpiGrid>
        <KpiCard label="Total Patients" value={patients.length} icon={Users} color="purple" />
        <KpiCard label="Ongoing" value={ongoingCount} icon={UserCheck} color="blue" />
        <KpiCard label="Admitted This Month" value={admittedThisMonth} icon={CalendarPlus} color="green" />
      </KpiGrid>

      <DataTable
        columns={columns}
        data={patients}
        searchPlaceholder="Search patients…"
        onRowClick={(p) => router.push(`/patients/${p.id}`)}
      />
    </div>
  );
}
