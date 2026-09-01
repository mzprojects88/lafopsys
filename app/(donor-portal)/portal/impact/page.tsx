"use client";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { Bed, Utensils, Car, HandCoins, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { useMetricSnapshotsData } from "@/lib/hooks/use-metric-snapshots-collection";

const chartConfig: ChartConfig = {
  bedNights: { label: "Bed Nights", color: "var(--chart-1)" },
};

/** Org-wide impact numbers -- not attributed to this donor specifically,
 * since the data model has no per-donor outcome attribution. Reuses Panel
 * E ("Impact YTD") from app/(app)/analytics/page.tsx, fed by the same
 * useMetricSnapshotsData() hook, unmodified. Deliberately does NOT reuse
 * that page's Panel F, which leaderboards other donors by name -- that must
 * never reach a donor session. */
export default function DonorPortalImpactPage() {
  const { snapshots, loading } = useMetricSnapshotsData();

  if (loading) return null;

  const ytd = snapshots.reduce(
    (acc, m) => ({
      bedNights: acc.bedNights + m.bedNights,
      meals: acc.meals + m.meals,
      trips: acc.trips + m.trips,
      careCartMeals: acc.careCartMeals + m.careCartMeals,
      activityParticipants: acc.activityParticipants + m.activityParticipants,
    }),
    { bedNights: 0, meals: 0, trips: 0, careCartMeals: 0, activityParticipants: 0 }
  );

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Our Impact" description="What your giving helps make possible, year to date." />

      <KpiGrid>
        <KpiCard label="Bed Nights" value={ytd.bedNights.toLocaleString()} icon={Bed} color="blue" />
        <KpiCard label="Meals" value={ytd.meals.toLocaleString()} icon={Utensils} color="green" />
        <KpiCard label="Trips" value={ytd.trips.toLocaleString()} icon={Car} color="cyan" />
        <KpiCard label="Care Cart Meals" value={ytd.careCartMeals.toLocaleString()} icon={HandCoins} color="orange" />
        <KpiCard label="Activity Participants" value={ytd.activityParticipants.toLocaleString()} icon={Sparkles} color="purple" />
      </KpiGrid>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Bed Nights — Monthly Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="h-56 w-full">
            <LineChart data={snapshots}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5, 7)} fontSize={11} tickLine={false} axisLine={false} />
              <YAxis hide />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line type="monotone" dataKey="bedNights" stroke="var(--color-bedNights)" strokeWidth={2} dot={false} />
            </LineChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  );
}
