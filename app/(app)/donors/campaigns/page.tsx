"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { useCampaignsData } from "@/lib/hooks/use-campaigns-collection";
import { formatCurrency } from "@/lib/utils/currency";
import { TODAY_ISO } from "@/lib/utils/seeded-random";

export default function CampaignsPage() {
  const { campaigns, addCampaign } = useCampaignsData();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [targetAmount, setTargetAmount] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  async function handleCreate() {
    if (!name.trim() || !targetAmount) return;
    setSubmitting(true);
    const result = await addCampaign({ name: name.trim(), targetAmount: Number(targetAmount), startDate: TODAY_ISO });
    setSubmitting(false);
    if (!result.ok) {
      toast.error(`Couldn't create the campaign: ${result.error}`);
      return;
    }
    toast.success("Campaign created");
    setName("");
    setTargetAmount("");
    setOpen(false);
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Campaigns"
        description="Donations grouped by appeal, tracked against target."
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus />New Campaign</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New Campaign</DialogTitle>
                <DialogDescription>Set a target amount to track progress against.</DialogDescription>
              </DialogHeader>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="campaignName">Name</FieldLabel>
                  <Input id="campaignName" value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="targetAmount">Target Amount (₱)</FieldLabel>
                  <Input id="targetAmount" type="number" min="0" value={targetAmount} onChange={(e) => setTargetAmount(e.target.value)} />
                </Field>
              </FieldGroup>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button disabled={!name.trim() || !targetAmount || submitting} onClick={handleCreate}>
                  {submitting ? "Creating…" : "Create Campaign"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />
      {campaigns.length === 0 ? (
        <EmptyState title="No campaigns yet" description="Create one to start tracking donations against a target." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {campaigns.map((c) => {
            const pct = c.targetAmount > 0 ? Math.min(100, Math.round((c.raisedAmount / c.targetAmount) * 100)) : 0;
            return (
              <Card key={c.id}>
                <CardHeader>
                  <CardTitle className="text-base">{c.name}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between">
                    <span className="text-xl font-semibold">{formatCurrency(c.raisedAmount)}</span>
                    <span className="text-sm text-muted-foreground">of {formatCurrency(c.targetAmount)}</span>
                  </div>
                  <Progress value={pct} />
                  <span className="text-xs text-muted-foreground">{pct}% of target</span>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
