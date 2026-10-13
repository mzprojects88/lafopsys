"use client";

import { useRouter } from "next/navigation";
import { useForm, useWatch, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import * as React from "react";
import { AlertTriangle, ExternalLink, Info } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useDonorsData } from "@/lib/hooks/use-donors-collection";
import { useCampaignsData } from "@/lib/hooks/use-campaigns-collection";

const NO_CAMPAIGN = "__none__";
import { useCashGifts } from "@/lib/hooks/use-cash-gifts";
import { PAYMENT_METHOD_LABEL, invoiceMatches } from "@/lib/utils/cash-gifts";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate, todayIso } from "@/lib/utils/date";
import { inventoryAppHref } from "@/lib/utils/inventory-app";
import type { PaymentMethod } from "@/lib/types/donor";

const METHODS = Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[];

const schema = z.object({
  // The day the gift was received. Was the frozen demo constant TODAY_ISO,
  // which put every donation ever keyed in on 2026-08-04.
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date"),
  donorId: z.string().min(1, "Select a donor"),
  receivingEntity: z.enum(["US_501C3", "PH_SEC"]),
  amount: z.number({ error: "Enter the amount" }).positive("Enter the amount").max(99_999_999, "That amount is too large"),
  paymentMethod: z.enum(["cash", "check", "bank_transfer", "gcash", "instapay", "other"]),
  invoiceNumber: z.string().trim().max(60, "60 characters at most"),
  campaignId: z.string().optional(),
  notes: z.string().trim().max(500, "500 characters at most"),
});

type FormValues = z.infer<typeof schema>;

/**
 * A cash gift, typed in by hand. Gifts in kind are recorded in LAF Inventory and nowhere else
 * (decided 2026-10-08): it posts each receipt to the donor list. Cash on accounting's Donation
 * Tracker arrives by itself (Donors > Cash gifts), so this form is for the gift that won't be there.
 */
export default function DonationIntakePage() {
  const router = useRouter();
  const { donors, donations, addDonation } = useDonorsData();
  const { lines } = useCashGifts();
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { date: todayIso(), donorId: "", receivingEntity: "PH_SEC", paymentMethod: "cash", invoiceNumber: "", notes: "", campaignId: "" },
  });
  // A gift may join an open campaign (0086); closed ones are not offered.
  const { campaigns } = useCampaignsData();
  const activeCampaigns = campaigns.filter((c) => c.status === "active");
  // The same invoice number already on the tracker or in the donor list: probably the same gift.
  const invoice = useWatch({ control, name: "invoiceNumber" });
  const already = React.useMemo(() => invoiceMatches(invoice, lines, donations, new Map(donors.map((d) => [d.id, d.name]))), [invoice, lines, donations, donors]);

  async function onSubmit(values: FormValues) {
    const result = await addDonation({
      donorId: values.donorId,
      date: values.date,
      receivingEntity: values.receivingEntity,
      kind: "cash",
      totalValue: values.amount,
      currency: values.receivingEntity === "US_501C3" ? "USD" : "PHP",
      paymentMethod: values.paymentMethod,
      invoiceNumber: values.invoiceNumber || undefined,
      notes: values.notes || undefined,
      campaignId: values.campaignId || undefined,
    });
    if (!result.ok) {
      toast.error(`Couldn't record the gift: ${result.error}`);
      return;
    }
    toast.success("Cash gift recorded");
    router.push("/donors");
  }

  return (
    <div className="flex max-w-2xl flex-1 flex-col gap-6">
      <PageHeader title="New cash gift" description="For a cash gift that is not on accounting's Donation Tracker." />

      <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card px-5 py-4 text-theme-sm">
        <p className="flex items-start gap-2">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span>
            <span className="font-medium">Gifts in kind are recorded in LAF Inventory.</span> Receiving them there puts the items into stock, makes the AR and adds the gift to the donor list.{" "}
            <a href={inventoryAppHref("/intake")} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
              Open LAF Inventory <ExternalLink className="size-3.5" />
            </a>
          </span>
        </p>
        <p className="flex items-start gap-2 text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" />
          Cash gifts written on the Donation Tracker arrive here by themselves every hour. Typing one of those here as well would count it twice.
        </p>
      </div>

      <Card>
        <CardContent>
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

              {activeCampaigns.length ? (
                <Field>
                  <FieldLabel htmlFor="campaignId">Campaign (optional)</FieldLabel>
                  <Controller
                    name="campaignId"
                    control={control}
                    render={({ field }) => (
                      <Select value={field.value || NO_CAMPAIGN} onValueChange={(v) => field.onChange(v === NO_CAMPAIGN ? "" : v)}>
                        <SelectTrigger id="campaignId" className="w-full"><SelectValue placeholder="No campaign" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_CAMPAIGN}>No campaign</SelectItem>
                          {activeCampaigns.map((c) => (
                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </Field>
              ) : null}

              <Field data-invalid={!!errors.date}>
                <FieldLabel htmlFor="donation-date">Date received</FieldLabel>
                <Input id="donation-date" type="date" max={todayIso()} className="w-48" {...register("date")} />
                <FieldError errors={[errors.date]} />
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

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field data-invalid={!!errors.amount}>
                  <FieldLabel htmlFor="amount">Amount</FieldLabel>
                  <Input id="amount" type="number" min={0} step="0.01" inputMode="decimal" {...register("amount", { valueAsNumber: true })} />
                  <FieldError errors={[errors.amount]} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="paymentMethod">How it was paid</FieldLabel>
                  <Controller
                    name="paymentMethod"
                    control={control}
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger id="paymentMethod" className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {METHODS.map((m) => (
                            <SelectItem key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </Field>
              </div>

              <Field data-invalid={!!errors.invoiceNumber}>
                <FieldLabel htmlFor="invoiceNumber">Invoice number (optional)</FieldLabel>
                <Input id="invoiceNumber" className="w-48" placeholder="e.g. 0531" {...register("invoiceNumber")} />
                <FieldError errors={[errors.invoiceNumber]} />
                {already.length > 0 && (
                  <div role="alert" className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-theme-xs text-warning-foreground dark:text-warning">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      This invoice number is already recorded:{" "}
                      {already.map((m) => `${m.donor}, ${formatCurrency(m.amount)}, ${formatDate(m.date)} (${m.where === "tracker" ? "on the tracker" : "in the donor list"})`).join("; ")}.
                      If this is the same gift, don&apos;t record it again.
                    </span>
                  </div>
                )}
              </Field>

              <Field data-invalid={!!errors.notes}>
                <FieldLabel htmlFor="notes">Notes (optional)</FieldLabel>
                <Input id="notes" placeholder="e.g. Deposited Oct 12" {...register("notes")} />
                <FieldError errors={[errors.notes]} />
              </Field>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
                <Button type="submit" disabled={isSubmitting}>{already.length > 0 ? "Record anyway" : "Record gift"}</Button>
              </div>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
