"use client";

import { toast } from "sonner";
import { PageHeader } from "@/components/patterns/page-header";
import { LifecycleStepper } from "@/components/patterns/lifecycle-stepper";
import { EmptyState } from "@/components/patterns/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useDonorsData } from "@/lib/hooks/use-donors-collection";
import { useAcknowledgmentReceiptsData } from "@/lib/hooks/use-acknowledgment-receipts-collection";
import type { AcknowledgmentReceipt, ArStatus } from "@/lib/types/donor";
import { formatCurrency } from "@/lib/utils/currency";

const STAGES: ArStatus[] = ["draft", "issued", "sent", "acknowledged"];
const STAGE_LABELS = ["Draft", "Issued", "Sent", "Acknowledged"];

export default function ReceiptsPage() {
  const { donations, donors } = useDonorsData();
  const { receipts, generateReceipt, advanceStatus } = useAcknowledgmentReceiptsData();
  const outstanding = receipts.filter((a) => a.status !== "acknowledged");
  const donationsNeedingAR = donations.filter((d) => !receipts.some((r) => r.donationId === d.id));

  async function advance(ar: AcknowledgmentReceipt) {
    const idx = STAGES.indexOf(ar.status);
    if (idx >= STAGES.length - 1) return;
    const result = await advanceStatus(ar.id, STAGES[idx + 1]);
    if (!result.ok) {
      toast.error(`Couldn't advance the receipt: ${result.error}`);
      return;
    }
    toast.success(`AR ${ar.sequenceNumber} marked ${STAGE_LABELS[idx + 1]}`);
  }

  async function handleGenerate(donationId: string, entity: "US_501C3" | "PH_SEC") {
    const result = await generateReceipt(donationId, entity);
    if (!result.ok) {
      toast.error(`Couldn't generate the receipt: ${result.error}`);
      return;
    }
    toast.success("Acknowledgment receipt generated");
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Acknowledgment Receipts"
        description={`Outstanding queue: ${outstanding.length} receipts not yet acknowledged.`}
      />

      {receipts.length === 0 && donationsNeedingAR.length === 0 ? (
        <EmptyState title="No donations recorded yet" description="Acknowledgment receipts are generated per donation." />
      ) : (
        <div className="flex flex-col gap-3">
          {receipts.map((ar) => {
            const donation = donations.find((d) => d.id === ar.donationId);
            const donor = donors.find((d) => d.id === donation?.donorId);
            const stageIdx = STAGES.indexOf(ar.status);

            return (
              <Card key={ar.id}>
                <CardContent className="flex flex-col gap-4 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{ar.sequenceNumber} — {donor?.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {donation && formatCurrency(donation.totalValue, donation.currency)} ·{" "}
                        {ar.entity === "US_501C3" ? "US 501(c)(3)" : "PH SEC"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{STAGE_LABELS[stageIdx]}</Badge>
                      {stageIdx < STAGES.length - 1 && (
                        <Button size="sm" className="h-7 text-xs" onClick={() => advance(ar)}>
                          Mark {STAGE_LABELS[stageIdx + 1]}
                        </Button>
                      )}
                    </div>
                  </div>
                  <LifecycleStepper steps={STAGE_LABELS.map((label) => ({ label }))} currentIndex={stageIdx} />
                </CardContent>
              </Card>
            );
          })}

          {donationsNeedingAR.length > 0 && (
            <>
              <span className="mt-2 text-sm font-semibold text-muted-foreground">
                Donations without a receipt yet ({donationsNeedingAR.length})
              </span>
              {donationsNeedingAR.slice(0, 20).map((d) => {
                const donor = donors.find((dn) => dn.id === d.donorId);
                return (
                  <Card key={d.id}>
                    <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                      <div className="flex flex-col">
                        <span className="font-medium">{donor?.name ?? "Unknown donor"}</span>
                        <span className="text-xs text-muted-foreground">
                          {d.kind === "cash" ? "Cash donation" : d.itemDescription} · {formatCurrency(d.totalValue, d.currency)}
                        </span>
                      </div>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleGenerate(d.id, d.receivingEntity)}>
                        Generate AR
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
              {donationsNeedingAR.length > 20 && (
                <p className="text-xs text-muted-foreground">
                  +{donationsNeedingAR.length - 20} more — generate receipts from the donor detail page.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
