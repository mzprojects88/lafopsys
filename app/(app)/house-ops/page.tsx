"use client";

import { PageHeader } from "@/components/patterns/page-header";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { ModuleSubNav, type ModuleSubNavItem } from "@/components/patterns/module-subnav";
import { Users, Home, Share2, Percent, Car, Utensils, HeartPulse, Sparkles } from "lucide-react";
import { useCensusData } from "@/lib/hooks/use-census-collection";
import { useBedOccupancy } from "@/lib/hooks/use-bed-occupancy";
import { useTripsData } from "@/lib/hooks/use-trips-collection";
import { useMealServicesData } from "@/lib/hooks/use-meal-services-collection";
import { todayIso } from "@/lib/utils/date";

const SUB_NAV: ModuleSubNavItem[] = [
  { href: "/house-ops/meals", label: "Meals", icon: Utensils },
  { href: "/house-ops/trips", label: "Trips", icon: Car },
  { href: "/house-ops/care-cart", label: "Care Cart", icon: HeartPulse },
  { href: "/house-ops/activity-center", label: "Activity Center", icon: Sparkles },
];

export default function HouseOpsPage() {
  const { history, loading } = useCensusData();
  const beds = useBedOccupancy();
  const { trips } = useTripsData();
  const { meals } = useMealServicesData();

  const today = history.find((c) => c.date === todayIso()) ?? history[history.length - 1];
  const yesterday = today ? history[history.findIndex((c) => c.date === today.date) - 1] : undefined;
  const todaysTrips = trips.filter((t) => t.date === todayIso()).length;
  const todaysMeals = meals.filter((m) => m.date === todayIso()).length;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="House Operations"
        description="Live census, floor plan, meals, transport, Care Cart, and Activity Center."
        action={<ModuleSubNav items={SUB_NAV} />}
      />

      <KpiGrid>
        <KpiCard
          label="In-House Now"
          value={today?.inHouse ?? (loading ? "…" : "—")}
          icon={Users}
          deltaPct={
            today && yesterday && yesterday.inHouse > 0
              ? Math.round(((today.inHouse - yesterday.inHouse) / yesterday.inHouse) * 100)
              : undefined
          }
          deltaLabel="vs previous day on record"
        />
        <KpiCard label="Beds Occupied" value={beds.total ? `${beds.occupied} / ${beds.total}` : beds.loading ? "…" : "—"} icon={Home} />
        <KpiCard label="Beds Shared" value={beds.total ? beds.shared : beds.loading ? "…" : "—"} icon={Share2} />
        <KpiCard label="Utilization" value={beds.utilization !== undefined ? `${beds.utilization}%` : beds.loading ? "…" : "—"} icon={Percent} />
        <KpiCard label="Trips Today" value={todaysTrips} icon={Car} />
        <KpiCard label="Meal Services Today" value={todaysMeals} icon={Utensils} />
      </KpiGrid>
    </div>
  );
}
