"use client";

import { use } from "react";
import { notFound } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { EntityDetailHeader } from "@/components/patterns/entity-detail-header";
import { StatusBadge } from "@/components/patterns/status-badge";
import { EmptyState } from "@/components/patterns/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  cities,
  provinces,
  diagnoses,
  treatmentPhases,
  bedPositions,
  units,
} from "@/lib/mock-data";
import { computeAge } from "@/lib/utils/age";
import { formatDate } from "@/lib/utils/date";
import { useRole } from "@/lib/rbac/use-role";
import { canSeeClinicalDetail } from "@/lib/rbac/roles";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";
import { AdmissionChecklist } from "@/components/modules/patients/admission-checklist";

export default function PatientDetailPage({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = use(params);
  const { patients, carers, stays, appointments, loading } = usePatientsData();
  const patient = patients.find((p) => p.id === patientId);
  const { role } = useRole();

  if (!patient) {
    if (loading) return null;
    notFound();
  }

  const canSeeClinical = canSeeClinicalDetail(role);
  const patientCarers = carers.filter((c) => c.patientId === patient.id);
  const patientStays = stays.filter((s) => s.patientId === patient.id);
  const patientAppointments = appointments.filter((a) => a.patientId === patient.id);

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

  return (
    <div className="flex flex-1 flex-col gap-6">
      <EntityDetailHeader
        title={`${patient.firstName} ${patient.lastName}`}
        subtitle={`${patient.patientNumber}${canSeeClinical ? ` · ${ageLabel}${patient.sex}` : ""}`}
        initials={`${patient.firstName[0]}${patient.lastName[0]}`}
        badge={<StatusBadge domain="patient" status={patient.status} />}
        metadata={[
          { label: "Diagnosis", value: canSeeClinical ? diagnosisLabel || "—" : <Restricted /> },
          { label: "Treatment Phase", value: canSeeClinical ? phaseLabel ?? "—" : <Restricted /> },
          { label: "Location", value: canSeeClinical ? locationLabel : <Restricted /> },
          { label: "Photo Consent", value: photoConsentLabel },
        ]}
      />

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
            <div className="mb-3 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
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
        </TabsContent>

        <TabsContent value="stays" className="pt-4">
          {patientStays.length === 0 ? (
            <EmptyState title="No stays recorded" />
          ) : (
            <div className="flex flex-col gap-2">
              {patientStays.map((stay) => {
                const unit = units.find((u) => u.id === bedPositions.find((b) => b.id === stay.bedPositionId)?.unitId);
                return (
                  <Card key={stay.id}>
                    <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                      <div className="flex flex-col">
                        <span className="font-medium">Bed {unit?.code ?? "—"}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(stay.checkInAt)} — {stay.checkOutAt ? formatDate(stay.checkOutAt) : "current"}
                        </span>
                      </div>
                      <StatusBadge domain="stay" status={stay.status} />
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="appointments" className="pt-4">
          {patientAppointments.length === 0 ? (
            <EmptyState title="No appointments scheduled" />
          ) : (
            <div className="flex flex-col gap-2">
              {patientAppointments.map((a) => (
                <Card key={a.id}>
                  <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                    <div className="flex flex-col">
                      <span className="font-medium">{a.clinic}</span>
                      <span className="text-xs text-muted-foreground">{a.purpose}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {a.needsTransport && <Badge variant="secondary" className="text-[11px]">Needs Transport</Badge>}
                      <span className="text-xs text-muted-foreground">{formatDate(a.date)} · {a.time}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="carers" className="pt-4">
          {patientCarers.length === 0 ? (
            <EmptyState title="No carers on file" />
          ) : (
            <div className="flex flex-col gap-2">
              {patientCarers.map((c) => (
                <Card key={c.id}>
                  <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                    <div className="flex flex-col">
                      <span className="font-medium">{c.name}</span>
                      <span className="text-xs text-muted-foreground">{c.relationship ?? "—"}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {canSeeClinical ? (c.mobileNumber ?? "—") : <Restricted />}
                    </span>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="documents" className="pt-4">
          <AdmissionChecklist patientId={patient.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border p-3">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

function Restricted() {
  return <span className="italic text-muted-foreground">Restricted</span>;
}
