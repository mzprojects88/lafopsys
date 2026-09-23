"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { Users, UserCheck, CalendarPlus } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { StatusBadge } from "@/components/patterns/status-badge";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { PersonAvatar } from "@/components/patterns/person-avatar";
import { PatientsSubNav } from "@/components/modules/patients/patients-subnav";
import { MasterSheetStatus } from "@/components/modules/patients/master-sheet-status";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import { cities } from "@/lib/mock-data";
import { useDiagnosesReferenceData } from "@/lib/hooks/use-diagnoses-reference-collection";
import { PRIORITIES } from "@/lib/utils/master-sheet";
import type { Patient } from "@/lib/types/patient";
import { computeAge } from "@/lib/utils/age";
import { todayIso } from "@/lib/utils/date";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";


/** Columns need the live diagnosis names (the sync adds diagnoses the built-in list lacks). */
const columnsFor = (dxName: Map<string, string>): ColumnDef<Patient>[] => [
  { accessorKey: "patientNumber", header: "Case No." },
  { accessorKey: "sheetCn", header: "CN" },
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
    accessorFn: (p) => (p.birthDate ? computeAge(p.birthDate) : "—"),
  },
  { accessorKey: "sex", header: "Sex" },
  { accessorKey: "illnessCode", header: "Type", cell: ({ row }) => row.original.illnessCode ?? "—" },
  {
    accessorKey: "priority",
    header: "Priority",
    cell: ({ row }) => (row.original.priority ? <span title={PRIORITIES[row.original.priority]}>{row.original.priority}</span> : "—"),
  },
  {
    id: "diagnosis",
    header: "Diagnosis",
    cell: ({ row }) =>
      row.original.diagnosisIds
        .map((id) => dxName.get(id))
        .filter(Boolean)
        .join(", "),
  },
  {
    id: "city",
    header: "City",
    cell: ({ row }) =>
      cities.find((c) => c.id === row.original.cityId)?.name ?? row.original.rawAddress ?? "—",
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <StatusBadge domain="patient" status={row.original.status} />,
  },
];

export default function PatientsPage() {
  const router = useRouter();
  const { patients } = usePatientsData();
  const { rows: diagnoses } = useDiagnosesReferenceData();
  const columns = React.useMemo(() => columnsFor(new Map(diagnoses.map((d) => [d.id, d.name]))), [diagnoses]);
  const canEdit = useModuleAccess().canEdit("patients");
  const ongoingCount = patients.filter((p) => p.status === "ongoing").length;
  const admittedThisMonth = patients.filter(
    (p) => p.admittedAt.slice(0, 7) === todayIso().slice(0, 7)
  ).length;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Patients & Admissions"
        description="Every child LAF has served. Kept in step with the Patients Database sheet while staff learn the app."
        action={<PatientsSubNav except="/patients" />}
      />

      <MasterSheetStatus canRun={canEdit} />

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
