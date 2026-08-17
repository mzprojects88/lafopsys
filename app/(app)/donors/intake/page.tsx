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
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { unitsOfMeasure } from "@/lib/mock-data";
import { useDonorsData } from "@/lib/hooks/use-donors-collection";
import { TODAY_ISO } from "@/lib/utils/seeded-random";

const schema = z.object({
  donorId: z.string().min(1, "Select a donor"),
  receivingEntity: z.enum(["US_501C3", "PH_SEC"]),
  kind: z.enum(["cash", "in_kind"]),
  itemDescription: z.string().optional(),
  quantity: z.number().optional(),
  uomId: z.string().optional(),
  unitValue: z.number().optional(),
  cashAmount: z.number().optional(),
});

type FormValues = z.infer<typeof schema>;

export default function DonationIntakePage() {
  const router = useRouter();
  const { donors, addDonation } = useDonorsData();
  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { donorId: "", receivingEntity: "PH_SEC", kind: "in_kind" },
  });

  const kind = watch("kind");
  const quantity = watch("quantity") ?? 0;
  const unitValue = watch("unitValue") ?? 0;

  async function onSubmit(values: FormValues) {
    const totalValue = values.kind === "cash" ? values.cashAmount ?? 0 : (values.quantity ?? 0) * (values.unitValue ?? 0);
    const result = await addDonation({
      donorId: values.donorId,
      date: TODAY_ISO,
      receivingEntity: values.receivingEntity,
      kind: values.kind,
      itemDescription: values.kind === "in_kind" ? values.itemDescription : undefined,
      quantity: values.kind === "in_kind" ? values.quantity : undefined,
      uomId: values.kind === "in_kind" ? values.uomId : undefined,
      unitValue: values.kind === "in_kind" ? values.unitValue : undefined,
      totalValue,
      currency: values.receivingEntity === "US_501C3" ? "USD" : "PHP",
    });
    if (!result.ok) {
      toast.error(`Couldn't record the donation: ${result.error}`);
      return;
    }
    // Inventory lot creation depends on the laf-inventory side of the
    // Donations Bridge, which hasn't been built yet -- don't claim it happened.
    toast.success(values.kind === "in_kind" ? "In-kind donation recorded" : "Cash donation recorded");
    router.push("/donors");
  }

  return (
    <div className="flex max-w-2xl flex-1 flex-col gap-6">
      <PageHeader title="Donation Intake" description="Cash and in-kind in one flow." />
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit(onSubmit)}>
            <FieldGroup>
              <Field data-invalid={!!errors.donorId}>
                <FieldLabel htmlFor="donorId">Donor</FieldLabel>
                <Controller
                  name="donorId"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="donorId" className="w-full"><SelectValue placeholder="Select donor" /></SelectTrigger>
                      <SelectContent>
                        {donors.map((d) => (
                          <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                <FieldError errors={[errors.donorId]} />
              </Field>

              <Field>
                <FieldLabel>Receiving Entity</FieldLabel>
                <FieldDescription>
                  Mandatory — a gift to one entity is not a gift to the other, and the tax documents differ completely.
                </FieldDescription>
                <Controller
                  name="receivingEntity"
                  control={control}
                  render={({ field }) => (
                    <RadioGroup value={field.value} onValueChange={field.onChange} className="flex gap-4">
                      <label className="flex items-center gap-2 text-sm">
                        <RadioGroupItem value="PH_SEC" /> PH · SEC
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <RadioGroupItem value="US_501C3" /> US · 501(c)(3)
                      </label>
                    </RadioGroup>
                  )}
                />
              </Field>

              <Field>
                <FieldLabel>Donation Type</FieldLabel>
                <Controller
                  name="kind"
                  control={control}
                  render={({ field }) => (
                    <RadioGroup value={field.value} onValueChange={field.onChange} className="flex gap-4">
                      <label className="flex items-center gap-2 text-sm">
                        <RadioGroupItem value="in_kind" /> In-Kind
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <RadioGroupItem value="cash" /> Cash
                      </label>
                    </RadioGroup>
                  )}
                />
              </Field>

              {kind === "in_kind" ? (
                <>
                  <Field>
                    <FieldLabel htmlFor="itemDescription">Item Description</FieldLabel>
                    <Input id="itemDescription" placeholder="e.g. Egg (30/Tray)" {...register("itemDescription")} />
                  </Field>
                  <div className="grid grid-cols-3 gap-3">
                    <Field>
                      <FieldLabel htmlFor="quantity">Quantity</FieldLabel>
                      <Input id="quantity" type="number" min={0} {...register("quantity", { valueAsNumber: true })} />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="uomId">UoM</FieldLabel>
                      <Controller
                        name="uomId"
                        control={control}
                        render={({ field }) => (
                          <Select value={field.value} onValueChange={field.onChange}>
                            <SelectTrigger id="uomId" className="w-full"><SelectValue placeholder="Unit" /></SelectTrigger>
                            <SelectContent>
                              {unitsOfMeasure.map((u) => (
                                <SelectItem key={u.id} value={u.id}>{u.code}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="unitValue">Unit Value (₱)</FieldLabel>
                      <Input id="unitValue" type="number" min={0} {...register("unitValue", { valueAsNumber: true })} />
                    </Field>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Total value: <span className="font-medium text-foreground">₱{(quantity * unitValue).toLocaleString()}</span>
                  </p>
                </>
              ) : (
                <Field>
                  <FieldLabel htmlFor="cashAmount">Amount</FieldLabel>
                  <Input id="cashAmount" type="number" min={0} {...register("cashAmount", { valueAsNumber: true })} />
                </Field>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
                <Button type="submit" disabled={isSubmitting}>Record Donation</Button>
              </div>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
