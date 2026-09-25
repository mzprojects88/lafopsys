"use client";

import { PageHeader } from "@/components/patterns/page-header";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { ModuleSubNav, type ModuleSubNavItem } from "@/components/patterns/module-subnav";
import { Users, Home, Share2, Percent, Car, Utensils, HeartPulse, Sparkles } from "lucide-react";
import { useCensusData } from "@/lib/hooks/use-census-collection";
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
  const { trips } = useTripsData();
  const { meals } = useMealServicesData();

  const today = history.find((c) => c.date === todayIso()) ?? history[history.length - 1];
  const yesterday = today ? history[history.findIndex((c) => c.date === today.date) - 1] : undefined;
  const utilization =
    today?.unitsOccupied !== undefined && today ? Math.round((today.unitsOccupied / today.totalUnits) * 100) : undefined;
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
        <KpiCard
          label="Units Occupied"
          value={today?.unitsOccupied !== undefined ? `${today.unitsOccupied} / ${today.totalUnits}` : "—"}
          icon={Home}
        />
        <KpiCard label="Units Shared" value={today?.unitsShared ?? "—"} icon={Share2} />
        <KpiCard label="Utilization" value={utilization !== undefined ? `${utilization}%` : "—"} icon={Percent} />
        <KpiCard label="Trips Today" value={todaysTrips} icon={Car} />
        <KpiCard label="Meal Services Today" value={todaysMeals} icon={Utensils} />
      </KpiGrid>
    </div>
  );
}
