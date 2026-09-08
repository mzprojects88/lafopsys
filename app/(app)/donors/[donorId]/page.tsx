"use client";

import { use } from "react";
import { notFound } from "next/navigation";
import { toast } from "sonner";
import { FileSignature, Award } from "lucide-react";
import { EntityDetailHeader } from "@/components/patterns/entity-detail-header";
import { StatusBadge } from "@/components/patterns/status-badge";
import { EmptyState } from "@/components/patterns/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
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

export default function DonorDetailPage({ params }: { params: Promise<{ donorId: string }> }) {
  const { donorId } = use(params);
  const { donors, donations, loading } = useDonorsData();
  const { receipts, generateReceipt } = useAcknowledgmentReceiptsData();
  const { certificates, generateCertificate } = useDoneeCertificatesData();
  const donor = donors.find((d) => d.id === donorId);
  const { role } = useRole();

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
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PledgeCard donorId={donor.id} />
        <PortalAccountCard donorId={donor.id} />
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
            <div className="flex flex-col gap-2">
              {donorDonations.map((d) => {
                const ar = receipts.find((a) => a.donationId === d.id);
                const cert = certificates.find((c) => c.donationId === d.id);
                return (
                  <Card key={d.id}>
                    <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                      <div className="flex flex-col">
                        <span className="font-medium">
                          {d.kind === "cash" ? "Cash Donation" : d.itemDescription}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(d.date)} · {d.receivingEntity === "US_501C3" ? "US 501(c)(3)" : "PH SEC"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {ar ? (
                          <StatusBadge domain="ar" status={ar.status} />
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 gap-1 text-[11px]"
                            onClick={() => handleGenerateReceipt(d.id, d.receivingEntity)}
                          >
                            <FileSignature className="size-3" />
                            Generate AR
                          </Button>
                        )}
                        {!cert && d.kind === "in_kind" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 gap-1 text-[11px]"
                            onClick={() => handleGenerateCertificate(d.id)}
                          >
                            <Award className="size-3" />
                            Request Cert
                          </Button>
                        )}
                        <span className="font-medium tabular-nums">{formatCurrency(d.totalValue, d.currency)}</span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="commitments" className="pt-4">
          <CampaignCommitmentsTab donorId={donor.id} donorDonations={donorDonations} />
        </TabsContent>

        <TabsContent value="documents" className="pt-4">
          <FileLibrary
            recordType="donor"
            recordId={donor.id}
            canUpload={canUploadFiles("donors", role, false)}
            canDelete={canDeleteFiles("donors", role, false)}
            title="Documents"
            description={`Acknowledgment receipts, donee certificates and deeds of donation, kept under Donors / ${donor.name}. Not visible on the donor portal.`}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
