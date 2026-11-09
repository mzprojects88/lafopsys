"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { Users, UserCheck, CalendarPlus, LogIn, LogOut, BedDouble, Utensils, Home } from "lucide-react";
import { LoadingState } from "@/components/patterns/loading-state";
import { PeriodPresetsBar, usePeriodPresets } from "@/components/patterns/period-presets";
import { useProgramImpact } from "@/lib/hooks/use-program-impact";
import { shown, total } from "@/lib/utils/program-impact";
import { isActiveStay } from "@/lib/utils/beds";
import { useCensusData } from "@/lib/hooks/use-census-collection";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { StatusBadge } from "@/components/patterns/status-badge";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { PersonAvatar } from "@/components/patterns/person-avatar";
import { PatientsSubNav } from "@/components/modules/patients/patients-subnav";
import { MasterSheetStatus } from "@/components/modules/patients/master-sheet-status";
import { SheetChangesPanel } from "@/components/modules/patients/sheet-changes-panel";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import { cities } from "@/lib/mock-data/reference-data";
import { useDiagnosesReferenceData } from "@/lib/hooks/use-diagnoses-reference-collection";
import { PRIORITIES, recordGaps } from "@/lib/utils/master-sheet";
import Link from "next/link";
import type { Carer, Patient } from "@/lib/types/patient";
import { computeAge } from "@/lib/utils/age";
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
  return (
    <React.Suspense fallback={<LoadingState />}>
      <PatientsContent />
    </React.Suspense>
  );
}

function PatientsContent() {
  const router = useRouter();
  const { patients, carers, stays } = usePatientsData();
  const { rows: diagnoses } = useDiagnosesReferenceData();
  const columns = React.useMemo(() => columnsFor(new Map(diagnoses.map((d) => [d.id, d.name]))), [diagnoses]);
  const canEdit = useModuleAccess().canEdit("patients");
  // The period (Nov 2026): Today by default. Total, Ongoing and In the house stay "right now".
  const period = usePeriodPresets("patients", "today");
  const w = period.window!;
  const inPeriod = (date: string | undefined | null) => !!date && date.slice(0, 10) >= w.from && date.slice(0, 10) <= w.to;
  const [onlyAdmitted, setOnlyAdmitted] = React.useState(false);
  const ongoingCount = patients.filter((p) => p.status === "ongoing").length;
  // As the Dashboard counts it: families checked in now, or the house sheet's count while nobody is checked in in the app.
  const { history: census } = useCensusData();
  const inHouse = stays.filter(isActiveStay).length || (census[census.length - 1]?.inHouse ?? 0);
  const admitted = patients.filter((p) => inPeriod(p.admittedAt));
  const checkIns = stays.filter((s) => inPeriod(s.checkInAt)).length;
  const checkOuts = stays.filter((s) => inPeriod(s.checkOutAt)).length;
  // Nights and meals as the Programs report counts them (the app's records, or the sheet while it is the record).
  const impact = useProgramImpact(w, "month");
  const nights = impact.loading || impact.error ? "—" : total(impact.rows, "housing", shown).toLocaleString();
  const meals = impact.loading || impact.error ? "—" : (["meals_breakfast", "meals_lunch", "meals_dinner"] as const).reduce((s, l) => s + total(impact.rows, l, shown), 0).toLocaleString();

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Patients & Admissions"
        description="Every child LAF has served. Kept in step with the Patients Database sheet while staff learn the app."
        action={<PatientsSubNav except="/patients" />}
      />

      <MasterSheetStatus canRun={canEdit} />
      <SheetChangesPanel canDecide={canEdit} />
      {canEdit ? <NeedsDetails patients={patients} carers={carers} /> : null}

      <PeriodPresetsBar state={period.state} onChange={period.setState} label={period.label} today={period.today} />

      <KpiGrid>
        <KpiCard label="Admitted" value={admitted.length} sublabel={period.label} icon={CalendarPlus} />
        <KpiCard label="Check-ins" value={checkIns} sublabel={period.label} icon={LogIn} />
        <KpiCard label="Check-outs" value={checkOuts} sublabel={period.label} icon={LogOut} />
        <KpiCard label="Nights Housed" value={nights} sublabel={`People-nights · ${period.label}`} icon={BedDouble} />
        <KpiCard label="Meals Served" value={meals} sublabel={period.label} icon={Utensils} />
        <KpiCard label="In the House" value={inHouse} sublabel="Families · now" icon={Home} />
        <KpiCard label="Ongoing" value={ongoingCount} sublabel="Now" icon={UserCheck} />
        <KpiCard label="Total Patients" value={patients.length} sublabel="All time" icon={Users} />
      </KpiGrid>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={onlyAdmitted}
          onClick={() => setOnlyAdmitted((v) => !v)}
          className="shrink-0 rounded-full border border-border px-3 py-1 text-theme-xs font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-primary"
        >
          Only admitted in this period <span className="tabular-nums">{admitted.length}</span>
        </button>
      </div>

      <DataTable
        columns={columns}
        data={onlyAdmitted ? admitted : patients}
        searchPlaceholder="Search patients…"
        onRowClick={(p) => router.push(`/patients/${p.id}`)}
      />
    </div>
  );
}

/** Children whose record lacks something neither the sheet nor anyone in the app has filled in. */
function NeedsDetails({ patients, carers }: { patients: Patient[]; carers: Carer[] }) {
  const open = patients
    .filter((p) => p.status !== "expired")
    .map((p) => {
      const carer = carers.find((c) => c.patientId === p.id && !c.effectiveTo);
      const gaps = recordGaps({
        birthDate: p.birthDate ?? null,
        address: p.rawAddress ?? null,
        sex: p.sex ?? null,
        carer: carer ? { name: carer.name, relationship: carer.relationship ?? null, phone: carer.mobileNumber ?? null } : null,
      });
      return { p, gaps };
    })
    .filter((x) => x.gaps.length > 0);
  if (open.length === 0) return null;
  return (
    <details className="rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-theme-xs text-warning-foreground dark:text-warning">
      <summary className="cursor-pointer">
        {open.length} {open.length === 1 ? "child needs" : "children need"} details the sheet does not have — open a record and use Edit details
      </summary>
      <ul className="mt-2 flex flex-col gap-1">
        {open.map(({ p, gaps }) => (
          <li key={p.id}>
            <Link href={`/patients/${p.id}`} className="font-medium underline-offset-4 hover:underline">
              {p.lastName}, {p.firstName}
            </Link>{" "}
            ({p.patientNumber}): {gaps.join(", ")}
          </li>
        ))}
      </ul>
    </details>
  );
}
