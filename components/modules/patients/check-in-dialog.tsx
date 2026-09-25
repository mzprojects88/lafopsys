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
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FloorPlanBedPicker } from "@/components/modules/house-ops/floor-plan/floor-plan-bed-picker";
import { createClient } from "@/lib/supabase/client";
import { patientsStore, usePatientsData } from "@/lib/hooks/use-patients-collection";
import { referralsStore } from "@/lib/hooks/use-referrals-collection";
import { houseSheetPeopleStore } from "@/lib/hooks/use-house-sheet-collection";
import { bedNightsStore } from "@/lib/hooks/use-bed-nights-collection";
import { useHouseLayout } from "@/lib/hooks/use-house-layout-collection";
import { assignableBeds } from "@/lib/utils/beds";
import { ArrivalFields, arrivalFromPickups, arrivalInput, arrivalReady, type ArrivalDraft } from "@/components/modules/patients/arrival-fields";
import {
  EMPTY_APPOINTMENT,
  EMPTY_RULES,
  HouseRulesStep,
  NextAppointmentFields,
  appointmentReady,
  finishAdmission,
  useHouseRules,
  type AppointmentDraft,
  type RulesDraft,
} from "@/components/modules/patients/admission-steps";
import { useBedReservations } from "@/lib/hooks/use-bed-reservations";
import { usePickups } from "@/lib/hooks/use-pickups-collection";
import { recordArrival } from "@/lib/hooks/use-arrival-rides-collection";
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
 * The one door into the house (ops.check_in, 0049), in two steps (user,
 * 2026-09-25): the details -- bed on the floor plan (a bed reserved for the
 * child comes chosen, to confirm or change), carer, arrival, the next
 * appointment even when NCH's sheet has none -- then the house rules. The
 * child is checked in only when the rules have been discussed; a family that
 * came with others (one LAF HOPE pick-up, one shared ride) can hear them as a
 * group, recorded once for the group (0065). Keyed by the caller on the
 * target, so every open starts clean.
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
  const [appointment, setAppointment] = React.useState<AppointmentDraft>(EMPTY_APPOINTMENT);
  const { pickups } = usePickups();
  const [arrival, setArrival] = React.useState<ArrivalDraft>(() => arrivalFromPickups(pickups, target?.sheetRow));
  const [submitting, setSubmitting] = React.useState(false);
  const [step, setStep] = React.useState<"details" | "rules">("details");
  const [rulesDraft, setRulesDraft] = React.useState<RulesDraft>(EMPTY_RULES);
  const { holdFor, reservations } = useBedReservations();

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
  // A bed reserved for this child (0065) is theirs to confirm; nobody else's hold is offered.
  const hold = holdFor(patientId, sheetRow?.id);
  const beds = assignableBeds(units, bedPositions, stays, rooms, { holds: reservations, forHoldId: hold?.id });
  // Only a bed still on offer: one taken or reserved since the dialog opened drops out.
  const bed = [unitId, hold?.unitId].find((id) => id && beds.some((b) => b.unit.id === id)) ?? "";
  // Returning families take the shorter list of rules (0054).
  const firstStay = !patientId || !stays.some((s) => s.patientId === patientId);
  const rules = useHouseRules(firstStay, arrival);
  // NCH's sheet gives no dated appointment: staff ask the family and type it in.
  const manualAppointment = !sheetRow?.nextAppointmentOn;
  const name = patient ? `${patient.firstName} ${patient.lastName}` : referral?.patientName ?? "";
  const today = todayIso();

  const ready =
    !!bed &&
    arrivalReady(arrival) &&
    !!checkInAt &&
    (carer !== NEW_CARER || !carerName.trim() || !!carerRelationship) &&
    appointmentReady(appointment);

  async function handleConfirm() {
    if (!target || !ready || !rulesDraft.discussed) return;
    setSubmitting(true);
    const newCarer = carer === NEW_CARER && carerName.trim();
    const fromSheet = carer === SHEET_CARER && sheetRow;
    const { data, error } = sheetRow
      ? await createClient()
          .schema("ops")
          .rpc("admit_from_sheet", {
            p_sheet_row_id: sheetRow.id,
            p_unit_id: bed,
            p_check_in_at: checkInAt,
            p_patient_id: patientId,
            p_referral: null,
            p_carer_id: carer !== NEW_CARER && carer !== SHEET_CARER ? carer : null,
            p_carer_name: fromSheet ? sheetRow.carerName : newCarer ? carerName.trim() : carer === NEW_CARER ? "" : null,
            p_carer_relationship: fromSheet ? relationshipFromSheet(sheetRow.relationship) || "Guardian" : newCarer ? carerRelationship : null,
            p_carer_mobile: fromSheet ? sheetRow.phone : newCarer ? carerMobile.trim() || null : null,
            p_expected_checkout_at: expectedCheckoutAt || null,
            p_rules_discussed: rulesDraft.discussed,
          })
      : await createClient()
          .schema("ops")
          .rpc("check_in", {
            p_unit_id: bed,
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
            p_rules_discussed: rulesDraft.discussed,
            p_appt_date: appointment.date || null,
            p_appt_time: appointment.date ? appointment.time : null,
            p_appt_clinic: appointment.date ? appointment.clinic.trim() : null,
            p_appt_purpose: null,
            p_appt_needs_transport: appointment.date ? appointment.needsTransport : false,
          });
    if (error) {
      setSubmitting(false);
      toast.error(`Couldn't check in: ${error.message}`);
      return;
    }
    const stayId = (data as { stay_id: string }).stay_id;
    const newPatientId = (data as { patient_id: string }).patient_id;
    // How they came is its own step (0052); the stay stands either way.
    const arrived = await recordArrival(stayId, arrivalInput(arrival));
    const problems = arrived.ok ? [] : [`how they arrived (${arrived.error}); set it on the Stays tab`];
    problems.push(
      ...(await finishAdmission({
        stayId,
        patientId: newPatientId,
        // check_in takes the appointment itself; the sheet's path does not.
        appointment: sheetRow && manualAppointment ? appointment : null,
        rules: rulesDraft,
        group: rules.group,
        groupTalkExists: !!rules.groupTalk,
        arrived: arrived.ok ? arrived : null,
        hold,
        unitId: bed,
      }))
    );
    setSubmitting(false);
    if (problems.length) toast.warning(`Checked in, but not saved: ${problems.join("; ")}.`);
    await Promise.all([patientsStore.refetch(), referralsStore.refetch(), houseSheetPeopleStore.refetch(), bedNightsStore.refetch()]);
    toast.success(`${name} checked in`);
    onCheckedIn?.((data as { patient_id: string }).patient_id);
    onOpenChange(false);
  }

  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{step === "details" ? `Check in ${name}` : `House rules · ${name}`}</DialogTitle>
          <DialogDescription>
            {step === "details"
              ? "Step 1 of 2: the bed and the details. Families already in the house can be entered with the day they arrived."
              : "Step 2 of 2: go through the house rules with the patient and carer. They are checked in once the rules are discussed."}
          </DialogDescription>
        </DialogHeader>

        {step === "details" ? (
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
                      Already on file: {p.firstName} {p.lastName} ({p.patientNumber}{p.birthDate ? `, born ${p.birthDate}` : ""})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>A patient with this name is already on file. Pick them if it is the same child.</FieldDescription>
            </Field>
          )}

          <Field>
            <FieldLabel>Bed</FieldLabel>
            <FloorPlanBedPicker value={bed} onChange={setUnitId} options={beds} />
            {hold ? (
              <FieldDescription>
                A bed was reserved for them{hold.unitId === bed ? "" : " (another bed is chosen, so the reserved one is freed)"}. Staying on it confirms it; tap another green bed if not.
              </FieldDescription>
            ) : null}
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

          <ArrivalFields value={arrival} onChange={setArrival} arrivalDate={checkInAt} />

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

          {sheetRow?.nextAppointmentOn ? (
            <p className="rounded-xl bg-muted/60 p-3 text-theme-xs text-muted-foreground">
              Next appointment from NCH&apos;s sheet: {formatDate(sheetRow.nextAppointmentOn)}. It is added with the ride box ticked, and follows the sheet if NCH changes it.
            </p>
          ) : (
            <NextAppointmentFields
              value={appointment}
              onChange={setAppointment}
              note={
                sheetRow
                  ? "NCH's sheet has no dated appointment. Ask the patient and carer whether the doctor set one."
                  : referral?.nextAppointmentNote
                    ? `From the referral: ${referral.nextAppointmentNote}`
                    : undefined
              }
            />
          )}
        </div>
        ) : (
          <HouseRulesStep name={name} firstStay={firstStay} rules={rules} value={rulesDraft} onChange={setRulesDraft} />
        )}

        <DialogFooter>
          {step === "details" ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button disabled={!ready} onClick={() => setStep("rules")}>
                Next: house rules
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" disabled={submitting} onClick={() => setStep("details")}>
                Back
              </Button>
              <Button disabled={!rulesDraft.discussed || submitting} onClick={handleConfirm}>
                {submitting ? "Checking in…" : "Check in"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
