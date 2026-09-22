"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { recordArrival, useArrivalRides, type ArrivalInput } from "@/lib/hooks/use-arrival-rides-collection";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";
import { ARRIVAL_APP_LABELS, ARRIVAL_MODE_LABELS } from "@/lib/utils/arrival";
import { formatCurrency } from "@/lib/utils/currency";
import type { ArrivalApp, ArrivalMode, Stay } from "@/lib/types/patient";

const NEW_RIDE = "new";

export interface ArrivalDraft {
  mode: ArrivalMode | "";
  /** NEW_RIDE, or the id of a ride already recorded that day. */
  ride: string;
  app: ArrivalApp | "";
  fare: string;
}

export const EMPTY_ARRIVAL: ArrivalDraft = { mode: "", ride: NEW_RIDE, app: "", fare: "" };

export function arrivalReady(d: ArrivalDraft): boolean {
  if (!d.mode) return false;
  if (d.mode !== "ride_app") return true;
  return d.ride !== NEW_RIDE || d.app !== "";
}

export function arrivalInput(d: ArrivalDraft): ArrivalInput {
  if (d.mode !== "ride_app") return { mode: d.mode as ArrivalMode };
  if (d.ride !== NEW_RIDE) return { mode: "ride_app", rideId: d.ride };
  const fare = d.fare.trim() === "" ? null : Number(d.fare);
  return { mode: "ride_app", app: d.app as ArrivalApp, fare: Number.isFinite(fare) ? fare : null };
}

/**
 * "How did they arrive?" (0052). A ride app either starts a new ride or
 * joins one already recorded that day -- two NCH families on one car ride
 * is what makes the fare reimbursable.
 */
export function ArrivalFields({ value, onChange, arrivalDate, excludeStayId }: {
  value: ArrivalDraft;
  onChange: (next: ArrivalDraft) => void;
  arrivalDate: string;
  excludeStayId?: string;
}) {
  const { rides } = useArrivalRides();
  const { patients, stays } = usePatientsData();
  const sameDay = rides.filter((r) => r.rideDate === arrivalDate && !r.reimbursedAt);
  const ridersOf = (rideId: string) =>
    stays
      .filter((s) => s.arrivalRideId === rideId && s.id !== excludeStayId)
      .map((s) => patients.find((p) => p.id === s.patientId)?.lastName ?? "?");

  return (
    <div className="flex flex-col gap-3">
      <Field>
        <FieldLabel htmlFor="arrivalMode">How did they arrive?</FieldLabel>
        <Select value={value.mode} onValueChange={(v) => onChange({ ...value, mode: v as ArrivalMode })}>
          <SelectTrigger id="arrivalMode" className="w-full">
            <SelectValue placeholder="Select" />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(ARRIVAL_MODE_LABELS) as ArrivalMode[]).map((m) => (
              <SelectItem key={m} value={m}>
                {ARRIVAL_MODE_LABELS[m]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {value.mode === "ride_app" && (
        <>
          <Field>
            <FieldLabel htmlFor="arrivalRide">Ride</FieldLabel>
            <Select value={value.ride} onValueChange={(v) => onChange({ ...value, ride: v })}>
              <SelectTrigger id="arrivalRide" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NEW_RIDE}>A new ride</SelectItem>
                {sameDay.map((r) => {
                  const who = ridersOf(r.id);
                  return (
                    <SelectItem key={r.id} value={r.id}>
                      Rode with {who.length ? who.join(", ") : "—"} · {ARRIVAL_APP_LABELS[r.app]}
                      {r.fare !== null ? ` · ${formatCurrency(r.fare)}` : ""}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <FieldDescription>
              Families who came in the same car share one ride. Two or more NCH patients on a car ride make the fare reimbursable; Angkas never is.
            </FieldDescription>
          </Field>
          {value.ride === NEW_RIDE && (
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="arrivalApp">App</FieldLabel>
                <Select value={value.app} onValueChange={(v) => onChange({ ...value, app: v as ArrivalApp })}>
                  <SelectTrigger id="arrivalApp" className="w-full">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(ARRIVAL_APP_LABELS) as ArrivalApp[]).map((a) => (
                      <SelectItem key={a} value={a}>
                        {ARRIVAL_APP_LABELS[a]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="arrivalFare">Fare (₱, optional)</FieldLabel>
                <Input
                  id="arrivalFare"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={value.fare}
                  onChange={(e) => onChange({ ...value, fare: e.target.value })}
                />
              </Field>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Change a stay's recorded arrival afterwards (also how existing stays get one). */
export function ArrivalDialog({ stay, patientName, onOpenChange }: { stay: Stay | null; patientName: string; onOpenChange: (open: boolean) => void }) {
  const [draft, setDraft] = React.useState<ArrivalDraft>(() => ({
    ...EMPTY_ARRIVAL,
    mode: stay?.arrivalMode ?? "",
    ride: stay?.arrivalRideId ?? NEW_RIDE,
  }));
  const [saving, setSaving] = React.useState(false);

  async function save() {
    if (!stay) return;
    setSaving(true);
    const r = await recordArrival(stay.id, arrivalInput(draft));
    setSaving(false);
    if (!r.ok) {
      toast.error(`Couldn't save: ${r.error}`);
      return;
    }
    toast.success("Arrival saved");
    onOpenChange(false);
  }

  return (
    <Dialog open={!!stay} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>How {patientName} arrived</DialogTitle>
          <DialogDescription>Stay from {stay?.checkInAt}.</DialogDescription>
        </DialogHeader>
        {stay && <ArrivalFields value={draft} onChange={setDraft} arrivalDate={stay.checkInAt} excludeStayId={stay.id} />}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!arrivalReady(draft) || saving} onClick={save}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
