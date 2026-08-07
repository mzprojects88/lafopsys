"use client";

import * as React from "react";
import { use } from "react";
import { notFound } from "next/navigation";
import { CalendarPlus } from "lucide-react";
import { toast } from "sonner";
import { EntityDetailHeader } from "@/components/patterns/entity-detail-header";
import { StatusBadge } from "@/components/patterns/status-badge";
import { EmptyState } from "@/components/patterns/empty-state";
import { LogVisitDialog } from "@/components/modules/patients/log-visit-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { diagnoses, treatmentPhases, provinces, bedPositions, units } from "@/lib/mock-data";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";
import { computeAge } from "@/lib/utils/age";
import { formatDate } from "@/lib/utils/date";

export default function PartnerPatientDetailPage({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = use(params);
  const { patients, carers, stays, appointments } = usePatientsData();
  const [logVisitFor, setLogVisitFor] = React.useState<string | null>(null);

  const patient = patients.find((p) => p.id === patientId);
  if (!patient) notFound();

  const patientCarers = carers.filter((c) => c.patientId === patient.id);
  const patientStays = stays.filter((s) => s.patientId === patient.id);
  const patientAppointments = [...appointments.filter((a) => a.patientId === patient.id)].sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  const diagnosisLabel = patient.diagnosisIds
    .map((id) => diagnoses.find((d) => d.id === id)?.name)
    .filter(Boolean)
    .join(", ");
  const provinceLabel = provinces.find((p) => p.id === patient.provinceId)?.name;
  const phaseLabel = patient.treatmentPhaseId
    ? treatmentPhases.find((t) => t.id === patient.treatmentPhaseId)?.name
    : undefined;
  const locationLabel = patient.rawAddress ?? provinceLabel ?? "—";
  const ageLabel = patient.birthDate ? `${computeAge(patient.birthDate)} yrs old · ` : "";

  return (
    <div className="flex flex-1 flex-col gap-6">
      <EntityDetailHeader
        title={`${patient.firstName} ${patient.lastName}`}
        subtitle={`${patient.patientNumber} · ${ageLabel}${patient.sex}`}
        initials={`${patient.firstName[0]}${patient.lastName[0]}`}
        badge={<StatusBadge domain="patient" status={patient.status} />}
        metadata={[
          { label: "Diagnosis", value: diagnosisLabel || "—" },
          { label: "Treatment Phase", value: phaseLabel ?? "—" },
          { label: "Location", value: locationLabel },
          { label: "Admitted", value: patient.admittedAt ? formatDate(patient.admittedAt) : "—" },
        ]}
        actions={
          <Button size="sm" className="gap-1.5" onClick={() => setLogVisitFor(patient.id)}>
            <CalendarPlus className="size-4" />
            Log Next Visit
          </Button>
        }
      />

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="stays">Stays ({patientStays.length})</TabsTrigger>
          <TabsTrigger value="appointments">Appointments ({patientAppointments.length})</TabsTrigger>
          <TabsTrigger value="carers">Carers ({patientCarers.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="pt-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <InfoTile label="Patient Number" value={patient.patientNumber} />
            <InfoTile label="Status" value={patient.status.replace("_", " ")} />
            <InfoTile label="Marital Status" value={patient.maritalStatus ?? "—"} />
            <InfoTile label="Remarks" value={patient.remarks ?? "—"} />
          </div>
        </TabsContent>

        <TabsContent value="stays" className="pt-4">
          {patientStays.length === 0 ? (
            <EmptyState title="No stays recorded" description="This patient has not yet been housed at LAF House." />
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
            <EmptyState title="No visits scheduled" description="Log this patient's next hospital visit to get started." />
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
                      <span className="text-xs text-muted-foreground">{c.relationship}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{c.mobileNumber || "—"}</span>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <LogVisitDialog
        patientId={logVisitFor}
        patientName={`${patient.firstName} ${patient.lastName}`}
        onOpenChange={(open) => !open && setLogVisitFor(null)}
        onLogged={() => toast.success("Next visit logged")}
      />
    </div>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border p-3">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm font-medium capitalize">{value}</span>
    </div>
  );
}
