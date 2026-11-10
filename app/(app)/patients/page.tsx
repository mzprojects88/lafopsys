"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { Users, UserCheck, CalendarPlus, LogIn, LogOut, BedDouble, Utensils, Home } from "lucide-react";
import { LoadingState } from "@/components/patterns/loading-state";
import { PeriodPresetsBar, usePeriodPresets } from "@/components/patterns/period-presets";
import { useProgramImpact } from "@/lib/hooks/use-program-impact";
import { shown as impactShown, total } from "@/lib/utils/program-impact";
import { isActiveStay } from "@/lib/utils/beds";
import { useCensusData } from "@/lib/hooks/use-census-collection";
import { ClearFilters, FilterSelect, useFilters } from "@/components/patterns/filters";
import { optionsOf } from "@/lib/utils/filters";
import { useReferenceTableData } from "@/lib/hooks/use-reference-table-collection";
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
import { ILLNESS_CODES, PRIORITIES, recordGaps } from "@/lib/utils/master-sheet";
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
  // Filters beside the dates: the cards and the list follow them (nights and meals stay for everyone).
  const { rows: provinces } = useReferenceTableData("provinces", "prov", "region");
  const { rows: phases } = useReferenceTableData("treatment_phases", "phase");
  const f = useFilters("status", "sex", "caf", "type", "priority", "province", "phase");
  const shown = patients.filter(
    (p) =>
      f.ok("status", p.status) &&
      f.ok("sex", p.sex) &&
      f.ok("caf", p.cafBilling ? "yes" : "no") &&
      f.ok("type", p.illnessCode) &&
      f.ok("priority", p.priority) &&
      f.ok("province", p.provinceId) &&
      f.ok("phase", p.treatmentPhaseId)
  );
  const shownIds = new Set(shown.map((p) => p.id));
  const theirs = stays.filter((s) => shownIds.has(s.patientId));
  const ongoingCount = shown.filter((p) => p.status === "ongoing").length;
  // As the Dashboard counts it: families checked in now, or the house sheet's count while nobody is checked in in the app
  // (the sheet's count has no names, so it is left out while a filter is set).
  const { history: census } = useCensusData();
  const inHouse = theirs.filter(isActiveStay).length || (f.active ? 0 : (census[census.length - 1]?.inHouse ?? 0));
  const admitted = shown.filter((p) => inPeriod(p.admittedAt));
  const checkIns = theirs.filter((s) => inPeriod(s.checkInAt)).length;
  const checkOuts = theirs.filter((s) => inPeriod(s.checkOutAt)).length;
  const nameOf = (list: { id: string; name: string }[]) => (id: string) => list.find((x) => x.id === id)?.name ?? id;
  const toolbar = (
    <>
      <FilterSelect all="All statuses" value={f.values.status} onChange={f.set("status")} options={optionsOf(patients, (p) => p.status)} />
      <FilterSelect all="Both sexes" value={f.values.sex} onChange={f.set("sex")} options={optionsOf(patients, (p) => p.sex, (v) => (v === "F" ? "Female" : "Male"))} className="w-32" />
      <FilterSelect all="CAF or not" value={f.values.caf} onChange={f.set("caf")} options={[{ value: "yes", label: "CAF billed" }, { value: "no", label: "Not CAF" }]} className="w-32" />
      <FilterSelect all="All illnesses" value={f.values.type} onChange={f.set("type")} options={optionsOf(patients, (p) => p.illnessCode, (v) => ILLNESS_CODES[v as keyof typeof ILLNESS_CODES] ?? v)} />
      <FilterSelect all="All priorities" value={f.values.priority} onChange={f.set("priority")} options={optionsOf(patients, (p) => p.priority, (v) => `${v} · ${PRIORITIES[v as keyof typeof PRIORITIES] ?? ""}`)} />
      <FilterSelect all="All provinces" value={f.values.province} onChange={f.set("province")} options={optionsOf(patients, (p) => p.provinceId, nameOf(provinces))} />
      <FilterSelect all="All treatment phases" value={f.values.phase} onChange={f.set("phase")} options={optionsOf(patients, (p) => p.treatmentPhaseId, nameOf(phases))} className="w-48" />
      <ClearFilters active={f.active} onClear={f.clear} />
    </>
  );
  // Nights and meals as the Programs report counts them (the app's records, or the sheet while it is the record).
  const impact = useProgramImpact(w, "month");
  const nights = impact.loading || impact.error ? "—" : total(impact.rows, "housing", impactShown).toLocaleString();
  const meals = impact.loading || impact.error ? "—" : (["meals_breakfast", "meals_lunch", "meals_dinner"] as const).reduce((s, l) => s + total(impact.rows, l, impactShown), 0).toLocaleString();

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

      <PeriodPresetsBar state={period.state} onChange={period.setState} today={period.today} />

      <KpiGrid>
        <KpiCard label="Admitted" value={admitted.length} sublabel={period.label} icon={CalendarPlus} />
        <KpiCard label="Check-ins" value={checkIns} sublabel={period.label} icon={LogIn} />
        <KpiCard label="Check-outs" value={checkOuts} sublabel={period.label} icon={LogOut} />
        <KpiCard label="Nights Housed" value={nights} sublabel={`People-nights${f.active ? ", all patients" : ""} · ${period.label}`} icon={BedDouble} />
        <KpiCard label="Meals Served" value={meals} sublabel={f.active ? `All patients · ${period.label}` : period.label} icon={Utensils} />
        <KpiCard label="In the House" value={inHouse} sublabel="Families · now" icon={Home} />
        <KpiCard label="Ongoing" value={ongoingCount} sublabel="Now" icon={UserCheck} />
        <KpiCard label="Total Patients" value={shown.length} sublabel={f.active ? `All time · ${patients.length} without filters` : "All time"} icon={Users} />
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
        data={onlyAdmitted ? admitted : shown}
        toolbar={toolbar}
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
