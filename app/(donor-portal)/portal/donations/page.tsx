"use client";

import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { useDonorsData } from "@/lib/hooks/use-donors-collection";
import { useAcknowledgmentReceiptsData } from "@/lib/hooks/use-acknowledgment-receipts-collection";
import { useDoneeCertificatesData } from "@/lib/hooks/use-donee-certificates-collection";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/date";

/** Read-only version of the Giving History tab on the staff-side donor
 * detail page (app/(app)/donors/[donorId]/page.tsx) -- same data, no
 * "Generate AR"/"Request Cert" actions, since those are staff actions. RLS
 * scopes every hook here to the signed-in donor's own rows. */
export default function DonorPortalDonationsPage() {
  const { donations, loading } = useDonorsData();
  const { receipts } = useAcknowledgmentReceiptsData();
  const { certificates } = useDoneeCertificatesData();

  if (loading) return null;

  const sorted = [...donations].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Your Donations" description="Every gift we have on record, and its receipt/certificate status." />

      {sorted.length === 0 ? (
        <EmptyState title="No donations recorded" />
      ) : (
        <div className="flex flex-col gap-2">
          {sorted.map((d) => {
            const ar = receipts.find((a) => a.donationId === d.id);
            const cert = certificates.find((c) => c.donationId === d.id);
            return (
              <Card key={d.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                  <div className="flex flex-col">
                    <span className="font-medium">{d.kind === "cash" ? "Cash Donation" : d.itemDescription}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(d.date)} · {d.receivingEntity === "US_501C3" ? "US 501(c)(3)" : "PH SEC"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {ar && <StatusBadge domain="ar" status={ar.status} />}
                    {cert && <StatusBadge domain="doneeCert" status={cert.status} />}
                    <span className="font-medium tabular-nums">{formatCurrency(d.totalValue, d.currency)}</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
