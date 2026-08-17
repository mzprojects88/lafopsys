"use client";

import { toast } from "sonner";
import { PageHeader } from "@/components/patterns/page-header";
import { LifecycleStepper } from "@/components/patterns/lifecycle-stepper";
import { EmptyState } from "@/components/patterns/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useDonorsData } from "@/lib/hooks/use-donors-collection";
import { useDoneeCertificatesData } from "@/lib/hooks/use-donee-certificates-collection";
import type { DoneeCertStatus, DoneeCertificate } from "@/lib/types/donor";
import { daysUntil } from "@/lib/utils/date";

const STAGES: DoneeCertStatus[] = ["requested", "prepared", "approved", "released", "filed"];
const STAGE_LABELS = ["Requested", "Prepared", "Approved", "Released", "Filed"];

export default function DoneeCertsPage() {
  const { donations, donors } = useDonorsData();
  const { certificates, generateCertificate, advanceStatus } = useDoneeCertificatesData();
  const pending = certificates.filter((c) => c.status !== "filed" && c.status !== "released");
  const inKindDonationsNeedingCert = donations.filter(
    (d) => d.kind === "in_kind" && !certificates.some((c) => c.donationId === d.id)
  );

  async function advance(cert: DoneeCertificate) {
    const idx = STAGES.indexOf(cert.status);
    if (idx >= STAGES.length - 1) return;
    const result = await advanceStatus(cert.id, STAGES[idx + 1]);
    if (!result.ok) {
      toast.error(`Couldn't advance the certificate: ${result.error}`);
      return;
    }
    toast.success(`${cert.controlNumber} marked ${STAGE_LABELS[idx + 1]}`);
  }

  async function handleGenerate(donationId: string) {
    const result = await generateCertificate(donationId);
    if (!result.ok) {
      toast.error(`Couldn't request the certificate: ${result.error}`);
      return;
    }
    toast.success("Donee certificate requested");
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Donee Certificates"
        description={`Linked to BIR registration 601-322-056-00000. ${pending.length} pending release.`}
      />

      {certificates.length === 0 && inKindDonationsNeedingCert.length === 0 ? (
        <EmptyState title="No in-kind donations recorded yet" description="Donee certificates are requested per in-kind donation." />
      ) : (
        <div className="flex flex-col gap-3">
          {certificates.map((cert) => {
            const donation = donations.find((d) => d.id === cert.donationId);
            const donor = donors.find((d) => d.id === donation?.donorId);
            const stageIdx = STAGES.indexOf(cert.status);
            const ageDays = Math.abs(daysUntil(cert.requestedAt.slice(0, 10)));

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

          {inKindDonationsNeedingCert.length > 0 && (
            <>
              <span className="mt-2 text-sm font-semibold text-muted-foreground">
                In-kind donations without a certificate yet ({inKindDonationsNeedingCert.length})
              </span>
              {inKindDonationsNeedingCert.slice(0, 20).map((d) => {
                const donor = donors.find((dn) => dn.id === d.donorId);
                return (
                  <Card key={d.id}>
                    <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                      <div className="flex flex-col">
                        <span className="font-medium">{donor?.name ?? "Unknown donor"}</span>
                        <span className="text-xs text-muted-foreground">{d.itemDescription}</span>
                      </div>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleGenerate(d.id)}>
                        Request Cert
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
              {inKindDonationsNeedingCert.length > 20 && (
                <p className="text-xs text-muted-foreground">
                  +{inKindDonationsNeedingCert.length - 20} more — request certs from the donor detail page.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
