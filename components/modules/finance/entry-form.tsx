"use client";

import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cashEntries, programs } from "@/lib/mock-data";
import { useLocalCollection } from "@/lib/store/use-mock-store";
import { TODAY_ISO } from "@/lib/utils/seeded-random";
import { newId } from "@/lib/utils/id";
import type { CashEntryDirection, CashEntrySource } from "@/lib/types/finance";

const inflowSources: CashEntrySource[] = ["cash_donation", "in_kind_donation", "capital_infusion", "grant", "fundraising_event", "interest", "inter_entity_transfer"];
const outflowSources: CashEntrySource[] = ["program_expense", "payroll", "rent_utilities", "vehicle_fuel", "admin_ops", "emergency_assistance", "burial_assistance"];

function sourceLabel(source: string) {
  return source.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

const schema = z.object({
  direction: z.enum(["inflow", "outflow"]),
  source: z.string().min(1, "Select a source"),
  entity: z.enum(["US_501C3", "PH_SEC"]),
  amount: z.number().positive("Amount must be greater than 0"),
  programId: z.string().optional(),
  description: z.string().min(2, "Add a short description"),
});

type FormValues = z.infer<typeof schema>;

export function EntryForm() {
  const router = useRouter();
  const { addItem } = useLocalCollection("cash-entries", cashEntries);
  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { direction: "outflow", source: "", entity: "PH_SEC", description: "" },
  });

  const direction = watch("direction") as CashEntryDirection;
  const sources = direction === "inflow" ? inflowSources : outflowSources;

  function onSubmit(values: FormValues) {
    addItem({
      id: newId("cash-new"),
      date: TODAY_ISO,
      direction: values.direction,
      source: values.source as CashEntrySource,
      entity: values.entity,
      currency: values.entity === "US_501C3" ? "USD" : "PHP",
      amount: values.amount,
      programId: values.direction === "outflow" ? values.programId : undefined,
      description: values.description,
      approvalStatus: "pending",
    });
    toast.success("Cash entry recorded — pending approval");
    router.push("/finance");
  }

  return (
    <Card className="max-w-xl">
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit(onSubmit)}>
          <FieldGroup>
            <Field>
              <FieldLabel>Direction</FieldLabel>
              <Controller
                name="direction"
                control={control}
                render={({ field }) => (
                  <RadioGroup value={field.value} onValueChange={field.onChange} className="flex gap-4">
                    <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="inflow" /> Inflow</label>
                    <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="outflow" /> Outflow</label>
                  </RadioGroup>
                )}
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field data-invalid={!!errors.source}>
                <FieldLabel htmlFor="source">Source</FieldLabel>
                <Controller
                  name="source"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="source" className="w-full"><SelectValue placeholder="Select source" /></SelectTrigger>
                      <SelectContent>
                        {sources.map((s) => (
                          <SelectItem key={s} value={s}>{sourceLabel(s)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                <FieldError errors={[errors.source]} />
              </Field>

              <Field>
                <FieldLabel>Entity</FieldLabel>
                <Controller
                  name="entity"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PH_SEC">PH · SEC</SelectItem>
                        <SelectItem value="US_501C3">US · 501(c)(3)</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
            </div>

            {direction === "outflow" && (
              <Field>
                <FieldLabel>Program Allocation</FieldLabel>
                <Controller
                  name="programId"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full"><SelectValue placeholder="Select program" /></SelectTrigger>
                      <SelectContent>
                        {programs.map((p) => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
            )}

            <Field data-invalid={!!errors.amount}>
              <FieldLabel htmlFor="amount">Amount</FieldLabel>
              <Input id="amount" type="number" min={0} step="0.01" {...register("amount", { valueAsNumber: true })} />
              <FieldError errors={[errors.amount]} />
            </Field>

            <Field data-invalid={!!errors.description}>
              <FieldLabel htmlFor="description">Description</FieldLabel>
              <Textarea id="description" rows={2} {...register("description")} />
              <FieldError errors={[errors.description]} />
            </Field>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting}>Record Entry</Button>
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
