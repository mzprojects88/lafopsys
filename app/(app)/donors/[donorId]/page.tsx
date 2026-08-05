"use client";

import { use } from "react";
import { notFound } from "next/navigation";
import { EntityDetailHeader } from "@/components/patterns/entity-detail-header";
import { StatusBadge } from "@/components/patterns/status-badge";
import { EmptyState } from "@/components/patterns/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { donors, donations, acknowledgmentReceipts } from "@/lib/mock-data";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/date";

export default function DonorDetailPage({ params }: { params: Promise<{ donorId: string }> }) {
  const { donorId } = use(params);
  const donor = donors.find((d) => d.id === donorId);
  if (!donor) notFound();

  const donorDonations = donations.filter((d) => d.donorId === donor.id).sort((a, b) => b.date.localeCompare(a.date));

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

      <Tabs defaultValue="history">
        <TabsList>
          <TabsTrigger value="history">Giving History ({donorDonations.length})</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>

        <TabsContent value="history" className="pt-4">
          {donorDonations.length === 0 ? (
            <EmptyState title="No donations recorded" />
          ) : (
            <div className="flex flex-col gap-2">
              {donorDonations.map((d) => {
                const ar = acknowledgmentReceipts.find((a) => a.donationId === d.id);
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
                        {ar && <StatusBadge domain="ar" status={ar.status} />}
                        <span className="font-medium tabular-nums">{formatCurrency(d.totalValue, d.currency)}</span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="documents" className="pt-4">
          <EmptyState title="No documents uploaded" description="Acknowledgment receipts and donee certificates link here." />
        </TabsContent>
      </Tabs>
    </div>
  );
}
