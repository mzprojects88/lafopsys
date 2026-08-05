"use client";

import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { PageHeader } from "@/components/patterns/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { referrals } from "@/lib/mock-data";
import { useLocalCollection } from "@/lib/store/use-mock-store";
import { TODAY_ISO } from "@/lib/utils/seeded-random";
import { newId } from "@/lib/utils/id";

const schema = z.object({
  patientName: z.string().min(2, "Patient name is required"),
  referringPerson: z.string().min(2, "Referring person is required"),
  department: z.string().min(1, "Select a department"),
  urgency: z.enum(["routine", "urgent", "emergency"]),
});

type FormValues = z.infer<typeof schema>;

export default function NewReferralPage() {
  const router = useRouter();
  const { addItem } = useLocalCollection("referrals", referrals);
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { patientName: "", referringPerson: "", department: "", urgency: "routine" },
  });

  function onSubmit(values: FormValues) {
    addItem({
      id: newId("ref-new"),
      ...values,
      date: TODAY_ISO,
      status: "submitted",
    });
    toast.success("Referral submitted");
    router.push("/patients/referrals");
  }

  return (
    <div className="flex max-w-xl flex-1 flex-col gap-6">
      <PageHeader title="New Referral" description="NCH referral intake — date, referring person, department, urgency." />
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit(onSubmit)}>
            <FieldGroup>
              <Field data-invalid={!!errors.patientName}>
                <FieldLabel htmlFor="patientName">Patient Name</FieldLabel>
                <Input id="patientName" placeholder="Full name" {...register("patientName")} />
                <FieldError errors={[errors.patientName]} />
              </Field>
              <Field data-invalid={!!errors.referringPerson}>
                <FieldLabel htmlFor="referringPerson">Referring Person</FieldLabel>
                <Input id="referringPerson" placeholder="e.g. Dr. Aquino (NCH Onco)" {...register("referringPerson")} />
                <FieldError errors={[errors.referringPerson]} />
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
              <Field>
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
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => router.back()}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  Submit Referral
                </Button>
              </div>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
