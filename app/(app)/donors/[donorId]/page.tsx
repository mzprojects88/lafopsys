"use client";

import { use, useState } from "react";
import { notFound } from "next/navigation";
import { toast } from "sonner";
import { FileSignature, Award, Pencil, Mail, Phone, IdCard } from "lucide-react";
import { EntityDetailHeader } from "@/components/patterns/entity-detail-header";
import { StatusBadge } from "@/components/patterns/status-badge";
import { EmptyState } from "@/components/patterns/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useDonorsData } from "@/lib/hooks/use-donors-collection";
import { useAcknowledgmentReceiptsData } from "@/lib/hooks/use-acknowledgment-receipts-collection";
import { useDoneeCertificatesData } from "@/lib/hooks/use-donee-certificates-collection";
import { PledgeCard } from "@/components/modules/donors/pledge-card";
import { PortalAccountCard } from "@/components/modules/donors/portal-account-card";
import { CampaignCommitmentsTab } from "@/components/modules/donors/campaign-commitments-tab";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/date";
import { useRole } from "@/lib/rbac/use-role";
import { canDeleteFiles, canUploadFiles } from "@/lib/rbac/roles";
import { FileLibrary } from "@/components/patterns/file-library";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import { DonorFormDialog } from "@/components/modules/donors/donor-form-dialog";

export default function DonorDetailPage({ params }: { params: Promise<{ donorId: string }> }) {
  const { donorId } = use(params);
  const { donors, donations, loading } = useDonorsData();
  const { receipts, generateReceipt } = useAcknowledgmentReceiptsData();
  const { certificates, generateCertificate } = useDoneeCertificatesData();
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

  async function handleGenerateReceipt(donationId: string, entity: "US_501C3" | "PH_SEC") {
    const result = await generateReceipt(donationId, entity);
    if (!result.ok) {
      toast.error(`Couldn't generate the receipt: ${result.error}`);
      return;
    }
    toast.success("Acknowledgment receipt generated");
  }

  async function handleGenerateCertificate(donationId: string) {
    const result = await generateCertificate(donationId);
    if (!result.ok) {
      toast.error(`Couldn't generate the certificate: ${result.error}`);
      return;
    }
    toast.success("Donee certificate requested");
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <EntityDetailHeader
        title={donor.name}
        subtitle={`${donor.type[0].toUpperCase()}${donor.type.slice(1)} donor · ${donor.taxJurisdiction} jurisdiction`}
        initials={donor.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
        metadata={[
          { label: "Lifetime Value", value: formatCurrency(donor.lifetimeValue) },
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
                          {d.kind === "cash" ? "Cash Donation" : d.itemDescription || "In-kind donation"}
                        </span>
                        <span className="text-theme-xs text-muted-foreground">
                          {formatDate(d.date)} · {d.receivingEntity === "US_501C3" ? "US 501(c)(3)" : "PH SEC"}
                          {d.status === "pending_review" && (
                            <span className="ml-1.5 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning-foreground dark:text-warning">
                              Pending finance review
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {ar ? (
                          <StatusBadge domain="ar" status={ar.status} />
                        ) : !editor ? null : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleGenerateReceipt(d.id, d.receivingEntity)}
                          >
                            <FileSignature />
                            Generate AR
                          </Button>
                        )}
                        {editor && !cert && d.kind === "in_kind" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleGenerateCertificate(d.id)}
                          >
                            <Award />
                            Request Cert
                          </Button>
                        )}
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
