import { PageHeader } from "@/components/patterns/page-header";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { Bed, Utensils, Car, HandCoins } from "lucide-react";
import { cashEntries, mealServices, trips, careCartLogs, programs } from "@/lib/mock-data";
import { censusHistory } from "@/lib/mock-data";
import { formatCurrency } from "@/lib/utils/currency";

function programSpend(programName: string) {
  const program = programs.find((p) => p.name === programName);
  return cashEntries
    .filter((e) => e.direction === "outflow" && e.programId === program?.id)
    .reduce((sum, e) => sum + e.amount, 0);
}

export default function CostPerOutcomePage() {
  const bedNights = censusHistory.reduce((sum, c) => sum + c.inHouse, 0);
  const mealsCount = mealServices.reduce((sum, m) => sum + m.headcount, 0);
  const tripsCount = trips.length;
  const careCartMeals = careCartLogs.reduce((sum, c) => sum + c.headcount, 0);

  // Real cash-entries.json has no programId (the source sheets have no program
  // mapping, see clean-finance-data.py) -- programSpend() legitimately returns 0
  // for every program with real data. Without this check every KPI below would
  // silently show "₱0.00" (implying nothing was spent) instead of "—" (implying
  // spend isn't attributed to a program yet), which is a materially different claim.
  const hasProgramAttribution = cashEntries.some((e) => e.programId);

  const housingSpend = programSpend("Housing");
  const mealsSpend = programSpend("Meals");
  const transportSpend = programSpend("Transportation");
  const careCartSpend = programSpend("Care Cart");

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
