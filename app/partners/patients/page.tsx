"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { StatusBadge } from "@/components/patterns/status-badge";
import { PersonAvatar } from "@/components/patterns/person-avatar";
import { diagnoses } from "@/lib/mock-data";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";
import { useHospitalAuth } from "@/context/hospital-auth-provider";
import type { Appointment, Patient } from "@/lib/types/patient";
import { computeAge } from "@/lib/utils/age";
import { formatDate } from "@/lib/utils/date";
import { TODAY_ISO } from "@/lib/utils/seeded-random";

function nextVisitFor(patientId: string, appointments: Appointment[]) {
  return appointments
    .filter((a) => a.patientId === patientId && a.date >= TODAY_ISO)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
}

function buildColumns(appointments: Appointment[]): ColumnDef<Patient>[] {
  return [
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
    {
      id: "diagnosis",
      header: "Diagnosis",
      cell: ({ row }) =>
        row.original.diagnosisIds
          .map((id) => diagnoses.find((d) => d.id === id)?.name)
          .filter(Boolean)
          .join(", ") || "—",
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <StatusBadge domain="patient" status={row.original.status} />,
    },
    {
      id: "nextVisit",
      header: "Next Visit",
      cell: ({ row }) => {
        const next = nextVisitFor(row.original.id, appointments);
        return next ? `${formatDate(next.date)} · ${next.purpose}` : "—";
      },
    },
  ];
}

export default function PartnerPatientsPage() {
  const router = useRouter();
  const { session } = useHospitalAuth();
  const { patients, appointments } = usePatientsData();
  const ours = patients.filter((p) => p.referringHospitalId === session?.hospitalId);
  const columns = buildColumns(appointments);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Patients Directory"
        description={`Every patient referred by ${session?.hospitalName ?? "your hospital"} to LAF House, since the beginning.`}
      />
      <DataTable
        columns={columns}
        data={ours}
        searchPlaceholder="Search patients…"
        emptyMessage="No patients referred yet."
        onRowClick={(p) => router.push(`/partners/patients/${p.id}`)}
      />
    </div>
  );
}
