"use client";

import { use, useState } from "react";
import { notFound } from "next/navigation";
import { ShieldAlert, LogOut, CalendarClock, ArrowRightLeft, BedDouble, PencilLine } from "lucide-react";
import { EntityDetailHeader } from "@/components/patterns/entity-detail-header";
import { StatusBadge } from "@/components/patterns/status-badge";
import { EmptyState } from "@/components/patterns/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cities } from "@/lib/mock-data";
import { useDiagnosesReferenceData } from "@/lib/hooks/use-diagnoses-reference-collection";
import { useReferenceTableData } from "@/lib/hooks/use-reference-table-collection";
import { ILLNESS_CODES, PRIORITIES, recordGaps } from "@/lib/utils/master-sheet";
import { EditDetailsDialog } from "@/components/modules/patients/edit-details-dialog";
import { useHouseLayout } from "@/lib/hooks/use-house-layout-collection";
import { computeAge } from "@/lib/utils/age";
import { formatDate } from "@/lib/utils/date";
import { useRole } from "@/lib/rbac/use-role";
import { canSeeClinicalDetail } from "@/lib/rbac/roles";
import { FileLibrary } from "@/components/patterns/file-library";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";
import { useHouseSheetPeople } from "@/lib/hooks/use-house-sheet-collection";
import { houseSheetPatientId } from "@/lib/types/house-sheet";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import Link from "next/link";
import { Home } from "lucide-react";
import { AdmissionChecklist } from "@/components/modules/patients/admission-checklist";
import { DischargeDialog } from "@/components/modules/patients/discharge-dialog";
import { ExtendStayDialog } from "@/components/modules/patients/extend-stay-dialog";
import { TransferBedDialog } from "@/components/modules/patients/transfer-bed-dialog";
import { ArrivalDialog } from "@/components/modules/patients/arrival-fields";
import { useArrivalRides } from "@/lib/hooks/use-arrival-rides-collection";
import { arrivalLabel } from "@/lib/utils/arrival";
import { isFirstStay } from "@/lib/utils/admission-tasks";
import { CheckInDialog } from "@/components/modules/patients/check-in-dialog";
import { isActiveStay, unitForBedPosition } from "@/lib/utils/beds";
import type { Patient, Stay } from "@/lib/types/patient";

export default function PatientDetailPage({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = use(params);
  const { patients, carers, stays, appointments, loading, refetch } = usePatientsData();
  const { units, bedPositions } = useHouseLayout();
  const patient = patients.find((p) => p.id === patientId);
  const { role } = useRole();
  const { canEdit: canEditModule } = useModuleAccess();
  const canEdit = canEditModule("patients");
  const { people: sheetPeople } = useHouseSheetPeople();
  const [dischargeTarget, setDischargeTarget] = useState<Stay | null>(null);
  const [extendTarget, setExtendTarget] = useState<Stay | null>(null);
  const [transferTarget, setTransferTarget] = useState<Stay | null>(null);
  const [arrivalTarget, setArrivalTarget] = useState<Stay | null>(null);
  const { rides } = useArrivalRides();
  const [checkingIn, setCheckingIn] = useState(false);
  const [editing, setEditing] = useState(false);
  const { rows: diagnoses } = useDiagnosesReferenceData();
  const { rows: provinces } = useReferenceTableData("provinces", "prov", "region");
  const { rows: treatmentPhases } = useReferenceTableData("treatment_phases", "phase");

  if (!patient) {
    if (loading) return null;
    notFound();
  }

  const canSeeClinical = canSeeClinicalDetail(role);
  const patientCarers = carers.filter((c) => c.patientId === patient.id);
  const patientStays = stays.filter((s) => s.patientId === patient.id);
  const patientAppointments = appointments.filter((a) => a.patientId === patient.id);
  // The orientation belongs to the newest stay (0054).
  const latestStay = [...patientStays].sort((a, b) => b.checkInAt.localeCompare(a.checkInAt))[0] ?? null;
  const showCheckIn = canEdit && patient.status !== "expired" && !patientStays.some(isActiveStay);

  const diagnosisLabel = patient.diagnosisIds
    .map((id) => diagnoses.find((d) => d.id === id)?.name)
    .filter(Boolean)
    .join(", ");
  const cityLabel = cities.find((c) => c.id === patient.cityId)?.name;
  const provinceLabel = provinces.find((p) => p.id === patient.provinceId)?.name;
  const phaseLabel = treatmentPhases.find((t) => t.id === patient.treatmentPhaseId)?.name;
  const locationLabel = cityLabel
    ? `${cityLabel}, ${provinceLabel ?? "—"}`
    : patient.rawAddress ?? provinceLabel ?? "—";
  const ageLabel = patient.birthDate ? `${computeAge(patient.birthDate)} yrs old · ` : "";
  const photoConsentLabel =
    patient.photoConsentGranted === undefined ? "Unknown" : patient.photoConsentGranted ? "Granted" : "Not granted";
  const currentCarer = patientCarers.find((c) => !c.effectiveTo);
  // What neither the sheet nor anyone in the app has filled in yet.
  const gaps = recordGaps({
    birthDate: patient.birthDate ?? null,
    address: patient.rawAddress ?? null,
    sex: patient.sex ?? null,
    carer: currentCarer ? { name: currentCarer.name, relationship: currentCarer.relationship ?? null, phone: currentCarer.mobileNumber ?? null } : null,
  });
  const onHouseSheet = sheetPeople.find((p) => p.offSheetAt === null && houseSheetPatientId(p) === patient.id && p.matchStatus !== "dismissed");

  return (
    <div className="flex flex-1 flex-col gap-6">
      <EntityDetailHeader
        title={`${patient.firstName} ${patient.lastName}`}
        subtitle={`${patient.patientNumber}${patient.sheetCn ? ` · CN ${patient.sheetCn}` : ""}${canSeeClinical ? ` · ${ageLabel}${patient.sex ?? "sex not recorded"}` : ""}`}
        initials={`${patient.firstName[0]}${patient.lastName[0]}`}
        badge={<StatusBadge domain="patient" status={patient.status} />}
        metadata={[
          { label: "Diagnosis", value: canSeeClinical ? diagnosisLabel || "—" : <Restricted /> },
          { label: "Treatment Phase", value: canSeeClinical ? phaseLabel ?? "—" : <Restricted /> },
          { label: "Location", value: canSeeClinical ? locationLabel : <Restricted /> },
          { label: "Type of Illness", value: canSeeClinical ? (patient.illnessCode ? ILLNESS_CODES[patient.illnessCode] : "—") : <Restricted /> },
          { label: "Priority", value: patient.priority ? `${patient.priority} · ${PRIORITIES[patient.priority]}` : "—" },
          { label: "Photo Consent", value: photoConsentLabel },
        ]}
      />

      {canEdit && (gaps.length > 0 || canSeeClinical) ? (
        <div
          className={
            gaps.length > 0
              ? "flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-theme-xs text-warning-foreground dark:text-warning"
              : "flex justify-end"
          }
        >
          {gaps.length > 0 ? <span>Details to complete: {gaps.join(", ")}. The Patients Database sheet does not have them.</span> : null}
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => setEditing(true)}>
            <PencilLine />
            Edit details
          </Button>
        </div>
      ) : null}

      {onHouseSheet ? (
        <Link href="/patients/house-sheet" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-border bg-card px-4 py-3 text-theme-xs text-muted-foreground transition-colors hover:bg-muted/60">
          <Home className="size-3.5 shrink-0" />
          <span>
            On the house sheet as &ldquo;{onHouseSheet.patientName}&rdquo; · {onHouseSheet.daysSeen} day{onHouseSheet.daysSeen === 1 ? "" : "s"} since {formatDate(onHouseSheet.firstSeenOn)}
            {onHouseSheet.nextAppointmentRaw ? ` · next appointment ${onHouseSheet.nextAppointmentRaw}` : ""}
            {onHouseSheet.matchStatus === "suggested" ? " · AI suggestion, not yet confirmed" : ""}
          </span>
        </Link>
      ) : null}

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="stays">Stays ({patientStays.length})</TabsTrigger>
          <TabsTrigger value="appointments">Appointments ({patientAppointments.length})</TabsTrigger>
          <TabsTrigger value="carers">Carers ({patientCarers.length})</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="pt-4">
          {!canSeeClinical && (
            <div className="mb-3 flex items-center gap-2 rounded-2xl bg-muted px-4 py-3 text-theme-xs text-muted-foreground">
              <ShieldAlert className="size-3.5 shrink-0" />
              Diagnosis, address and birthdate are hidden for your role (Finance / Board see aggregates only).
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <InfoTile label="Admitted" value={formatDate(patient.admittedAt)} />
            <InfoTile
              label="Isolation Required"
              value={patient.isolationRequired === undefined ? "Unknown" : patient.isolationRequired ? "Yes (unenforced)" : "No"}
            />
            <InfoTile label="Non-Pedia" value={patient.status === "non_pedia" ? "Yes" : "No"} />
            {patient.distanceKm !== undefined && canSeeClinical && <InfoTile label="Distance from Home" value={`${patient.distanceKm} km`} />}
            {patient.legacyCode && <InfoTile label="Old Code" value={patient.legacyCode} />}
            {patient.religion && <InfoTile label="Religion" value={patient.religion} />}
            {patient.lengthOfStay && <InfoTile label="Length of Stay" value={patient.lengthOfStay} />}
            {patient.sectorCaseCategory && canSeeClinical && (
              <InfoTile label="Sector / Case Category" value={patient.sectorCaseCategory} />
            )}
            {patient.sourceOfReferralText && canSeeClinical && (
              <InfoTile label="Source of Referral" value={patient.sourceOfReferralText} />
            )}
            {patient.servicesReceived && canSeeClinical && (
              <InfoTile label="Services Received" value={patient.servicesReceived} />
            )}
            {patient.deathInfo && canSeeClinical && (
              <InfoTile label="Death Info" value={patient.deathInfo} />
            )}
          </div>
          {canSeeClinical && <IntakeDetails patient={patient} />}
        </TabsContent>

        <TabsContent value="stays" className="flex flex-col gap-3 pt-4">
          {showCheckIn && (
            <Button className="w-fit" onClick={() => setCheckingIn(true)}>
              <BedDouble />
              Check in
            </Button>
          )}
          {patientStays.length === 0 ? (
            <EmptyState title="No stays recorded" />
          ) : (
            <div className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-card">
              {patientStays.map((stay) => {
                const unit = unitForBedPosition(stay.bedPositionId, units, bedPositions);
                const isActive = stay.status === "in_house" || stay.status === "overdue";
                return (
                  <div key={stay.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-theme-sm">
                    <div className="flex flex-col">
                      <span className="font-medium">Bed {unit?.code ?? "—"}</span>
                      <span className="text-theme-xs text-muted-foreground">
                        {formatDate(stay.checkInAt)} — {stay.checkOutAt ? formatDate(stay.checkOutAt) : "current"}
                        {stay.expectedCheckoutAt && !stay.checkOutAt && ` · expected ${formatDate(stay.expectedCheckoutAt)}`}
                      </span>
                      <span className="text-theme-xs text-muted-foreground">
                        Arrived by {arrivalLabel(stay.arrivalMode, rides.find((r) => r.id === stay.arrivalRideId)?.app)}
                        {canEdit && (
                          <button type="button" className="ml-1.5 text-primary hover:underline" onClick={() => setArrivalTarget(stay)}>
                            {stay.arrivalMode ? "Change" : "Set"}
                          </button>
                        )}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge domain="stay" status={stay.status} />
                      {isActive && canEdit && (
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setExtendTarget(stay)}>
                            <CalendarClock />
                            Extend
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setTransferTarget(stay)}>
                            <ArrowRightLeft />
                            Transfer
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setDischargeTarget(stay)}>
                            <LogOut />
                            Discharge
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="appointments" className="pt-4">
          {patientAppointments.length === 0 ? (
            <EmptyState title="No appointments scheduled" />
          ) : (
            <div className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-card">
              {patientAppointments.map((a) => (
                <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-theme-sm">
                  <div className="flex flex-col">
                    <span className="font-medium">{a.clinic}</span>
                    <span className="text-theme-xs text-muted-foreground">{a.purpose}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {a.needsTransport && <Badge variant="secondary">Needs Transport</Badge>}
                    <span className="text-theme-xs text-muted-foreground">{formatDate(a.date)} · {a.time}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="carers" className="pt-4">
          {patientCarers.length === 0 ? (
            <EmptyState title="No carers on file" />
          ) : (
            <div className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-card">
              {patientCarers.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-theme-sm">
                  <div className="flex flex-col">
                    <span className="font-medium">{c.name}</span>
                    <span className="text-theme-xs text-muted-foreground">{c.relationship ?? "—"}</span>
                  </div>
                  <span className="text-theme-xs text-muted-foreground">
                    {canSeeClinical ? (c.mobileNumber ?? "—") : <Restricted />}
                  </span>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="documents" className="flex flex-col gap-6 pt-4">
          <AdmissionChecklist patientId={patient.id} canEdit={canEdit} stay={latestStay} firstStay={latestStay ? isFirstStay(latestStay, stays) : true} />
          {canSeeClinical ? (
            <FileLibrary
              recordType="patient"
              recordId={patient.id}
              canUpload={canEdit}
              canDelete={canEdit}
              title="Case files"
              description={`Case management forms, referrals and other scans, kept under Patients / ${patient.lastName}, ${patient.firstName} (${patient.sheetCn ?? patient.patientNumber}).`}
            />
          ) : null}
        </TabsContent>
      </Tabs>

      <EditDetailsDialog
        key={editing ? "open" : "closed"}
        patient={patient}
        carer={currentCarer}
        open={editing}
        onOpenChange={setEditing}
      />
      <CheckInDialog
        key={checkingIn ? "open" : "closed"}
        target={checkingIn ? { patient } : null}
        onOpenChange={(open) => !open && setCheckingIn(false)}
      />
      <DischargeDialog
        stay={dischargeTarget}
        patientName={`${patient.firstName} ${patient.lastName}`}
        onOpenChange={(open) => !open && setDischargeTarget(null)}
        onDischarged={refetch}
      />
      <ExtendStayDialog
        key={extendTarget?.id}
        stay={extendTarget}
        patientName={`${patient.firstName} ${patient.lastName}`}
        onOpenChange={(open) => !open && setExtendTarget(null)}
        onExtended={refetch}
      />
      <ArrivalDialog
        key={arrivalTarget?.id}
        stay={arrivalTarget}
        patientName={`${patient.firstName} ${patient.lastName}`}
        onOpenChange={(open) => !open && setArrivalTarget(null)}
      />
      <TransferBedDialog
        stay={transferTarget}
        patientName={`${patient.firstName} ${patient.lastName}`}
        onOpenChange={(open) => !open && setTransferTarget(null)}
        onTransferred={refetch}
      />
    </div>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-border bg-card p-3">
      <span className="text-theme-xs text-muted-foreground">{label}</span>
      <span className="text-theme-sm font-medium">{value}</span>
    </div>
  );
}

/** The intake form's answers (the sheet's AIS tab, 0057): who referred, the family's situation, the documents. */
function IntakeDetails({ patient }: { patient: Patient }) {
  const answers: [string, string | undefined][] = [
    ["Consent (“I authorize”)", patient.consentAuthorizedAt ? `Given ${formatDate(patient.consentAuthorizedAt)}` : undefined],
    ["NCH Medical Social Worker", patient.mssName],
    ["Attending Physician", patient.attendingPhysician],
    ["Parent's Education", patient.parentEducation],
    ["Parent's Occupation", patient.parentOccupation],
    ["Monthly Income", patient.householdIncome],
    ["Employment Status", patient.parentEmployment],
    ["Type of Housing", patient.housingType],
  ];
  const shown = answers.filter((a): a is [string, string] => !!a[1]);
  const links = [
    ["Photo", patient.intakeLinks?.photo],
    ["Parent's ID", patient.intakeLinks?.parentId],
    ["Medical certificate", patient.intakeLinks?.medicalCertificate],
  ].filter((l): l is [string, string] => !!l[1]);
  return (
    <section className="mt-6 flex flex-col gap-3">
      <h3 className="text-base font-medium">Intake form</h3>
      {shown.length === 0 && links.length === 0 ? (
        <p className="text-theme-xs text-muted-foreground">No intake form response matched this child (by name and birthday).</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {shown.map(([label, value]) => (
              <InfoTile key={label} label={label} value={value} />
            ))}
          </div>
          {links.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-theme-sm">
              {links.map(([label, href]) => (
                <a key={label} href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-4 hover:underline">
                  {label}
                </a>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Restricted() {
  return <span className="italic text-muted-foreground">Restricted</span>;
}
