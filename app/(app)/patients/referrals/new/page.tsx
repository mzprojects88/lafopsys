"use client";

import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
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
import { diagnoses, treatmentPhases, provinces, hospitals } from "@/lib/mock-data";
import { useReferralsData } from "@/lib/hooks/use-referrals-collection";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/rbac/use-role";
import { TODAY_ISO } from "@/lib/utils/seeded-random";
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

export default function NewReferralPage() {
  const router = useRouter();
  const { user } = useRole();
  const { addReferral } = useReferralsData();
  const {
    register,
    handleSubmit,
    control,
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
      transcriptionNote: `Transcribed from hospital referral sheet on ${TODAY_ISO} by ${user}.`,
    },
  });

  async function onSubmit(values: FormValues) {
    const supabase = createClient();
    const { data: userData } = await supabase.auth.getUser();

    const referral: Referral = {
      id: crypto.randomUUID(),
      patientName: `${values.patientFirstName} ${values.patientLastName}`,
      referringPerson: values.referringPerson,
      department: values.department,
      urgency: values.urgency,
      date: TODAY_ISO,
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

  return (
    <div className="flex max-w-2xl flex-1 flex-col gap-6">
      <PageHeader
        title="New Referral"
        description="Transcribe the patient and carer from the hospital's referral sheet — LAF House will approve and admit on arrival."
      />
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit(onSubmit)}>
            <FieldGroup>
              <span className="text-sm font-semibold text-muted-foreground">Patient</span>
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
              <span className="text-sm font-semibold text-muted-foreground">Referring Hospital</span>

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
              <span className="text-sm font-semibold text-muted-foreground">Carer</span>

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

              <FieldSeparator />

              <Field>
                <FieldLabel htmlFor="transcriptionNote">Transcription Note</FieldLabel>
                <Textarea id="transcriptionNote" rows={2} {...register("transcriptionNote")} />
              </Field>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => router.back()}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Submitting…" : "Submit Referral"}
                </Button>
              </div>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
