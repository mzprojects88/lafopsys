"use client";

import { toast } from "sonner";
import { PageHeader } from "@/components/patterns/page-header";
import { LifecycleStepper } from "@/components/patterns/lifecycle-stepper";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { doneeCertificates as seedCerts, donations, donors } from "@/lib/mock-data";
import { useLocalCollection } from "@/lib/store/use-mock-store";
import type { DoneeCertStatus, DoneeCertificate } from "@/lib/types/donor";
import { daysUntil } from "@/lib/utils/date";

const STAGES: DoneeCertStatus[] = ["requested", "prepared", "approved", "released", "filed"];
const STAGE_LABELS = ["Requested", "Prepared", "Approved", "Released", "Filed"];

export default function DoneeCertsPage() {
  const { items, updateItem } = useLocalCollection<DoneeCertificate>("donee-certificates", seedCerts);
  const pending = items.filter((c) => c.status !== "filed" && c.status !== "released");

  function advance(cert: DoneeCertificate) {
    const idx = STAGES.indexOf(cert.status);
    if (idx >= STAGES.length - 1) return;
    const nextStatus = STAGES[idx + 1];
    updateItem(cert.id, {
      status: nextStatus,
      releasedAt: nextStatus === "released" ? new Date().toISOString().slice(0, 10) : cert.releasedAt,
    });
    toast.success(`${cert.controlNumber} marked ${STAGE_LABELS[idx + 1]}`);
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Donee Certificates"
        description={`Linked to BIR registration 601-322-056-00000. ${pending.length} pending release.`}
      />

      <div className="flex flex-col gap-3">
        {items.map((cert) => {
          const donation = donations.find((d) => d.id === cert.donationId);
          const donor = donors.find((d) => d.id === donation?.donorId);
          const stageIdx = STAGES.indexOf(cert.status);
          const ageDays = Math.abs(daysUntil(cert.requestedAt));

          return (
            <Card key={cert.id}>
              <CardContent className="flex flex-col gap-4 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{cert.controlNumber} — {donor?.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {donation?.itemDescription ?? "Cash gift"} · requested {ageDays}d ago
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{STAGE_LABELS[stageIdx]}</Badge>
                    {stageIdx < STAGES.length - 1 && (
                      <Button size="sm" className="h-7 text-xs" onClick={() => advance(cert)}>
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
