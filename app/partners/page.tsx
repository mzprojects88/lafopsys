"use client";

import Link from "next/link";
import { Users, Clock, BedDouble, Plus } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { StatusBadge } from "@/components/patterns/status-badge";
import { EmptyState } from "@/components/patterns/empty-state";
import { HouseOccupancySummary } from "@/components/modules/house-ops/house-occupancy-summary";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { referrals as seedReferrals, units, bedPositions } from "@/lib/mock-data";
import { useLocalCollection } from "@/lib/store/use-mock-store";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";
import { useHospitalAuth } from "@/context/hospital-auth-provider";
import type { Referral } from "@/lib/types/patient";
import { formatDate } from "@/lib/utils/date";

export default function PartnerDashboardPage() {
  const { session } = useHospitalAuth();
  const { items } = useLocalCollection<Referral>("referrals", seedReferrals);
  const { patients, stays } = usePatientsData();
  const ours = items.filter((r) => r.hospitalId === session?.hospitalId);

  const pending = ours.filter((r) => r.status === "submitted" || r.status === "waitlisted").length;
  const admitted = ours.filter((r) => r.status === "admitted").length;
  const recent = [...ours].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Dashboard"
        description={`Referrals submitted by ${session?.hospitalName ?? "your hospital"}.`}
        action={
          <Button asChild>
            <Link href="/partners/referrals/new">
              <Plus />
              New Referral
            </Link>
          </Button>
        }
      />

      <KpiGrid>
        <KpiCard label="Total Referred" value={ours.length} icon={Users} color="purple" />
        <KpiCard label="Pending" value={pending} icon={Clock} color="amber" />
        <KpiCard label="Admitted" value={admitted} icon={BedDouble} color="indigo" />
      </KpiGrid>

      <HouseOccupancySummary units={units} bedPositions={bedPositions} stays={stays} patients={patients} />

      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          <span className="text-sm font-semibold">Recent Referrals</span>
          {recent.length === 0 ? (
            <EmptyState title="No referrals yet" description="Submit your first referral to LAF House." />
          ) : (
            <div className="flex flex-col gap-2">
              {recent.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm">
                  <div className="flex flex-col">
                    <span className="font-medium">{r.patientName}</span>
                    <span className="text-xs text-muted-foreground">{formatDate(r.date)}</span>
                  </div>
                  <StatusBadge domain="referral" status={r.status} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
