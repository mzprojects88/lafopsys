import { PageHeader } from "@/components/patterns/page-header";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { ModuleSubNav, type ModuleSubNavItem } from "@/components/patterns/module-subnav";
import { Users, Home, Share2, Percent, Car, Utensils, LayoutGrid, HeartPulse, Sparkles } from "lucide-react";
import { censusHistory, trips, mealServices } from "@/lib/mock-data";
import { TODAY_ISO } from "@/lib/utils/seeded-random";

const SUB_NAV: ModuleSubNavItem[] = [
  { href: "/house-ops/floor-plan", label: "Floor Plan", icon: LayoutGrid, color: "blue" },
  { href: "/house-ops/meals", label: "Meals", icon: Utensils, color: "green" },
  { href: "/house-ops/trips", label: "Trips", icon: Car, color: "cyan" },
  { href: "/house-ops/care-cart", label: "Care Cart", icon: HeartPulse, color: "rose" },
  { href: "/house-ops/activity-center", label: "Activity Center", icon: Sparkles, color: "purple" },
];

export default function HouseOpsPage() {
  const today = censusHistory.find((c) => c.date === TODAY_ISO) ?? censusHistory[censusHistory.length - 1];
  const yesterday = censusHistory[censusHistory.length - 2];
  const utilization = Math.round((today.unitsOccupied / today.totalUnits) * 100);
  const todaysTrips = trips.filter((t) => t.date === TODAY_ISO).length;
  const todaysMeals = mealServices.filter((m) => m.date === TODAY_ISO).length;

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
          value={today.inHouse}
          icon={Users}
          color="orange"
          deltaPct={yesterday ? Math.round(((today.inHouse - yesterday.inHouse) / yesterday.inHouse) * 100) : undefined}
          deltaLabel="vs yesterday"
        />
        <KpiCard label="Units Occupied" value={`${today.unitsOccupied} / ${today.totalUnits}`} icon={Home} color="blue" />
        <KpiCard label="Units Shared" value={today.unitsShared} icon={Share2} color="purple" />
        <KpiCard label="Utilization" value={`${utilization}%`} icon={Percent} color="amber" />
        <KpiCard label="Trips Today" value={todaysTrips} icon={Car} color="cyan" />
        <KpiCard label="Meal Services Today" value={todaysMeals} icon={Utensils} color="green" />
      </KpiGrid>
    </div>
  );
}
