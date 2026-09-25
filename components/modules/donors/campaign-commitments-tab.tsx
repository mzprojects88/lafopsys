"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/patterns/empty-state";
import { StatusBadge } from "@/components/patterns/status-badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCampaignCommitmentsData } from "@/lib/hooks/use-campaign-commitments-collection";
import { useCampaignsData } from "@/lib/hooks/use-campaigns-collection";
import type { Donation } from "@/lib/types/donor";
import { formatCurrency } from "@/lib/utils/currency";

/** Staff-facing view of what a donor has committed to via the VIP portal --
 * closes the loop between a pledge/lead (ops.campaign_commitments) and the
 * real donation once it's recorded through the existing intake flow. */
export function CampaignCommitmentsTab({ donorId, donorDonations }: { donorId: string; donorDonations: Donation[] }) {
  const { commitments, markFulfilled } = useCampaignCommitmentsData();
  const { campaigns } = useCampaignsData();
  const [linkingId, setLinkingId] = React.useState<string | null>(null);
  const [donationId, setDonationId] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const donorCommitments = commitments.filter((c) => c.donorId === donorId);

  async function handleFulfill() {
    if (!linkingId || !donationId) return;
    setSubmitting(true);
    const result = await markFulfilled(linkingId, donationId);
    setSubmitting(false);
    if (!result.ok) {
      toast.error(`Couldn't mark fulfilled: ${result.error}`);
      return;
    }
    toast.success("Commitment marked fulfilled");
    setLinkingId(null);
    setDonationId("");
  }

  if (donorCommitments.length === 0) {
    return <EmptyState title="No campaign commitments" description="Pledges the donor makes from the VIP portal appear here." />;
  }

  return (
    <>
      <div className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {donorCommitments.map((c) => {
          const campaign = campaigns.find((camp) => camp.id === c.campaignId);
          return (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-theme-sm hover:bg-muted/60">
              <div className="flex flex-col">
                <span className="font-medium">{campaign?.name ?? "Unknown campaign"}</span>
                <span className="text-theme-xs text-muted-foreground">
                  {c.kind === "cash" ? formatCurrency(c.pledgedAmount ?? 0, c.currency) : c.itemDescription}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge domain="commitment" status={c.status} />
                {c.status === "pledged" && (
                  <Button size="sm" variant="ghost" onClick={() => setLinkingId(c.id)}>
                    Mark Fulfilled
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={!!linkingId} onOpenChange={(next) => !next && setLinkingId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Link to a Recorded Donation</DialogTitle>
            <DialogDescription>Pick the real donation (from Giving History) that fulfills this commitment.</DialogDescription>
          </DialogHeader>
          <Select value={donationId} onValueChange={setDonationId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a donation" />
            </SelectTrigger>
            <SelectContent>
              {donorDonations.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.date} · {d.kind === "cash" ? formatCurrency(d.totalValue, d.currency) : d.itemDescription}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkingId(null)}>Cancel</Button>
            <Button disabled={!donationId || submitting} onClick={handleFulfill}>
              {submitting ? "Saving…" : "Mark Fulfilled"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
