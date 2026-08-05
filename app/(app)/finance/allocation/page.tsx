"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { PageHeader } from "@/components/patterns/page-header";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Percent, TrendingDown, HandCoins } from "lucide-react";
import { cashEntries, programs } from "@/lib/mock-data";
import { formatCurrency } from "@/lib/utils/currency";

const chartConfig: ChartConfig = {
  amount: { label: "Spend", color: "var(--chart-1)" },
};

export default function AllocationPage() {
  const outflows = cashEntries.filter((e) => e.direction === "outflow");
  const totalOutflow = outflows.reduce((sum, e) => sum + e.amount, 0);
  const programOutflows = cashEntries.filter((e) => e.direction === "outflow" && e.programId);
  const programSpend = totalOutflow > 0 ? programOutflows.reduce((s, e) => s + e.amount, 0) : 0;
  const programPct = totalOutflow > 0 ? Math.round((programSpend / totalOutflow) * 100) : 0;

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
        <KpiCard label="% to Programs" value={`${programPct}%`} icon={Percent} color="green" />
        <KpiCard label="Total Outflow" value={formatCurrency(totalOutflow)} icon={TrendingDown} color="rose" />
        <KpiCard label="Program Spend" value={formatCurrency(programSpend)} icon={HandCoins} color="blue" />
      </KpiGrid>

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
