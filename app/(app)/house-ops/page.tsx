"use client";

import * as React from "react";
import { LoadingState } from "@/components/patterns/loading-state";
import { PeriodPresetsBar, usePeriodPresets } from "@/components/patterns/period-presets";
import { PageHeader } from "@/components/patterns/page-header";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { ModuleSubNav, type ModuleSubNavItem } from "@/components/patterns/module-subnav";
import { Users, Home, Share2, Percent, Car, Utensils, HeartPulse, Sparkles, Warehouse, CalendarDays } from "lucide-react";
import { useCensusData } from "@/lib/hooks/use-census-collection";
import { useBedOccupancy } from "@/lib/hooks/use-bed-occupancy";
import { useTripsData } from "@/lib/hooks/use-trips-collection";
import { useKitchenRecords } from "@/lib/hooks/use-kitchen-records";
import { todayIso } from "@/lib/utils/date";

const SUB_NAV: ModuleSubNavItem[] = [
  { href: "/house-ops/meals", label: "Meals", icon: Utensils },
  { href: "/house-ops/menu", label: "Weekly Menu", icon: CalendarDays },
  { href: "/transport", label: "Trips", icon: Car },
  { href: "/house-ops/care-cart", label: "Care Cart", icon: HeartPulse },
  { href: "/house-ops/activity-center", label: "Activity Center", icon: Sparkles },
  { href: "/house-ops/stocks", label: "Stocks", icon: Warehouse },
];

export default function HouseOpsPage() {
  return (
    <React.Suspense fallback={<LoadingState />}>
      <HouseOpsContent />
    </React.Suspense>
  );
}

function HouseOpsContent() {
  const { history, loading } = useCensusData();
  const beds = useBedOccupancy();
  const { trips } = useTripsData();
  // Trips and meals follow the period (Today by default); the census and beds stay "now".
  const period = usePeriodPresets("house-ops", "today");
  const w = period.window!;
  // Meals as the kitchen recorded them in LAF Inventory (0102).
  const { rows: todaysMealRows } = useKitchenRecords("house_meals", w.from, w.to);

  const today = history.find((c) => c.date === todayIso()) ?? history[history.length - 1];
  const yesterday = today ? history[history.findIndex((c) => c.date === today.date) - 1] : undefined;
  const todaysTrips = trips.filter((t) => t.date >= w.from && t.date <= w.to).length;
  const todaysMeals = (todaysMealRows ?? []).reduce((s, m) => s + m.served, 0);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="House Operations"
        description="Live census, floor plan, meals, transport, Care Cart, and Activity Center."
        action={<ModuleSubNav items={SUB_NAV} />}
      />

      <PeriodPresetsBar state={period.state} onChange={period.setState} today={period.today} />

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
        <KpiCard label="Beds Occupied" value={beds.total ? `${beds.occupied} / ${beds.total}` : beds.loading ? "…" : "—"} sublabel="Now" icon={Home} />
        <KpiCard label="Beds Shared" value={beds.total ? beds.shared : beds.loading ? "…" : "—"} sublabel="Now" icon={Share2} />
        <KpiCard label="Utilization" value={beds.utilization !== undefined ? `${beds.utilization}%` : beds.loading ? "…" : "—"} sublabel="Now" icon={Percent} />
        <KpiCard label="Trips" value={todaysTrips} sublabel={period.label} icon={Car} />
        <KpiCard label="Meals Served" value={todaysMeals} sublabel={period.label} icon={Utensils} />
      </KpiGrid>
    </div>
  );
}
