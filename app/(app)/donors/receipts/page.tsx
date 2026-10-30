"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Download, Pencil, Stamp } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { LifecycleStepper } from "@/components/patterns/lifecycle-stepper";
import { EmptyState } from "@/components/patterns/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useDonorsData } from "@/lib/hooks/use-donors-collection";
import { useAcknowledgmentReceiptsData } from "@/lib/hooks/use-acknowledgment-receipts-collection";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import type { AcknowledgmentReceipt, ArStatus } from "@/lib/types/donor";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/date";
import { downloadPdf } from "@/lib/utils/download-pdf";

const STAGES: ArStatus[] = ["draft", "issued", "sent", "acknowledged"];
const STAGE_LABELS = ["Draft", "Issued", "Sent", "Acknowledged"];

/**
 * Cash acknowledgment receipts (0085): numbered by the database (LAF-CSH-YYYY-NNNN), printed
 * on demand. Gifts in kind are receipted in LAF Inventory, so only cash gifts are offered here.
 */
export default function ReceiptsPage() {
  const { donations, donors } = useDonorsData();
  const { receipts, issueCashAr, advanceStatus, setPaperNumber } = useAcknowledgmentReceiptsData();
  const { canEdit } = useModuleAccess();
  const editor = canEdit("donors");
  const [busy, setBusy] = useState<string | null>(null);
  const outstanding = receipts.filter((a) => a.status !== "acknowledged");
  const cashWithoutAr = donations.filter((d) => d.kind === "cash" && !receipts.some((r) => r.donationId === d.id));

  async function advance(ar: AcknowledgmentReceipt) {
    const idx = STAGES.indexOf(ar.status);
    if (idx >= STAGES.length - 1) return;
    const result = await advanceStatus(ar.id);
    if (!result.ok) return void toast.error(`Couldn't advance the receipt: ${result.error}`);
    toast.success(`AR ${ar.sequenceNumber} marked ${STAGE_LABELS[STAGES.indexOf(result.status ?? ar.status)]}`);
  }

  async function issue(donationId: string) {
    setBusy(donationId);
    const result = await issueCashAr(donationId);
    setBusy(null);
    if (!result.ok) return void toast.error(`Couldn't issue the receipt: ${result.error}`);
    toast.success(`Acknowledgment receipt ${result.number} issued`);
  }

  async function editPaper(ar: AcknowledgmentReceipt) {
    const value = window.prompt("Paper receipt number from accounting's booklet (blank to clear):", ar.bookletNumber ?? "");
    if (value === null) return;
    setBusy(ar.id);
    const result = await setPaperNumber(ar.id, value.trim());
    setBusy(null);
    if (!result.ok) return void toast.error(`Couldn't set the paper receipt number: ${result.error}`);
    toast.success(value.trim() ? `Paper receipt No. ${value.trim()} saved` : "Paper receipt number cleared");
  }

  async function download(ar: AcknowledgmentReceipt) {
    setBusy(ar.id);
    const result = await downloadPdf("/api/ar/pdf", { receiptId: ar.id }, `${ar.sequenceNumber}.pdf`);
    setBusy(null);
    if (!result.ok) toast.error(result.error);
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Acknowledgment Receipts"
        description={`Cash gifts receipted by LAF (series LAF-CSH). ${outstanding.length} not yet acknowledged. Receipts for gifts in kind are issued in LAF Inventory.`}
      />

      {receipts.length === 0 && cashWithoutAr.length === 0 ? (
        <EmptyState title="No cash gifts recorded yet" description="An acknowledgment receipt is issued per cash gift." />
      ) : (
        <div className="flex flex-col gap-3">
          {receipts.map((ar) => {
            const donation = donations.find((d) => d.id === ar.donationId);
            const donor = donors.find((d) => d.id === donation?.donorId);
            const stageIdx = STAGES.indexOf(ar.status);

            return (
              <Card key={ar.id}>
                <CardContent className="flex flex-col gap-4 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-col">
                      <span className="text-theme-sm font-medium">{ar.sequenceNumber} — {donor?.name ?? "Unknown donor"}</span>
                      <span className="text-theme-xs text-muted-foreground">
                        {donation ? `${formatDate(donation.date)} · ${formatCurrency(ar.amount ?? donation.totalValue, ar.currency ?? donation.currency)}` : ""}
                        {ar.bookletNumber ? ` · paper receipt No. ${ar.bookletNumber}` : " · no paper receipt No."}
                        {" · "}
                        {ar.entity === "US_501C3" ? "US 501(c)(3)" : "PH SEC"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {editor ? (
                        <Button size="sm" variant="ghost" disabled={busy === ar.id} title="Set or correct the paper receipt number" onClick={() => editPaper(ar)}>
                          <Pencil /> Paper No.
                        </Button>
                      ) : null}
                      <Badge variant="outline">{STAGE_LABELS[stageIdx]}</Badge>
                      {ar.status !== "draft" ? (
                        <Button size="sm" variant="outline" disabled={busy === ar.id} onClick={() => download(ar)}>
                          <Download /> PDF
                        </Button>
                      ) : null}
                      {editor && stageIdx < STAGES.length - 1 && (
                        <Button size="sm" onClick={() => advance(ar)}>
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

          {cashWithoutAr.length > 0 && (
            <>
              <h2 className="mt-2 text-base font-medium text-foreground">
                Cash gifts without a receipt yet ({cashWithoutAr.length})
              </h2>
              <div className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
                {cashWithoutAr.slice(0, 20).map((d) => {
                  const donor = donors.find((dn) => dn.id === d.donorId);
                  // 0122: an anonymous gift is receipted too, as "Anonymous donor" -- the paper booklet numbers them.
                  const noDonor = !donor;
                  return (
                    <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-theme-sm hover:bg-muted/60">
                      <div className="flex flex-col">
                        <span className="font-medium">{donor?.name ?? "Unknown donor"}</span>
                        <span className="text-theme-xs text-muted-foreground">
                          {formatDate(d.date)} · {formatCurrency(d.totalValue, d.currency)}
                          {d.invoiceNumber ? ` · paper receipt No. ${d.invoiceNumber}` : ""}
                        </span>
                      </div>
                      {editor ? (
                        <Button size="sm" variant="outline" disabled={noDonor || busy === d.id} title={noDonor ? "Set the donor first" : undefined} onClick={() => issue(d.id)}>
                          <Stamp /> {busy === d.id ? "Issuing…" : "Issue LAF AR"}
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              {cashWithoutAr.length > 20 && (
                <p className="text-theme-xs text-muted-foreground">
                  +{cashWithoutAr.length - 20} more — issue receipts from the donor detail page.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
