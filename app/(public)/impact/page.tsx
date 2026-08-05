import Image from "next/image";
import { Bed, Utensils, Car, HandCoins, Sparkles, Wallet } from "lucide-react";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { metricSnapshots } from "@/lib/mock-data";
import { formatCurrency } from "@/lib/utils/currency";

export default function PublicImpactPage() {
  const ytd = metricSnapshots.reduce(
    (acc, m) => ({
      bedNights: acc.bedNights + m.bedNights,
      meals: acc.meals + m.meals,
      trips: acc.trips + m.trips,
      careCartMeals: acc.careCartMeals + m.careCartMeals,
      activityParticipants: acc.activityParticipants + m.activityParticipants,
      donationsYtd: Math.max(acc.donationsYtd, m.donationsYtd),
    }),
    { bedNights: 0, meals: 0, trips: 0, careCartMeals: 0, activityParticipants: 0, donationsYtd: 0 }
  );

  return (
    <div className="mx-auto flex max-w-4xl flex-col items-center gap-8 px-6 py-16 text-center">
      <Image src="/logo/laf-horizontal.png" alt="Little Ark Foundation" width={280} height={52} />
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">2026 Year-to-Date Impact</h1>
        <p className="text-sm text-muted-foreground">
          Live from operations data — GET /api/impact reads aggregates only, cached and revalidated on write.
        </p>
      </div>

      <KpiGrid className="w-full sm:grid-cols-3">
        <KpiCard label="Bed Nights" value={ytd.bedNights.toLocaleString()} icon={Bed} color="blue" />
        <KpiCard label="Meals Served" value={ytd.meals.toLocaleString()} icon={Utensils} color="green" />
        <KpiCard label="Hospital Trips" value={ytd.trips.toLocaleString()} icon={Car} color="cyan" />
        <KpiCard label="Care Cart Meals" value={ytd.careCartMeals.toLocaleString()} icon={HandCoins} color="orange" />
        <KpiCard label="Activity Participants" value={ytd.activityParticipants.toLocaleString()} icon={Sparkles} color="purple" />
        <KpiCard label="Total Donations YTD" value={formatCurrency(ytd.donationsYtd)} icon={Wallet} color="rose" />
      </KpiGrid>

      <p className="text-xs text-muted-foreground">
        This prototype page reads from the same mock data as the internal Analytics dashboard — in production it would read
        only the <code className="rounded bg-muted px-1 py-0.5">metric_snapshots</code> table, with no credential path to
        patient or donor records.
      </p>
    </div>
  );
}
