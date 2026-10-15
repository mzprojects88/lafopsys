"use client";

import * as React from "react";
import Link from "next/link";
import { addDays, format, parseISO } from "date-fns";
import { ChevronLeft, ChevronRight, Truck } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NewTripDialog, type TripStart } from "@/components/modules/transport/new-trip-dialog";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";
import { usePickups } from "@/lib/hooks/use-pickups-collection";
import { useVehicles } from "@/lib/hooks/use-vehicles-collection";
import { formatDate, todayIso } from "@/lib/utils/date";
import { formatTime12 } from "@/lib/utils/time12";
import { leaveBefore } from "@/lib/utils/trip-direction";

const shift = (day: string, n: number) => format(addDays(parseISO(day), n), "yyyy-MM-dd");
const isClock = (t: string) => /^\d{2}:\d{2}/.test(t);

/**
 * Patients > Manifest (0097): the check-ups that need a ride on a day, from the social worker's
 * interview (an appointment marked "Needs a ride"). Tick the children and plan the delivery to
 * the hospital; it appears on the driver's Transport list with them on board the manifest.
 */
export default function ManifestPage() {
  const { patients, appointments, carers } = usePatientsData();
  const { pickups } = usePickups();
  const { vehicles } = useVehicles();
  const canPlan = useModuleAccess().canEdit("patients");
  const [day, setDay] = React.useState(() => shift(todayIso(), 1));
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [start, setStart] = React.useState<TripStart | null>(null);

  const deliveries = pickups.filter((p) => p.direction === "to_hospital" && p.date === day);
  const onTrip = (patientId: string) => deliveries.find((d) => d.manifest.some((m) => m.patientId === patientId));
  const rows = appointments
    .filter((a) => a.date === day && a.needsTransport)
    .sort((a, b) => a.time.localeCompare(b.time))
    .map((a) => ({
      ...a,
      patient: patients.find((p) => p.id === a.patientId),
      carer: carers.find((c) => c.patientId === a.patientId && !c.effectiveTo),
      trip: onTrip(a.patientId),
    }));
  const chosen = rows.filter((r) => picked.has(r.patientId) && !r.trip);

  function toggle(patientId: string, on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(patientId);
      else next.delete(patientId);
      return next;
    });
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Manifest"
        description="Check-ups that need a ride, from each family's appointments. Tick the children and plan the delivery to the hospital; the driver sees it on Transport."
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button size="icon-sm" variant="outline" aria-label="Previous day" onClick={() => { setDay((d) => shift(d, -1)); setPicked(new Set()); }}>
          <ChevronLeft />
        </Button>
        <Input type="date" aria-label="Day" className="w-44" value={day} onChange={(e) => { if (e.target.value) { setDay(e.target.value); setPicked(new Set()); } }} />
        <Button size="icon-sm" variant="outline" aria-label="Next day" onClick={() => { setDay((d) => shift(d, 1)); setPicked(new Set()); }}>
          <ChevronRight />
        </Button>
        <span className="text-theme-sm text-muted-foreground">{formatDate(day, "EEEE, MMM d")}</span>
        {canPlan && chosen.length > 0 && (
          <Button
            className="ml-auto"
            onClick={() => setStart({ direction: "to_hospital", date: day, departure: leaveBefore(chosen.map((r) => r.time)), patientIds: chosen.map((r) => r.patientId) })}
          >
            <Truck /> Plan a delivery with {chosen.length}
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No ride needed this day" description="Mark an appointment as needing a ride on the child's record, under Appointments." />
      ) : (
        <div className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-card">
          {rows.map((r) => (
            <label key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <span className="flex items-center gap-3">
                {canPlan && !r.trip ? (
                  <Checkbox checked={picked.has(r.patientId)} onCheckedChange={(v) => toggle(r.patientId, !!v)} aria-label={`Ride for ${r.patient?.lastName ?? "this child"}`} />
                ) : null}
                <span className="flex flex-col">
                  <Link href={`/patients/${r.patientId}`} className="text-theme-sm font-medium hover:underline">
                    {r.patient ? `${r.patient.lastName}, ${r.patient.firstName}` : "Unknown child"}
                  </Link>
                  <span className="text-theme-xs text-muted-foreground">
                    {r.clinic} · {r.purpose} · Carer: {r.carer?.name ?? "—"}
                  </span>
                </span>
              </span>
              <span className="flex items-center gap-2">
                <span className="text-theme-xs text-muted-foreground">Check-up {isClock(r.time) ? formatTime12(r.time) : r.time}</span>
                {r.trip ? <Badge variant="secondary">On the {formatTime12(r.trip.departureTime)} delivery</Badge> : <Badge variant="outline">Needs a ride</Badge>}
              </span>
            </label>
          ))}
        </div>
      )}

      {deliveries.length > 0 && (
        <p className="text-theme-xs text-muted-foreground">
          {deliveries.length} deliver{deliveries.length === 1 ? "y" : "ies"} to the hospital planned this day ·{" "}
          <Link href="/transport" className="text-primary hover:underline">
            Open Transport
          </Link>
        </p>
      )}

      {start && (
        <NewTripDialog
          vehicles={vehicles.filter((v) => v.active)}
          start={start}
          onClose={() => {
            setStart(null);
            setPicked(new Set());
          }}
        />
      )}
    </div>
  );
}
