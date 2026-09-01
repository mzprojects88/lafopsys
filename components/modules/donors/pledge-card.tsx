"use client";

import * as React from "react";
import { toast } from "sonner";
import { Repeat, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/patterns/status-badge";
import { useDonorPledgesData } from "@/lib/hooks/use-donor-pledges-collection";
import type { DonationKind, PledgeFrequency } from "@/lib/types/donor";
import { formatCurrency } from "@/lib/utils/currency";
import { todayIso } from "@/lib/utils/date";

const FREQUENCY_LABEL: Record<PledgeFrequency, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
};

/** Recurring-giving commitment card on a donor's detail page. Staff record
 * and edit the pledge here; a donor account only ever sees this read-only,
 * on their own portal dashboard (RLS-scoped, no edit UI there). */
export function PledgeCard({ donorId }: { donorId: string }) {
  const { pledges, loading, addPledge, updatePledgeStatus } = useDonorPledgesData();
  const [open, setOpen] = React.useState(false);
  const [kind, setKind] = React.useState<DonationKind>("cash");
  const [frequency, setFrequency] = React.useState<PledgeFrequency>("monthly");
  const [amount, setAmount] = React.useState("");
  const [itemDescription, setItemDescription] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const donorPledges = pledges.filter((p) => p.donorId === donorId);
  const currentPledge = donorPledges.find((p) => p.status === "active") ?? donorPledges[0];

  function reset() {
    setKind("cash");
    setFrequency("monthly");
    setAmount("");
    setItemDescription("");
    setNotes("");
  }

  const canSubmit = kind === "cash" ? !!amount : !!itemDescription.trim();

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    const result = await addPledge({
      donorId,
      kind,
      frequency,
      amount: kind === "cash" ? Number(amount) : undefined,
      currency: kind === "cash" ? "PHP" : undefined,
      itemDescription: kind === "in_kind" ? itemDescription.trim() : undefined,
      startedAt: todayIso(),
      notes: notes.trim() || undefined,
    });
    setSubmitting(false);
    if (!result.ok) {
      toast.error(`Couldn't record the pledge: ${result.error}`);
      return;
    }
    toast.success("Recurring pledge recorded");
    setOpen(false);
    reset();
  }

  async function handleStatusChange(status: "active" | "paused" | "cancelled") {
    if (!currentPledge) return;
    const result = await updatePledgeStatus(currentPledge.id, status);
    if (!result.ok) {
      toast.error(`Couldn't update the pledge: ${result.error}`);
      return;
    }
    toast.success(`Pledge ${status}`);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Repeat className="size-4" />
          Recurring Pledge
        </CardTitle>
        <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset(); }}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="gap-1.5">
              <Plus className="size-3.5" />
              {currentPledge ? "Record New Pledge" : "Record Pledge"}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Record Recurring Pledge</DialogTitle>
              <DialogDescription>
                What this donor has committed to giving on an ongoing basis — used to gate VIP portal eligibility.
              </DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="pledgeKind">Kind</FieldLabel>
                <Select value={kind} onValueChange={(v) => setKind(v as DonationKind)}>
                  <SelectTrigger id="pledgeKind" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="in_kind">In-Kind</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="pledgeFrequency">Frequency</FieldLabel>
                <Select value={frequency} onValueChange={(v) => setFrequency(v as PledgeFrequency)}>
                  <SelectTrigger id="pledgeFrequency" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(FREQUENCY_LABEL) as PledgeFrequency[]).map((f) => (
                      <SelectItem key={f} value={f}>{FREQUENCY_LABEL[f]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {kind === "cash" ? (
                <Field>
                  <FieldLabel htmlFor="pledgeAmount">Amount (₱)</FieldLabel>
                  <Input id="pledgeAmount" type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </Field>
              ) : (
                <Field>
                  <FieldLabel htmlFor="pledgeItem">Item description</FieldLabel>
                  <Input id="pledgeItem" value={itemDescription} onChange={(e) => setItemDescription(e.target.value)} />
                </Field>
              )}
              <Field>
                <FieldLabel htmlFor="pledgeNotes">Notes (optional)</FieldLabel>
                <Textarea id="pledgeNotes" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button disabled={!canSubmit || submitting} onClick={handleSubmit}>
                {submitting ? "Saving…" : "Record Pledge"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !currentPledge ? (
          <p className="text-sm text-muted-foreground">No recurring pledge on file.</p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">
                {currentPledge.kind === "cash"
                  ? `${formatCurrency(currentPledge.amount ?? 0, currentPledge.currency)} · ${FREQUENCY_LABEL[currentPledge.frequency]}`
                  : `${currentPledge.itemDescription} · ${FREQUENCY_LABEL[currentPledge.frequency]}`}
              </span>
              <span className="text-xs text-muted-foreground">Since {currentPledge.startedAt}</span>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge domain="pledge" status={currentPledge.status} />
              {currentPledge.status === "active" && (
                <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => handleStatusChange("paused")}>
                  Pause
                </Button>
              )}
              {currentPledge.status === "paused" && (
                <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => handleStatusChange("active")}>
                  Resume
                </Button>
              )}
              {currentPledge.status !== "cancelled" && (
                <Button size="sm" variant="ghost" className="h-6 text-[11px] text-destructive" onClick={() => handleStatusChange("cancelled")}>
                  Cancel
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
