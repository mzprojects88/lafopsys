"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { patientsStore, usePatientsData } from "@/lib/hooks/use-patients-collection";
import { referralsStore } from "@/lib/hooks/use-referrals-collection";
import { houseSheetPeopleStore } from "@/lib/hooks/use-house-sheet-collection";
import { bedNightsStore } from "@/lib/hooks/use-bed-nights-collection";
import { useHouseLayout } from "@/lib/hooks/use-house-layout-collection";
import { assignableBeds } from "@/lib/utils/beds";
import { formatDate, todayIso } from "@/lib/utils/date";
import type { Patient, Referral } from "@/lib/types/patient";
import type { HouseSheetPerson } from "@/lib/types/house-sheet";

const NEW_RECORD = "new";
const NEW_CARER = "new";
const REFERRAL_CARER = "referral";
const SHEET_CARER = "sheet";
const RELATIONSHIPS = ["Mother", "Father", "Grandmother", "Grandfather", "Aunt", "Uncle", "Sibling", "Guardian"];

/** What to check in: a patient on file (optionally as their name on NCH's
 * Occupancy Tracker, 0051), an approved referral, or a referral for someone on file. */
export type CheckInTarget =
  | { patient: Patient; sheetRow?: HouseSheetPerson; referral?: undefined }
  | { referral: Referral; patient?: undefined; sheetRow?: undefined };

interface CheckInDialogProps {
  target: CheckInTarget | null;
  onOpenChange: (open: boolean) => void;
  onCheckedIn?: (patientId: string) => void;
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** The sheet's free-text relationship ("mother", "Grand mother") as one of the form's choices. */
function relationshipFromSheet(raw: string | null): string {
  const r = norm(raw).replace(/\s/g, "");
  return RELATIONSHIPS.find((x) => x.toLowerCase() === r) ?? (r ? "Guardian" : "");
}

/** Patients already on file who could be the referral's child: same last name and first name (first word). */
// ponytail: exact-name match only; reuse the house sheet matcher (lib/utils/house-sheet) if duplicate records pile up.
function possibleMatches(referral: Referral, patients: Patient[]): Patient[] {
  const last = norm(referral.patientLastName ?? referral.patientName.split(" ").slice(-1)[0]);
  const first = norm(referral.patientFirstName ?? referral.patientName).split(/\s+/)[0];
  if (!last) return [];
  return patients.filter((p) => norm(p.lastName) === last && norm(p.firstName).split(/\s+/)[0] === first);
}

/**
 * The one door into the house (ops.check_in, 0049): bed, carer, arrival day,
 * expected check-out and the next appointment, saved in one transaction.
 * Keyed by the caller on the target, so every open starts clean.
 */
export function CheckInDialog({ target, onOpenChange, onCheckedIn }: CheckInDialogProps) {
  const { patients, carers, stays } = usePatientsData();
  const { rooms, units, bedPositions } = useHouseLayout();
  const referral = target?.referral;
  const sheetRow = target?.sheetRow;
  const matches = referral ? possibleMatches(referral, patients) : [];

  const [recordId, setRecordId] = React.useState<string>(target?.patient?.id ?? NEW_RECORD);
  const [unitId, setUnitId] = React.useState("");
  // From the sheet: the first day of this unbroken run is the arrival.
  const [checkInAt, setCheckInAt] = React.useState(sheetRow && sheetRow.runStartedOn <= todayIso() ? sheetRow.runStartedOn : todayIso());
  const [expectedCheckoutAt, setExpectedCheckoutAt] = React.useState("");
  const [carerChoice, setCarerChoice] = React.useState<string>("");
  const [carerName, setCarerName] = React.useState("");
  const [carerRelationship, setCarerRelationship] = React.useState("");
  const [carerMobile, setCarerMobile] = React.useState("");
  const [apptDate, setApptDate] = React.useState("");
  const [apptTime, setApptTime] = React.useState("08:00");
  const [apptClinic, setApptClinic] = React.useState("");
  const [needsTransport, setNeedsTransport] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);

  const patientId = recordId === NEW_RECORD ? null : recordId;
  const patient = patientId ? patients.find((p) => p.id === patientId) : undefined;
  const onFile = patientId ? carers.filter((c) => c.patientId === patientId && !c.effectiveTo) : [];
  // The sheet's carer, when they are already on the record, is that record.
  const sheetCarerOnFile = sheetRow?.carerName ? onFile.find((c) => norm(c.name) === norm(sheetRow.carerName)) : undefined;
  const carerOptions = [
    ...onFile.map((c) => ({ value: c.id, label: `${c.name}${c.relationship ? ` (${c.relationship})` : ""}` })),
    ...(referral?.carerName ? [{ value: REFERRAL_CARER, label: `${referral.carerName} (from the referral)` }] : []),
    ...(sheetRow?.carerName && !sheetCarerOnFile
      ? [{ value: SHEET_CARER, label: `${sheetRow.carerName}${sheetRow.relationship ? ` (${sheetRow.relationship})` : ""} (from the sheet)` }]
      : []),
    { value: NEW_CARER, label: "Someone else…" },
  ];
  const carer = carerChoice || sheetCarerOnFile?.id || (sheetRow?.carerName && !sheetCarerOnFile ? SHEET_CARER : carerOptions[0].value);
  const beds = assignableBeds(units, bedPositions, stays, rooms);
  const unplaced = beds.filter((b) => b.unit.x === null).length;
  const name = patient ? `${patient.firstName} ${patient.lastName}` : referral?.patientName ?? "";
  const today = todayIso();

  const ready =
    !!unitId &&
    !!checkInAt &&
    (carer !== NEW_CARER || !carerName.trim() || !!carerRelationship) &&
    (!apptDate || !!apptClinic.trim());

  async function handleConfirm() {
    if (!target || !ready) return;
    setSubmitting(true);
    const newCarer = carer === NEW_CARER && carerName.trim();
    const fromSheet = carer === SHEET_CARER && sheetRow;
    const { data, error } = sheetRow
      ? await createClient()
          .schema("ops")
          .rpc("admit_from_sheet", {
            p_sheet_row_id: sheetRow.id,
            p_unit_id: unitId,
            p_check_in_at: checkInAt,
            p_patient_id: patientId,
            p_referral: null,
            p_carer_id: carer !== NEW_CARER && carer !== SHEET_CARER ? carer : null,
            p_carer_name: fromSheet ? sheetRow.carerName : newCarer ? carerName.trim() : carer === NEW_CARER ? "" : null,
            p_carer_relationship: fromSheet ? relationshipFromSheet(sheetRow.relationship) || "Guardian" : newCarer ? carerRelationship : null,
            p_carer_mobile: fromSheet ? sheetRow.phone : newCarer ? carerMobile.trim() || null : null,
            p_expected_checkout_at: expectedCheckoutAt || null,
          })
      : await createClient()
          .schema("ops")
          .rpc("check_in", {
            p_unit_id: unitId,
            p_check_in_at: checkInAt,
            p_patient_id: patientId,
            p_referral_id: referral?.id ?? null,
            p_carer_id: carer !== NEW_CARER && carer !== REFERRAL_CARER ? carer : null,
            // "" (not null) when "Someone else" is left blank: no carer, rather
            // than the function falling back to the referral's.
            p_carer_name: carer === NEW_CARER ? carerName.trim() : null,
            p_carer_relationship: newCarer ? carerRelationship : null,
            p_carer_mobile: newCarer ? carerMobile.trim() || null : null,
            p_expected_checkout_at: expectedCheckoutAt || null,
            p_appt_date: apptDate || null,
            p_appt_time: apptDate ? apptTime : null,
            p_appt_clinic: apptDate ? apptClinic.trim() : null,
            p_appt_purpose: null,
            p_appt_needs_transport: apptDate ? needsTransport : false,
          });
    setSubmitting(false);
    if (error) {
      toast.error(`Couldn't check in: ${error.message}`);
      return;
    }
    await Promise.all([patientsStore.refetch(), referralsStore.refetch(), houseSheetPeopleStore.refetch(), bedNightsStore.refetch()]);
    toast.success(`${name} checked in`);
    onCheckedIn?.((data as { patient_id: string }).patient_id);
    onOpenChange(false);
  }

  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Check in {name}</DialogTitle>
          <DialogDescription>
            Assigns the bed and records the stay. Families already in the house can be entered with the day they arrived.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {referral && matches.length > 0 && (
            <Field>
              <FieldLabel htmlFor="record">Patient record</FieldLabel>
              <Select value={recordId} onValueChange={(v) => { setRecordId(v); setCarerChoice(""); }}>
                <SelectTrigger id="record" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NEW_RECORD}>Create a new record</SelectItem>
                  {matches.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      Already on file: {p.firstName} {p.lastName} (#{p.patientNumber}{p.birthDate ? `, born ${p.birthDate}` : ""})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>A patient with this name is already on file. Pick them if it is the same child.</FieldDescription>
            </Field>
          )}

          <Field>
            <FieldLabel htmlFor="bed">Bed</FieldLabel>
            <Select value={unitId} onValueChange={setUnitId}>
              <SelectTrigger id="bed" className="w-full">
                <SelectValue placeholder={beds.length ? "Select an available bed" : "No beds available"} />
              </SelectTrigger>
              <SelectContent>
                {beds.map((b) => (
                  <SelectItem key={b.unit.id} value={b.unit.id}>
                    {b.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {unplaced > 0 && (
              <FieldDescription>
                {unplaced} {unplaced === 1 ? "bed is" : "beds are"} not yet placed on the floor plan.
              </FieldDescription>
            )}
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="checkInAt">Arrived on</FieldLabel>
              <Input id="checkInAt" type="date" max={today} value={checkInAt} onChange={(e) => setCheckInAt(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="expectedCheckoutAt">Expected check-out (optional)</FieldLabel>
              <Input
                id="expectedCheckoutAt"
                type="date"
                min={checkInAt}
                value={expectedCheckoutAt}
                onChange={(e) => setExpectedCheckoutAt(e.target.value)}
              />
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="carer">Carer staying with them</FieldLabel>
            <Select value={carer} onValueChange={setCarerChoice}>
              <SelectTrigger id="carer" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {carerOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {carer === NEW_CARER && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field className="sm:col-span-3">
                <FieldLabel htmlFor="carerName">Carer&apos;s full name</FieldLabel>
                <Input id="carerName" value={carerName} onChange={(e) => setCarerName(e.target.value)} />
                <FieldDescription>Leave blank if no carer is staying.</FieldDescription>
              </Field>
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="carerRelationship">Relationship</FieldLabel>
                <Select value={carerRelationship} onValueChange={setCarerRelationship}>
                  <SelectTrigger id="carerRelationship" className="w-full">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {RELATIONSHIPS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="carerMobile">Mobile</FieldLabel>
                <Input id="carerMobile" inputMode="tel" placeholder="09XXXXXXXXX" value={carerMobile} onChange={(e) => setCarerMobile(e.target.value)} />
              </Field>
            </div>
          )}

          {sheetRow ? (
            <p className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
              {sheetRow.nextAppointmentOn
                ? `Next appointment from NCH's sheet: ${formatDate(sheetRow.nextAppointmentOn)}. It is added with the ride box ticked, and follows the sheet if NCH changes it.`
                : "NCH's sheet has no dated next appointment yet; it is added when they fill it in."}
            </p>
          ) : (
            <div className="flex flex-col gap-3 rounded-md border p-3">
              <span className="text-sm font-medium">Next hospital appointment (optional)</span>
              {referral?.nextAppointmentNote && (
                <span className="text-xs text-muted-foreground">From the referral: {referral.nextAppointmentNote}</span>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel htmlFor="apptDate">Date</FieldLabel>
                  <Input id="apptDate" type="date" value={apptDate} onChange={(e) => setApptDate(e.target.value)} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="apptTime">Time</FieldLabel>
                  <Input id="apptTime" type="time" value={apptTime} onChange={(e) => setApptTime(e.target.value)} />
                </Field>
              </div>
              {apptDate && (
                <>
                  <Field>
                    <FieldLabel htmlFor="apptClinic">Clinic</FieldLabel>
                    <Input id="apptClinic" placeholder="e.g. NCH Pediatric Oncology" value={apptClinic} onChange={(e) => setApptClinic(e.target.value)} />
                  </Field>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={needsTransport} onCheckedChange={(v) => setNeedsTransport(!!v)} />
                    Needs a ride (goes on the transport manifest)
                  </label>
                </>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!ready || submitting} onClick={handleConfirm}>
            {submitting ? "Checking in…" : "Check in"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
