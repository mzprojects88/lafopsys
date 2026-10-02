"use client";

import * as React from "react";
import { toast } from "sonner";
import { Bus, Flag, Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRole } from "@/context/role-provider";
import { correctOdometer, moveTrip, useRouteKm, type Vehicle } from "@/lib/hooks/use-vehicles-collection";
import { formatKm } from "@/lib/utils/odometer";
import type { TripStatus } from "@/lib/types/house-ops";
import { CorrectOdometerDialog, OdometerDialog } from "./odometer-drums";

export interface MovableTrip {
  id: string;
  status: TripStatus;
  odometerStart: number | null;
  odometerEnd: number | null;
}

/** "Left at 160,648 km · back at 160,671 km · 23 km", or nothing before any reading. */
export function TripReadings({ trip }: { trip: MovableTrip }) {
  if (trip.odometerStart == null) return null;
  return (
    <p className="text-theme-xs text-muted-foreground tabular-nums">
      Left at {formatKm(trip.odometerStart)}
      {trip.odometerEnd != null ? ` · back at ${formatKm(trip.odometerEnd)} · ${formatKm(trip.odometerEnd - trip.odometerStart)}` : ""}
    </p>
  );
}

/**
 * Depart, arrive and "not left yet" for any trip (0076). Once its vehicle is tracked (the Super
 * Admin set a starting odometer), each step asks for the reading, prefilled; the Super Admin
 * can correct an arrived trip's readings with a reason.
 */
export function TripControls({
  trip,
  vehicle,
  canEdit,
  canDepart = true,
  departLabel,
  arriveLabel,
  route,
}: {
  trip: MovableTrip;
  vehicle: Vehicle | undefined;
  /** routeKey() of the trip, for the usual km on arrival (0078). */
  route: string;
  canEdit: boolean;
  canDepart?: boolean;
  departLabel: React.ReactNode;
  arriveLabel: string;
}) {
  const { roles } = useRole();
  const routes = useRouteKm();
  const [asking, setAsking] = React.useState<"depart" | "arrive" | "correct" | null>(null);
  const [busy, setBusy] = React.useState(false);
  const tracked = vehicle?.startOdometer != null;
  const isSuperAdmin = roles.includes("admin");

  async function move(status: TripStatus, ok?: string) {
    setBusy(true);
    const r = await moveTrip(trip.id, status);
    setBusy(false);
    if (!r.ok) toast.error(r.error);
    else if (ok) toast.success(ok);
  }

  return (
    <>
      {canEdit && trip.status !== "completed" && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {trip.status === "scheduled" && (
            <Button size="lg" className="flex-1 sm:flex-none" disabled={!canDepart || busy} onClick={() => (tracked ? setAsking("depart") : move("in_progress", "On the road"))}>
              <Bus /> {departLabel}
            </Button>
          )}
          {trip.status === "in_progress" && (
            <>
              <Button size="lg" className="flex-1 sm:flex-none" disabled={busy} onClick={() => (tracked ? setAsking("arrive") : move("completed", arriveLabel))}>
                <Flag /> {arriveLabel}
              </Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => move("scheduled")}>
                Not left yet
              </Button>
            </>
          )}
        </div>
      )}
      {isSuperAdmin && trip.status === "completed" && trip.odometerStart != null && (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setAsking("correct")}>
          <Gauge /> Correct odometer
        </Button>
      )}

      {asking === "depart" && vehicle && (
        <OdometerDialog
          title={`${vehicle.name} odometer`}
          description="Check the dashboard. Confirm if the drums match it, or tap them to change."
          vehicleId={vehicle.id}
          stage="depart"
          photoRequired={!vehicle.photoToday}
          initial={vehicle.lastReading}
          lowest={vehicle.lastReading}
          confirmLabel="Confirm and depart"
          onConfirm={async (km, photoId) => {
            const r = await moveTrip(trip.id, "in_progress", { start: km, startPhotoId: photoId });
            if (r.ok) toast.success("On the road");
            return r;
          }}
          onClose={() => setAsking(null)}
        />
      )}
      {asking === "arrive" && vehicle && (
        <OdometerDialog
          title={`${vehicle.name} odometer`}
          description="The reading on the dashboard now."
          vehicleId={vehicle.id}
          stage="arrive"
          initial={trip.odometerStart}
          lowest={trip.odometerStart}
          tripStart={trip.odometerStart}
          usual={routes.get(route) ?? null}
          confirmLabel="Confirm and arrive"
          onConfirm={async (km, photoId) => {
            const r = await moveTrip(trip.id, "completed", { end: km, endPhotoId: photoId });
            if (r.ok) toast.success(arriveLabel);
            return r;
          }}
          onClose={() => setAsking(null)}
        />
      )}
      {asking === "correct" && (
        <CorrectOdometerDialog
          start={trip.odometerStart}
          end={trip.odometerEnd}
          onSave={(start, end, reason) => correctOdometer(trip.id, start, end, reason)}
          onClose={() => setAsking(null)}
        />
      )}
    </>
  );
}
