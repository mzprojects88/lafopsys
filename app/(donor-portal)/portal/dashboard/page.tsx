"use client";

import { Gift, Wallet, Calendar, Repeat } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDonorsData } from "@/lib/hooks/use-donors-collection";
import { useDonorPledgesData } from "@/lib/hooks/use-donor-pledges-collection";
import { useDonorAuth } from "@/context/donor-auth-provider";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/date";

const FREQUENCY_LABEL: Record<string, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
};

/** RLS scopes both hooks below to exactly one row -- the signed-in donor's
 * own -- via shared.current_donor_id() (supabase/migrations/0023), so this
 * reuses the same hooks the staff app uses, unmodified. */
export default function DonorPortalDashboardPage() {
  const { donorName } = useDonorAuth();
  const { donors, loading: donorsLoading } = useDonorsData();
  const { pledges, loading: pledgesLoading } = useDonorPledgesData();

  const donor = donors[0];
  const pledge = pledges.find((p) => p.status === "active") ?? pledges[0];

  if (donorsLoading || pledgesLoading) return null;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title={`Welcome, ${donorName ?? "Donor"}`} description="Your giving at a glance." />

      {donor && (
        <KpiGrid>
          <KpiCard label="Lifetime Value" value={formatCurrency(donor.lifetimeValue)} icon={Wallet} color="green" />
          <KpiCard label="Total Gifts" value={donor.giftCount} icon={Gift} color="blue" />
          <KpiCard label="First Gift" value={formatDate(donor.firstGiftDate)} icon={Calendar} color="cyan" />
          <KpiCard label="Last Gift" value={formatDate(donor.lastGiftDate)} icon={Calendar} color="amber" />
        </KpiGrid>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Repeat className="size-4" />
            Your Recurring Pledge
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!pledge ? (
            <p className="text-sm text-muted-foreground">No recurring pledge on file yet.</p>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <span className="font-medium">
                {pledge.kind === "cash"
                  ? `${formatCurrency(pledge.amount ?? 0, pledge.currency)} · ${FREQUENCY_LABEL[pledge.frequency]}`
                  : `${pledge.itemDescription} · ${FREQUENCY_LABEL[pledge.frequency]}`}
              </span>
              <StatusBadge domain="pledge" status={pledge.status} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
