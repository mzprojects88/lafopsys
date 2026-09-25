"use client";

import * as React from "react";

import { useRouter, useSearchParams } from "next/navigation";
import { useForm, useWatch, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { PageHeader } from "@/components/patterns/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel, FieldSeparator } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FloorPlanBedPicker } from "@/components/modules/house-ops/floor-plan/floor-plan-bed-picker";
import { diagnoses, treatmentPhases, provinces, hospitals } from "@/lib/mock-data";
import { useReferralsData } from "@/lib/hooks/use-referrals-collection";
import { useHouseSheetPeople } from "@/lib/hooks/use-house-sheet-collection";
import { splitName } from "@/lib/utils/house-sheet";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/rbac/use-role";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import { patientsStore, usePatientsData } from "@/lib/hooks/use-patients-collection";
import { referralsStore } from "@/lib/hooks/use-referrals-collection";
import { houseSheetPeopleStore } from "@/lib/hooks/use-house-sheet-collection";
import { bedNightsStore } from "@/lib/hooks/use-bed-nights-collection";
import { useHouseLayout } from "@/lib/hooks/use-house-layout-collection";
import { assignableBeds } from "@/lib/utils/beds";
import { ArrivalFields, arrivalFromPickups, arrivalInput, arrivalReady, type ArrivalDraft } from "@/components/modules/patients/arrival-fields";
import { usePickups } from "@/lib/hooks/use-pickups-collection";
import { recordArrival } from "@/lib/hooks/use-arrival-rides-collection";
import { useBedReservations } from "@/lib/hooks/use-bed-reservations";
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
import { EmptyState } from "@/components/patterns/empty-state";
import { formatDate, todayIso } from "@/lib/utils/date";
import type { Referral } from "@/lib/types/patient";

const schema = z.object({
  patientFirstName: z.string().min(1, "First name is required"),
  patientLastName: z.string().min(1, "Last name is required"),
  patientBirthDate: z.string().min(1, "Birthdate is required"),
  patientSex: z.enum(["M", "F"]),
  department: z.string().min(1, "Select a department"),
  diagnosisId: z.string().min(1, "Select a diagnosis"),
  treatmentPhaseId: z.string().min(1, "Select a treatment phase"),
  provinceId: z.string().min(1, "Select a province"),
  rawAddress: z.string().min(2, "Address is required"),
  urgency: z.enum(["routine", "urgent", "emergency"]),
  hospitalId: z.string().min(1, "Select the referring hospital"),
  referringPerson: z.string().min(2, "Referring person is required"),
  carerName: z.string().min(2, "Carer name is required"),
  carerRelationship: z.string().min(1, "Select relationship"),
  carerMobile: z.string().min(7, "Mobile number is required"),
  nextAppointmentNote: z.string().optional(),
  transcriptionNote: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

const RELATIONSHIPS = ["Mother", "Father", "Grandmother", "Aunt", "Guardian"];

function NewReferralForm() {
  const router = useRouter();
  const { user } = useRole();
  const { addReferral } = useReferralsData();
  // ?fromSheet=<row id>: the form opens pre-filled from a name on the house
  // sheet and, once submitted, that row follows the referral.
  const params = useSearchParams();
  const fromSheetParam = params.get("fromSheet");
  const fromSheet = fromSheetParam && /^[0-9a-f-]{36}$/i.test(fromSheetParam) ? fromSheetParam : null;
  const { people: sheetPeople } = useHouseSheetPeople();
  const sheetRow = fromSheet ? sheetPeople.find((p) => p.id === fromSheet) : undefined;
  const { canEdit: canEditModule, loading: accessLoading } = useModuleAccess();
  const canEdit = canEditModule("patients");
  // From NCH's sheet the child is already at the house: this form admits
  // them in the same save (ops.admit_from_sheet, 0051) -- bed and arrival day.
  const { stays } = usePatientsData();
  const { rooms, units, bedPositions } = useHouseLayout();
  const { holdFor, reservations } = useBedReservations();
  // A bed reserved for this child (0065) opens chosen; nobody else's hold is offered.
  const hold = sheetRow ? holdFor(null, sheetRow.id) : undefined;
  const beds = assignableBeds(units, bedPositions, stays, rooms, { holds: reservations, forHoldId: hold?.id });
  const [unitIdEdited, setUnitId] = React.useState("");
  // Only a bed still on offer: one taken or reserved since the page opened drops out.
  const unitId = [unitIdEdited, hold?.unitId].find((id) => id && beds.some((b) => b.unit.id === id)) ?? "";
  const [appointment, setAppointment] = React.useState<AppointmentDraft>(EMPTY_APPOINTMENT);
  const [rulesDraft, setRulesDraft] = React.useState<RulesDraft>(EMPTY_RULES);
  const [checkInAt, setCheckInAt] = React.useState("");
  const [expectedCheckoutAt, setExpectedCheckoutAt] = React.useState("");
  const { pickups } = usePickups();
  // Until someone changes it, the arrival follows the pick-ups: on board a
  // LAF HOPE trip = arrived by it (the data may load after the form).
  const [arrivalEdited, setArrivalEdited] = React.useState<ArrivalDraft | null>(null);
  const arrival = arrivalEdited ?? arrivalFromPickups(pickups, sheetRow);
  const setArrival = setArrivalEdited;
  // A new record: always a first stay, so the full list of rules.
  const rules = useHouseRules(true, arrival);
  const manualAppointment = !sheetRow?.nextAppointmentOn;
  const arrivedOn = checkInAt || (sheetRow && sheetRow.runStartedOn <= todayIso() ? sheetRow.runStartedOn : todayIso());
  const {
    register,
    handleSubmit,
    control,
    reset,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      patientFirstName: "",
      patientLastName: "",
      patientBirthDate: "",
      patientSex: "M",
      department: "",
      diagnosisId: "",
      treatmentPhaseId: "",
      provinceId: "",
      rawAddress: "",
      urgency: "routine",
      hospitalId: "",
      referringPerson: "",
      carerName: "",
      carerRelationship: "",
      carerMobile: "",
      nextAppointmentNote: "",
      transcriptionNote: `Transcribed from hospital referral sheet on ${todayIso()} by ${user}.`,
    },
  });

  const firstName = useWatch({ control, name: "patientFirstName" });

  const prefilledFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!sheetRow || prefilledFor.current === sheetRow.id) return;
    prefilledFor.current = sheetRow.id;
    const { first, last } = splitName(sheetRow.patientName);
    const rel = (sheetRow.relationship ?? "").trim().toLowerCase();
    const relationship = RELATIONSHIPS.find((r) => r.toLowerCase() === rel) ?? (rel ? "Guardian" : "");
    reset({
      ...getValues(),
      patientFirstName: first,
      patientLastName: last,
      rawAddress: sheetRow.address ?? "",
      carerName: sheetRow.carerName ?? "",
      carerRelationship: relationship,
      carerMobile: sheetRow.phone ?? "",
      nextAppointmentNote: [sheetRow.nextAppointmentRaw, sheetRow.treatment].filter(Boolean).join(" · "),
      hospitalId: "hosp-nch",
      referringPerson: "NCH Occupancy Tracker",
      department: "Medical Social Service",
      transcriptionNote: `Encoded from the house Occupancy Tracker (on the sheet since ${sheetRow.firstSeenOn}) on ${todayIso()} by ${user}.`,
    });
  }, [sheetRow, reset, getValues, user]);

  async function onSubmit(values: FormValues) {
    const supabase = createClient();
    if (fromSheet) {
      if (!unitId) {
        toast.error("Pick tonight's bed.");
        return;
      }
      if (!arrivalReady(arrival)) {
        toast.error("Say how they arrived.");
        return;
      }
      if (manualAppointment && !appointmentReady(appointment)) {
        toast.error("Give the appointment's clinic.");
        return;
      }
      if (!rulesDraft.discussed) {
        toast.error("Discuss the house rules first.");
        return;
      }
      const { data, error } = await supabase.schema("ops").rpc("admit_from_sheet", {
        p_sheet_row_id: fromSheet,
        p_unit_id: unitId,
        p_check_in_at: arrivedOn,
        p_patient_id: null,
        p_referral: {
          patient_first_name: values.patientFirstName,
          patient_last_name: values.patientLastName,
          patient_birth_date: values.patientBirthDate,
          patient_sex: values.patientSex,
          treatment_phase_id: values.treatmentPhaseId,
          province_id: values.provinceId,
          raw_address: values.rawAddress,
          carer_name: values.carerName,
          carer_relationship: values.carerRelationship,
          carer_mobile: values.carerMobile,
          next_appointment_note: values.nextAppointmentNote || null,
          hospital_id: values.hospitalId,
          department: values.department,
          referring_person: values.referringPerson,
          urgency: values.urgency,
          diagnosis_ids: [values.diagnosisId],
        },
        p_carer_id: null,
        p_carer_name: null,
        p_carer_relationship: null,
        p_carer_mobile: null,
        p_expected_checkout_at: expectedCheckoutAt || null,
        p_rules_discussed: rulesDraft.discussed,
      });
      if (error) {
        toast.error(`Couldn't admit: ${error.message}`);
        return;
      }
      const { stay_id: stayId, patient_id: patientId } = data as { stay_id: string; patient_id: string };
      const arrived = await recordArrival(stayId, arrivalInput(arrival));
      const problems = arrived.ok ? [] : [`how they arrived (${arrived.error}); set it on the Stays tab`];
      problems.push(
        ...(await finishAdmission({
          stayId,
          patientId,
          appointment: manualAppointment ? appointment : null,
          rules: rulesDraft,
          group: rules.group,
          groupTalkExists: !!rules.groupTalk,
          arrived: arrived.ok ? arrived : null,
          hold,
          unitId,
        }))
      );
      if (problems.length) toast.warning(`Admitted, but not saved: ${problems.join("; ")}.`);
      await Promise.all([patientsStore.refetch(), referralsStore.refetch(), houseSheetPeopleStore.refetch(), bedNightsStore.refetch()]);
      toast.success(`${values.patientFirstName} ${values.patientLastName} admitted`);
      router.push(`/patients/${patientId}`);
      return;
    }
    const { data: userData } = await supabase.auth.getUser();

    const referral: Referral = {
      id: crypto.randomUUID(),
      patientName: `${values.patientFirstName} ${values.patientLastName}`,
      referringPerson: values.referringPerson,
      department: values.department,
      urgency: values.urgency,
      date: todayIso(),
      status: "submitted",
      hospitalId: values.hospitalId,
      submittedByStaffId: userData.user?.id,
      patientFirstName: values.patientFirstName,
      patientLastName: values.patientLastName,
      patientBirthDate: values.patientBirthDate,
      patientSex: values.patientSex,
      diagnosisIds: [values.diagnosisId],
      treatmentPhaseId: values.treatmentPhaseId,
      provinceId: values.provinceId,
      rawAddress: values.rawAddress,
      carerName: values.carerName,
      carerRelationship: values.carerRelationship,
      carerMobile: values.carerMobile,
      nextAppointmentNote: values.nextAppointmentNote || undefined,
      transcriptionNote: values.transcriptionNote || undefined,
    };

    const result = await addReferral(referral);
    if (!result.ok) {
      toast.error(`Couldn't submit the referral: ${result.error}`);
      return;
    }

    toast.success("Referral submitted");
    router.push("/patients/referrals");
  }

  if (!accessLoading && !canEdit) {
    return <EmptyState title="Your access to Patients is view only" description="Ask an admin if you should be encoding referrals." />;
  }

  return (
    <div className="flex max-w-2xl flex-1 flex-col gap-6">
      <PageHeader
        title={fromSheet ? "Admit New Child" : "New Referral"}
        description={
          fromSheet
            ? `From NCH's Occupancy Tracker${sheetRow ? ` (on the sheet since ${formatDate(sheetRow.runStartedOn)})` : ""}. Complete what the sheet does not carry, pick tonight's bed, and save once.`
            : "Transcribe the patient and carer from the hospital's referral sheet — LAF House will approve and admit on arrival."
        }
      />
      <Card>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)}>
            <FieldGroup>
              <span className="text-base font-medium text-foreground">Patient</span>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field data-invalid={!!errors.patientFirstName}>
                  <FieldLabel htmlFor="patientFirstName">First Name</FieldLabel>
                  <Input id="patientFirstName" {...register("patientFirstName")} />
                  <FieldError errors={[errors.patientFirstName]} />
                </Field>
                <Field data-invalid={!!errors.patientLastName}>
                  <FieldLabel htmlFor="patientLastName">Last Name</FieldLabel>
                  <Input id="patientLastName" {...register("patientLastName")} />
                  <FieldError errors={[errors.patientLastName]} />
                </Field>
                <Field data-invalid={!!errors.patientBirthDate}>
                  <FieldLabel htmlFor="patientBirthDate">Birthdate</FieldLabel>
                  <Input id="patientBirthDate" type="date" {...register("patientBirthDate")} />
                  <FieldError errors={[errors.patientBirthDate]} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="patientSex">Sex</FieldLabel>
                  <Controller
                    name="patientSex"
                    control={control}
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger id="patientSex" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="M">Male</SelectItem>
                          <SelectItem value="F">Female</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field data-invalid={!!errors.diagnosisId}>
                  <FieldLabel htmlFor="diagnosisId">Diagnosis</FieldLabel>
                  <Controller
                    name="diagnosisId"
                    control={control}
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger id="diagnosisId" className="w-full">
                          <SelectValue placeholder="Select diagnosis" />
                        </SelectTrigger>
                        <SelectContent>
                          {diagnoses.map((d) => (
                            <SelectItem key={d.id} value={d.id}>
                              {d.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <FieldError errors={[errors.diagnosisId]} />
                </Field>
                <Field data-invalid={!!errors.treatmentPhaseId}>
                  <FieldLabel htmlFor="treatmentPhaseId">Treatment Phase</FieldLabel>
                  <Controller
                    name="treatmentPhaseId"
                    control={control}
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger id="treatmentPhaseId" className="w-full">
                          <SelectValue placeholder="Select phase" />
                        </SelectTrigger>
                        <SelectContent>
                          {treatmentPhases.map((t) => (
                            <SelectItem key={t.id} value={t.id}>
                              {t.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <FieldError errors={[errors.treatmentPhaseId]} />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field data-invalid={!!errors.provinceId}>
                  <FieldLabel htmlFor="provinceId">Province</FieldLabel>
                  <Controller
                    name="provinceId"
                    control={control}
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger id="provinceId" className="w-full">
                          <SelectValue placeholder="Select province" />
                        </SelectTrigger>
                        <SelectContent>
                          {provinces.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <FieldError errors={[errors.provinceId]} />
                </Field>
                <Field data-invalid={!!errors.urgency}>
                  <FieldLabel htmlFor="urgency">Urgency</FieldLabel>
                  <Controller
                    name="urgency"
                    control={control}
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger id="urgency" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="routine">Routine</SelectItem>
                          <SelectItem value="urgent">Urgent</SelectItem>
                          <SelectItem value="emergency">Emergency</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                </Field>
              </div>

              <Field data-invalid={!!errors.rawAddress}>
                <FieldLabel htmlFor="rawAddress">Home Address</FieldLabel>
                <Input id="rawAddress" placeholder="Street, barangay, city" {...register("rawAddress")} />
                <FieldError errors={[errors.rawAddress]} />
              </Field>

              <Field data-invalid={!!errors.nextAppointmentNote}>
                <FieldLabel htmlFor="nextAppointmentNote">Next Appointment (from hospital sheet)</FieldLabel>
                <Input
                  id="nextAppointmentNote"
                  placeholder="e.g. Chemo cycle 3, Oct 14 2026, Pediatric Onco"
                  {...register("nextAppointmentNote")}
                />
              </Field>

              <FieldSeparator />
              <span className="text-base font-medium text-foreground">Referring Hospital</span>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field data-invalid={!!errors.hospitalId}>
                  <FieldLabel htmlFor="hospitalId">Hospital</FieldLabel>
                  <Controller
                    name="hospitalId"
                    control={control}
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger id="hospitalId" className="w-full">
                          <SelectValue placeholder="Select hospital" />
                        </SelectTrigger>
                        <SelectContent>
                          {hospitals.map((h) => (
                            <SelectItem key={h.id} value={h.id}>
                              {h.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <FieldError errors={[errors.hospitalId]} />
                </Field>
                <Field data-invalid={!!errors.department}>
                  <FieldLabel htmlFor="department">Department</FieldLabel>
                  <Controller
                    name="department"
                    control={control}
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger id="department" className="w-full">
                          <SelectValue placeholder="Select department" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Pediatric Oncology">Pediatric Oncology</SelectItem>
                          <SelectItem value="Pediatric Hematology">Pediatric Hematology</SelectItem>
                          <SelectItem value="Medical Social Service">Medical Social Service</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <FieldError errors={[errors.department]} />
                </Field>
              </div>

              <Field data-invalid={!!errors.referringPerson}>
                <FieldLabel htmlFor="referringPerson">Referring Person</FieldLabel>
                <Input id="referringPerson" placeholder="e.g. Dr. Aquino (NCH Onco)" {...register("referringPerson")} />
                <FieldError errors={[errors.referringPerson]} />
              </Field>

              <FieldSeparator />
              <span className="text-base font-medium text-foreground">Carer</span>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field data-invalid={!!errors.carerName}>
                  <FieldLabel htmlFor="carerName">Full Name</FieldLabel>
                  <Input id="carerName" {...register("carerName")} />
                  <FieldError errors={[errors.carerName]} />
                </Field>
                <Field data-invalid={!!errors.carerRelationship}>
                  <FieldLabel htmlFor="carerRelationship">Relationship to Patient</FieldLabel>
                  <Controller
                    name="carerRelationship"
                    control={control}
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger id="carerRelationship" className="w-full">
                          <SelectValue placeholder="Select relationship" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Mother">Mother</SelectItem>
                          <SelectItem value="Father">Father</SelectItem>
                          <SelectItem value="Grandmother">Grandmother</SelectItem>
                          <SelectItem value="Aunt">Aunt</SelectItem>
                          <SelectItem value="Guardian">Guardian</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <FieldError errors={[errors.carerRelationship]} />
                </Field>
              </div>

              <Field data-invalid={!!errors.carerMobile}>
                <FieldLabel htmlFor="carerMobile">Mobile Number</FieldLabel>
                <Input id="carerMobile" placeholder="09XXXXXXXXX" {...register("carerMobile")} />
                <FieldError errors={[errors.carerMobile]} />
              </Field>

              {fromSheet ? (
                <>
                  <FieldSeparator />
                  <span className="text-base font-medium text-foreground">Admission</span>
                  <Field>
                    <FieldLabel>Tonight&apos;s bed</FieldLabel>
                    <FloorPlanBedPicker value={unitId} onChange={setUnitId} options={beds} />
                  </Field>
                  <ArrivalFields value={arrival} onChange={setArrival} arrivalDate={arrivedOn} />
                  {hold ? (
                    <p className="text-theme-xs text-muted-foreground">
                      A bed was reserved for them{hold.unitId === unitId ? "" : " (another bed is chosen, so the reserved one is freed)"}. Staying on it confirms it; tap another green bed if not.
                    </p>
                  ) : null}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="checkInAt">Arrived on</FieldLabel>
                      <Input id="checkInAt" type="date" max={todayIso()} value={arrivedOn} onChange={(e) => setCheckInAt(e.target.value)} />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="expectedCheckoutAt">Expected check-out (optional)</FieldLabel>
                      <Input id="expectedCheckoutAt" type="date" min={arrivedOn} value={expectedCheckoutAt} onChange={(e) => setExpectedCheckoutAt(e.target.value)} />
                    </Field>
                  </div>
                  {manualAppointment ? (
                    <NextAppointmentFields
                      value={appointment}
                      onChange={setAppointment}
                      note="NCH's sheet has no dated appointment. Ask the patient and carer whether the doctor set one."
                    />
                  ) : null}
                  <FieldSeparator />
                  <span className="text-base font-medium text-foreground">House rules (last step)</span>
                  <HouseRulesStep
                    name={firstName || "the child"}
                    firstStay
                    rules={rules}
                    value={rulesDraft}
                    onChange={setRulesDraft}
                  />
                </>
              ) : null}

              {fromSheet ? null : (
                <>
                  <FieldSeparator />
                  <Field>
                    <FieldLabel htmlFor="transcriptionNote">Transcription Note</FieldLabel>
                    <Textarea id="transcriptionNote" rows={2} {...register("transcriptionNote")} />
                  </Field>
                </>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => router.back()}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting || (!!fromSheet && !rulesDraft.discussed)}>
                  {isSubmitting ? "Saving…" : fromSheet ? "Admit" : "Submit Referral"}
                </Button>
              </div>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

/** useSearchParams needs a Suspense boundary for the static shell. */
export default function NewReferralPage() {
  return (
    <React.Suspense fallback={null}>
      <NewReferralForm />
    </React.Suspense>
  );
}
