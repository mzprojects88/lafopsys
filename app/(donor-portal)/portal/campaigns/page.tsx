"use client";

import * as React from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { StatusBadge } from "@/components/patterns/status-badge";
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
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCampaignsData } from "@/lib/hooks/use-campaigns-collection";
import { useCampaignCommitmentsData } from "@/lib/hooks/use-campaign-commitments-collection";
import { useDonorAuth } from "@/context/donor-auth-provider";
import type { Campaign, DonationKind } from "@/lib/types/donor";
import { formatCurrency } from "@/lib/utils/currency";
import { todayIso } from "@/lib/utils/date";

function isActive(campaign: Campaign, today: string) {
  return campaign.startDate <= today && (!campaign.endDate || campaign.endDate >= today);
}

/** A donor "joining" a campaign creates a pledge/lead record in
 * ops.campaign_commitments, NOT a real donation -- no payment processing
 * exists in this app. Staff record the actual gift through the existing
 * intake flow when it arrives and mark the commitment fulfilled. */
export default function DonorPortalCampaignsPage() {
  const { donorId } = useDonorAuth();
  const { campaigns, loading: campaignsLoading } = useCampaignsData();
  const { commitments, addCommitment, cancelCommitment } = useCampaignCommitmentsData();
  const [joiningCampaign, setJoiningCampaign] = React.useState<Campaign | null>(null);
  const [kind, setKind] = React.useState<DonationKind>("cash");
  const [amount, setAmount] = React.useState("");
  const [itemDescription, setItemDescription] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  if (campaignsLoading) return null;

  const today = todayIso();
  const activeCampaigns = campaigns.filter((c) => isActive(c, today));

  function reset() {
    setKind("cash");
    setAmount("");
    setItemDescription("");
  }

  const canSubmit = kind === "cash" ? !!amount : !!itemDescription.trim();

  async function handleJoin() {
    if (!joiningCampaign || !donorId || !canSubmit) return;
    setSubmitting(true);
    const result = await addCommitment({
      donorId,
      campaignId: joiningCampaign.id,
      kind,
      pledgedAmount: kind === "cash" ? Number(amount) : undefined,
      currency: kind === "cash" ? "PHP" : undefined,
      itemDescription: kind === "in_kind" ? itemDescription.trim() : undefined,
    });
    setSubmitting(false);
    if (!result.ok) {
      toast.error(`Couldn't join the campaign: ${result.error}`);
      return;
    }
    toast.success("Thank you — your commitment has been recorded!");
    setJoiningCampaign(null);
    reset();
  }

  async function handleWithdraw(id: string) {
    const result = await cancelCommitment(id);
    if (!result.ok) {
      toast.error(`Couldn't withdraw: ${result.error}`);
      return;
    }
    toast.success("Commitment withdrawn");
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Current Campaigns" description="Join a campaign and commit to a cash or in-kind gift." />

      {activeCampaigns.length === 0 ? (
        <EmptyState title="No active campaigns right now" description="Check back soon for the next one." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {activeCampaigns.map((c) => {
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
                  <Button size="sm" className="mt-2" onClick={() => setJoiningCampaign(c)}>
                    Join This Campaign
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Your Commitments</h2>
        {commitments.length === 0 ? (
          <EmptyState title="No commitments yet" description="Campaigns you join will show up here." />
        ) : (
          <div className="flex flex-col gap-2">
            {commitments.map((c) => {
              const campaign = campaigns.find((camp) => camp.id === c.campaignId);
              return (
                <Card key={c.id}>
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                    <div className="flex flex-col">
                      <span className="font-medium">{campaign?.name ?? "Unknown campaign"}</span>
                      <span className="text-xs text-muted-foreground">
                        {c.kind === "cash" ? formatCurrency(c.pledgedAmount ?? 0, c.currency) : c.itemDescription}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge domain="commitment" status={c.status} />
                      {c.status === "pledged" && (
                        <Button size="sm" variant="ghost" className="h-6 text-[11px] text-destructive" onClick={() => handleWithdraw(c.id)}>
                          Withdraw
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={!!joiningCampaign} onOpenChange={(next) => { if (!next) { setJoiningCampaign(null); reset(); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Join {joiningCampaign?.name}</DialogTitle>
            <DialogDescription>
              This records your commitment — our team will follow up to arrange the actual gift.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="commitKind">Kind</FieldLabel>
              <Select value={kind} onValueChange={(v) => setKind(v as DonationKind)}>
                <SelectTrigger id="commitKind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="in_kind">In-Kind</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {kind === "cash" ? (
              <Field>
                <FieldLabel htmlFor="commitAmount">Amount (₱)</FieldLabel>
                <Input id="commitAmount" type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </Field>
            ) : (
              <Field>
                <FieldLabel htmlFor="commitItem">What would you like to give?</FieldLabel>
                <Input id="commitItem" value={itemDescription} onChange={(e) => setItemDescription(e.target.value)} />
              </Field>
            )}
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setJoiningCampaign(null)}>Cancel</Button>
            <Button disabled={!canSubmit || submitting} onClick={handleJoin}>
              {submitting ? "Saving…" : "Commit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
