"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { PageHeader } from "@/components/patterns/page-header";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Percent, TrendingDown, HandCoins } from "lucide-react";
import { useCashEntriesData } from "@/lib/hooks/use-cash-entries-collection";
import { useProgramsData } from "@/lib/hooks/use-programs-collection";
import { formatCurrency } from "@/lib/utils/currency";

const chartConfig: ChartConfig = {
  amount: { label: "Spend", color: "var(--chart-1)" },
};

export default function AllocationPage() {
  const { entries: cashEntries } = useCashEntriesData();
  const { programs } = useProgramsData();
  const outflows = cashEntries.filter((e) => e.direction === "outflow");
  const totalOutflow = outflows.reduce((sum, e) => sum + e.amount, 0);

  // Real cash_entries has zero program attribution (see cost-per-outcome's own
  // comment on the same fact) -- without this check "% to Programs" would
  // silently read "0%" (implying nothing went to programs) instead of "—"
  // (implying spend isn't attributed to a program yet), a materially
  // different claim.
  const hasProgramAttribution = cashEntries.some((e) => e.programId);
  const programOutflows = cashEntries.filter((e) => e.direction === "outflow" && e.programId);
  const programSpend = programOutflows.reduce((s, e) => s + e.amount, 0);
  const programPct = totalOutflow > 0 && hasProgramAttribution ? Math.round((programSpend / totalOutflow) * 100) : undefined;

  const chartData = programs.map((p) => ({
    program: p.name,
    amount: outflows.filter((e) => e.programId === p.id).reduce((s, e) => s + e.amount, 0),
  }));

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Program Allocation"
        description="Converts the website's headline percentage from an assertion into a computed, auditable figure."
      />

      <KpiGrid>
        <KpiCard label="% to Programs" value={programPct !== undefined ? `${programPct}%` : "—"} icon={Percent} color="green" />
        <KpiCard label="Total Outflow" value={formatCurrency(totalOutflow)} icon={TrendingDown} color="rose" />
        <KpiCard
          label="Program Spend"
          value={hasProgramAttribution ? formatCurrency(programSpend) : "—"}
          icon={HandCoins}
          color="blue"
        />
      </KpiGrid>

      {!hasProgramAttribution && (
        <p className="text-xs text-muted-foreground">
          No cash entries have a program assigned yet — real historical entries weren&apos;t attributed to a program in the
          source records. New entries can set one.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Spend by Program</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="h-72 w-full">
            <BarChart data={chartData} layout="vertical" margin={{ left: 16 }}>
              <CartesianGrid horizontal={false} />
              <XAxis type="number" tickFormatter={(v) => `₱${Math.round(v / 1000)}k`} />
              <YAxis type="category" dataKey="program" width={100} tick={{ fontSize: 12 }} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="amount" fill="var(--color-amount)" radius={4} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  );
}
