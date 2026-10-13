"use client";

import { use, useState } from "react";
import { notFound } from "next/navigation";
import { toast } from "sonner";
import { FileSignature, Award, Download, Pencil, Mail, Phone, IdCard } from "lucide-react";
import { downloadPdf } from "@/lib/utils/download-pdf";
import { EntityDetailHeader } from "@/components/patterns/entity-detail-header";
import { StatusBadge } from "@/components/patterns/status-badge";
import { EmptyState } from "@/components/patterns/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCampaignsData } from "@/lib/hooks/use-campaigns-collection";

const NO_CAMPAIGN = "__none__";
import { useDonorsData } from "@/lib/hooks/use-donors-collection";
import { useAcknowledgmentReceiptsData } from "@/lib/hooks/use-acknowledgment-receipts-collection";
import { useDoneeCertificatesData } from "@/lib/hooks/use-donee-certificates-collection";
import { PledgeCard } from "@/components/modules/donors/pledge-card";
import { PortalAccountCard } from "@/components/modules/donors/portal-account-card";
import { CampaignCommitmentsTab } from "@/components/modules/donors/campaign-commitments-tab";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/date";
import { PAYMENT_METHOD_LABEL } from "@/lib/utils/cash-gifts";
import { useRole } from "@/lib/rbac/use-role";
import { canDeleteFiles, canUploadFiles } from "@/lib/rbac/roles";
import { FileLibrary } from "@/components/patterns/file-library";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import { DonorFormDialog } from "@/components/modules/donors/donor-form-dialog";

export default function DonorDetailPage({ params }: { params: Promise<{ donorId: string }> }) {
  const { donorId } = use(params);
  const { donors, donations, loading, setDonationCampaign } = useDonorsData();
  const { campaigns } = useCampaignsData();
  const { receipts, issueCashAr } = useAcknowledgmentReceiptsData();
  const { certificates, requestCertificate } = useDoneeCertificatesData();
  const donor = donors.find((d) => d.id === donorId);
  const { roles } = useRole();
  const { canEdit } = useModuleAccess();
  const editor = canEdit("donors");
  const [editing, setEditing] = useState(false);

  if (!donor) {
    if (loading) return null;
    notFound();
  }

  const donorDonations = donations.filter((d) => d.donorId === donor.id).sort((a, b) => b.date.localeCompare(a.date));
  const cashTotal = donorDonations.filter((d) => d.kind === "cash").reduce((s, d) => s + d.totalValue, 0);

  // Cash ARs and certificates are numbered by the database (0085); the PDFs are built on download.
  async function handleIssueReceipt(donationId: string) {
    const result = await issueCashAr(donationId);
    if (!result.ok) {
      toast.error(`Couldn't issue the receipt: ${result.error}`);
      return;
    }
    toast.success(`Acknowledgment receipt ${result.number} issued`);
  }

  async function handleRequestCertificate(donationId: string) {
    const result = await requestCertificate(donationId);
    if (!result.ok) {
      toast.error(`Couldn't request the certificate: ${result.error}`);
      return;
    }
    toast.success(`Donee certificate ${result.number} requested`);
  }

  async function handleDownload(url: string, body: Record<string, unknown>, filename: string) {
    const result = await downloadPdf(url, body, filename);
    if (!result.ok) toast.error(result.error);
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <EntityDetailHeader
        title={donor.name}
        subtitle={`${donor.type[0].toUpperCase()}${donor.type.slice(1)} donor · ${donor.taxJurisdiction} jurisdiction`}
        initials={donor.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
        metadata={[
          { label: "Lifetime Value", value: formatCurrency(donor.lifetimeValue) },
          { label: "Cash", value: formatCurrency(cashTotal) },
          { label: "In kind", value: formatCurrency(donor.lifetimeValue - cashTotal) },
          { label: "Gift Count", value: donor.giftCount },
          { label: "First Gift", value: formatDate(donor.firstGiftDate) },
          { label: "Last Gift", value: formatDate(donor.lastGiftDate) },
        ]}
        actions={
          editor && (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil />
              Edit details
            </Button>
          )
        }
      />
      {editor && <DonorFormDialog open={editing} onOpenChange={setEditing} donor={donor} />}

      {/* Contact and tax details: what an AR, a donee certificate or a thank-you needs. */}
      <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-2xl border border-border bg-card px-5 py-3 text-theme-sm">
        <span className="flex min-w-0 items-center gap-2">
          <Mail className="size-4 shrink-0 text-muted-foreground" />
          {donor.email ? (
            <a href={`mailto:${donor.email}`} className="truncate text-primary hover:underline">
              {donor.email}
            </a>
          ) : (
            <span className="text-muted-foreground">No email</span>
          )}
        </span>
        <span className="flex items-center gap-2">
          <Phone className="size-4 shrink-0 text-muted-foreground" />
          {donor.phone ? (
            <a href={`tel:${donor.phone.replace(/[^0-9+]/g, "")}`} className="text-primary hover:underline">
              {donor.phone}
            </a>
          ) : (
            <span className="text-muted-foreground">No phone</span>
          )}
        </span>
        <span className="flex items-center gap-2">
          <IdCard className="size-4 shrink-0 text-muted-foreground" />
          {donor.tin ? <span className="tabular-nums">TIN {donor.tin}</span> : <span className="text-muted-foreground">No TIN</span>}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PledgeCard donorId={donor.id} editable={editor} />
        <PortalAccountCard donorId={donor.id} editable={editor} />
      </div>

      <Tabs defaultValue="history">
        <TabsList>
          <TabsTrigger value="history">Giving History ({donorDonations.length})</TabsTrigger>
          <TabsTrigger value="commitments">Campaign Commitments</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>

        <TabsContent value="history" className="pt-4">
          {donorDonations.length === 0 ? (
            <EmptyState title="No donations recorded" />
          ) : (
            <div className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
              {donorDonations.map((d) => {
                const ar = receipts.find((a) => a.donationId === d.id);
                const cert = certificates.find((c) => c.donationId === d.id);
                return (
                  <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-theme-sm hover:bg-muted/60">
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="line-clamp-2 font-medium break-words">
                          {d.kind === "cash" ? `Cash gift${d.paymentMethod ? ` · ${PAYMENT_METHOD_LABEL[d.paymentMethod]}` : ""}` : d.itemDescription || "In-kind donation"}
                        </span>
                        <span className="text-theme-xs text-muted-foreground">
                          {formatDate(d.date)} · {d.receivingEntity === "US_501C3" ? "US 501(c)(3)" : "PH SEC"}
                          {d.kind === "cash" && d.invoiceNumber ? ` · Invoice ${d.invoiceNumber}` : ""}
                          {d.kind === "cash" && d.notes ? ` · ${d.notes}` : ""}
                          {d.status === "pending_review" && (
                            <span className="ml-1.5 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning-foreground dark:text-warning">
                              Pending finance review
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {/* The campaign a gift counts toward (0086): editors change it here; the totals follow. */}
                        {editor && (campaigns.length > 0 || d.campaignId) ? (
                          <Select
                            value={d.campaignId ?? NO_CAMPAIGN}
                            onValueChange={async (v) => {
                              const result = await setDonationCampaign(d.id, v === NO_CAMPAIGN ? null : v);
                              if (!result.ok) toast.error(result.error);
                            }}
                          >
                            <SelectTrigger size="sm" className="w-40" aria-label="Campaign"><SelectValue placeholder="No campaign" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NO_CAMPAIGN}>No campaign</SelectItem>
                              {campaigns.filter((c) => c.status === "active" || c.id === d.campaignId).map((c) => (
                                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : d.campaignId ? (
                          <span className="text-theme-xs text-muted-foreground">{campaigns.find((c) => c.id === d.campaignId)?.name}</span>
                        ) : null}
                        {ar ? (
                          <>
                            <StatusBadge domain="ar" status={ar.status} />
                            {ar.status !== "draft" ? (
                              <Button size="sm" variant="ghost" title={`Download ${ar.sequenceNumber}`} onClick={() => handleDownload("/api/ar/pdf", { receiptId: ar.id }, `${ar.sequenceNumber}.pdf`)}>
                                <Download />
                                AR
                              </Button>
                            ) : null}
                          </>
                        ) : !editor || d.kind !== "cash" || donor.type === "anonymous" ? null : (
                          <Button size="sm" variant="ghost" onClick={() => handleIssueReceipt(d.id)}>
                            <FileSignature />
                            Issue AR
                          </Button>
                        )}
                        {cert ? (
                          <Button size="sm" variant="ghost" title={`Download ${cert.controlNumber} (${cert.status})`} onClick={() => handleDownload("/api/donee-cert/pdf", { certificateId: cert.id }, `${cert.controlNumber}.pdf`)}>
                            <Award />
                            2322
                          </Button>
                        ) : editor && donor.type !== "anonymous" ? (
                          <Button size="sm" variant="ghost" onClick={() => handleRequestCertificate(d.id)}>
                            <Award />
                            Request Cert
                          </Button>
                        ) : null}
                        <span className="font-medium tabular-nums">{formatCurrency(d.totalValue, d.currency)}</span>
                      </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="commitments" className="pt-4">
          <CampaignCommitmentsTab donorId={donor.id} donorDonations={donorDonations} editable={editor} />
        </TabsContent>

        <TabsContent value="documents" className="pt-4">
          <FileLibrary
            recordType="donor"
            recordId={donor.id}
            canUpload={canUploadFiles("donors", roles, false)}
            canDelete={canDeleteFiles("donors", roles, false)}
            title="Documents"
            description={`Acknowledgment receipts, donee certificates and deeds of donation, kept under Donors / ${donor.name}. Not visible on the donor portal.`}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
