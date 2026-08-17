"use client";

import { PageHeader } from "@/components/patterns/page-header";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { Bed, Utensils, Car, HandCoins } from "lucide-react";
import { useCashEntriesData } from "@/lib/hooks/use-cash-entries-collection";
import { useProgramsData } from "@/lib/hooks/use-programs-collection";
import { useCensusData } from "@/lib/hooks/use-census-collection";
import { useMealServicesData } from "@/lib/hooks/use-meal-services-collection";
import { useTripsData } from "@/lib/hooks/use-trips-collection";
import { useCareCartData } from "@/lib/hooks/use-care-cart-collection";
import { formatCurrency } from "@/lib/utils/currency";
import type { CashEntry } from "@/lib/types/finance";
import type { Program } from "@/lib/types/reference";

function programSpend(cashEntries: CashEntry[], programs: Program[], programName: string) {
  const program = programs.find((p) => p.name === programName);
  return cashEntries
    .filter((e) => e.direction === "outflow" && e.programId === program?.id)
    .reduce((sum, e) => sum + e.amount, 0);
}

export default function CostPerOutcomePage() {
  const { entries: cashEntries } = useCashEntriesData();
  const { programs } = useProgramsData();
  const { history: censusHistory } = useCensusData();
  const { meals: mealServices } = useMealServicesData();
  const { trips } = useTripsData();
  const { logs: careCartLogs } = useCareCartData();

  const bedNights = censusHistory.reduce((sum, c) => sum + c.inHouse, 0);
  const mealsCount = mealServices.reduce((sum, m) => sum + m.headcount, 0);
  const tripsCount = trips.length;
  const careCartMeals = careCartLogs.reduce((sum, c) => sum + c.headcount, 0);

  // Real cash_entries has no programId (the source sheets have no program
  // mapping, see clean-finance-data.py) -- programSpend() legitimately returns 0
  // for every program with real data. Without this check every KPI below would
  // silently show "₱0.00" (implying nothing was spent) instead of "—" (implying
  // spend isn't attributed to a program yet), which is a materially different claim.
  const hasProgramAttribution = cashEntries.some((e) => e.programId);

  const housingSpend = programSpend(cashEntries, programs, "Housing");
  const mealsSpend = programSpend(cashEntries, programs, "Meals");
  const transportSpend = programSpend(cashEntries, programs, "Transportation");
  const careCartSpend = programSpend(cashEntries, programs, "Care Cart");

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Cost per Outcome" description="Computed from program spend against operational counts over the sample period." />
      <KpiGrid>
        <KpiCard
          label="Cost / Bed Night"
          value={bedNights && hasProgramAttribution ? formatCurrency(housingSpend / bedNights) : "—"}
          icon={Bed}
          color="blue"
        />
        <KpiCard
          label="Cost / Meal"
          value={mealsCount && hasProgramAttribution ? formatCurrency(mealsSpend / mealsCount) : "—"}
          icon={Utensils}
          color="green"
        />
        <KpiCard
          label="Cost / Trip"
          value={tripsCount && hasProgramAttribution ? formatCurrency(transportSpend / tripsCount) : "—"}
          icon={Car}
          color="cyan"
        />
        <KpiCard
          label="Cost / Care Cart Meal"
          value={careCartMeals && hasProgramAttribution ? formatCurrency(careCartSpend / careCartMeals) : "—"}
          icon={HandCoins}
          color="orange"
        />
      </KpiGrid>
    </div>
  );
}
