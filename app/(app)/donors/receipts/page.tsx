"use client";

import { toast } from "sonner";
import { PageHeader } from "@/components/patterns/page-header";
import { LifecycleStepper } from "@/components/patterns/lifecycle-stepper";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { acknowledgmentReceipts as seedARs, donations, donors } from "@/lib/mock-data";
import { useLocalCollection } from "@/lib/store/use-mock-store";
import type { AcknowledgmentReceipt, ArStatus } from "@/lib/types/donor";
import { formatCurrency } from "@/lib/utils/currency";

const STAGES: ArStatus[] = ["draft", "issued", "sent", "acknowledged"];
const STAGE_LABELS = ["Draft", "Issued", "Sent", "Acknowledged"];

export default function ReceiptsPage() {
  const { items, updateItem } = useLocalCollection<AcknowledgmentReceipt>("acknowledgment-receipts", seedARs);
  const outstanding = items.filter((a) => a.status !== "acknowledged");

  function advance(ar: AcknowledgmentReceipt) {
    const idx = STAGES.indexOf(ar.status);
    if (idx >= STAGES.length - 1) return;
    updateItem(ar.id, { status: STAGES[idx + 1] });
    toast.success(`AR ${ar.sequenceNumber} marked ${STAGE_LABELS[idx + 1]}`);
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Acknowledgment Receipts"
        description={`Outstanding queue: ${outstanding.length} receipts not yet acknowledged.`}
      />

      <div className="flex flex-col gap-3">
        {items.map((ar) => {
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
      </div>
    </div>
  );
}
