"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Award, Download } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { LifecycleStepper } from "@/components/patterns/lifecycle-stepper";
import { EmptyState } from "@/components/patterns/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useDonorsData } from "@/lib/hooks/use-donors-collection";
import { useDoneeCertificatesData } from "@/lib/hooks/use-donee-certificates-collection";
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import type { DoneeCertStatus, DoneeCertificate } from "@/lib/types/donor";
import { daysUntil, formatDate } from "@/lib/utils/date";
import { formatCurrency } from "@/lib/utils/currency";
import { downloadPdf } from "@/lib/utils/download-pdf";

const STAGES: DoneeCertStatus[] = ["requested", "prepared", "approved", "released", "filed"];
const STAGE_LABELS = ["Requested", "Prepared", "Approved", "Released", "Filed"];

/**
 * Certificates of donation (BIR Form 2322, 0085) for cash and in-kind gifts alike:
 * control-numbered by the database (DC-YYYY-NNNN), printed on demand, signed by the staff
 * member set in Settings.
 */
export default function DoneeCertsPage() {
  const { donations, donors } = useDonorsData();
  const { certificates, requestCertificate, advanceStatus } = useDoneeCertificatesData();
  const { documents } = useAppSettings();
  const { canEdit } = useModuleAccess();
  const editor = canEdit("donors");
  const [busy, setBusy] = useState<string | null>(null);
  const pending = certificates.filter((c) => c.status !== "filed" && c.status !== "released");
  const withoutCert = donations.filter((d) => !certificates.some((c) => c.donationId === d.id));

  async function advance(cert: DoneeCertificate) {
    const idx = STAGES.indexOf(cert.status);
    if (idx >= STAGES.length - 1) return;
    const result = await advanceStatus(cert.id);
    if (!result.ok) return void toast.error(`Couldn't advance the certificate: ${result.error}`);
    toast.success(`${cert.controlNumber} marked ${STAGE_LABELS[STAGES.indexOf(result.status ?? cert.status)]}`);
  }

  async function request(donationId: string) {
    setBusy(donationId);
    const result = await requestCertificate(donationId);
    setBusy(null);
    if (!result.ok) return void toast.error(`Couldn't request the certificate: ${result.error}`);
    toast.success(`Donee certificate ${result.number} requested`);
  }

  async function download(cert: DoneeCertificate) {
    setBusy(cert.id);
    const result = await downloadPdf("/api/donee-cert/pdf", { certificateId: cert.id }, `${cert.controlNumber}.pdf`);
    setBusy(null);
    if (!result.ok) toast.error(result.error);
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Donee Certificates"
        description={`BIR Form 2322, donee TIN ${documents.orgTin || "not set"}. ${pending.length} pending release.${documents.signatoryId ? "" : " Set who signs certificates in Settings › Receipts & certificates."}`}
      />

      {certificates.length === 0 && withoutCert.length === 0 ? (
        <EmptyState title="No donations recorded yet" description="A certificate of donation is requested per gift." />
      ) : (
        <div className="flex flex-col gap-3">
          {certificates.map((cert) => {
            const donation = donations.find((d) => d.id === cert.donationId);
            const donor = donors.find((d) => d.id === donation?.donorId);
            const stageIdx = STAGES.indexOf(cert.status);
            const ageDays = Math.abs(daysUntil(cert.requestedAt.slice(0, 10)));

            return (
              <Card key={cert.id}>
                <CardContent className="flex flex-col gap-4 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-col">
                      <span className="text-theme-sm font-medium">{cert.controlNumber} — {donor?.name ?? "Unknown donor"}</span>
                      <span className="text-theme-xs text-muted-foreground">
                        {(cert.kind ?? donation?.kind) === "cash" ? "Cash gift" : cert.description || donation?.itemDescription || "Gift in kind"}
                        {donation ? ` · ${formatDate(donation.date)} · ${formatCurrency(cert.amount ?? donation.totalValue, donation.currency)}` : ""} · requested {ageDays}d ago
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{STAGE_LABELS[stageIdx]}</Badge>
                      <Button size="sm" variant="outline" disabled={busy === cert.id} onClick={() => download(cert)}>
                        <Download /> PDF
                      </Button>
                      {editor && stageIdx < STAGES.length - 1 && (
                        <Button size="sm" onClick={() => advance(cert)}>
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

          {withoutCert.length > 0 && (
            <>
              <h2 className="mt-2 text-base font-medium text-foreground">
                Gifts without a certificate yet ({withoutCert.length})
              </h2>
              <div className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
                {withoutCert.slice(0, 20).map((d) => {
                  const donor = donors.find((dn) => dn.id === d.donorId);
                  const anonymous = !donor || donor.type === "anonymous";
                  return (
                    <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-theme-sm hover:bg-muted/60">
                      <div className="flex flex-col">
                        <span className="font-medium">{donor?.name ?? "Unknown donor"}</span>
                        <span className="text-theme-xs text-muted-foreground">
                          {d.kind === "cash" ? "Cash gift" : d.itemDescription || "Gift in kind"} · {formatDate(d.date)} · {formatCurrency(d.totalValue, d.currency)}
                        </span>
                      </div>
                      {editor ? (
                        <Button size="sm" variant="outline" disabled={anonymous || busy === d.id} title={anonymous ? "Set the donor first" : undefined} onClick={() => request(d.id)}>
                          <Award /> {busy === d.id ? "Requesting…" : "Request certificate"}
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              {withoutCert.length > 20 && (
                <p className="text-theme-xs text-muted-foreground">
                  +{withoutCert.length - 20} more — request certificates from the donor detail page.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
