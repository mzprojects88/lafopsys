"use client";

import * as React from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { Users, HeartPulse, Droplets, Home, Share2, Percent, Bed, Utensils, Car, Sparkles, HandCoins, Package, PackageX, Wallet, TrendingDown, Timer } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { useRole } from "@/lib/rbac/use-role";
import {
  patients,
  diagnoses,
  provinces,
  censusHistory,
  metricSnapshots,
  donations,
  donors,
  inventoryLots,
  inventoryItems,
  cashEntries,
  accounts,
  programs,
} from "@/lib/mock-data";
import { computeAge, ageBracket } from "@/lib/utils/age";
import { formatCurrency } from "@/lib/utils/currency";
import { daysUntil } from "@/lib/utils/date";

const AGE_ORDER = ["0–1", "2–5", "6–9", "10–12", "13–15", "16–18"];

export default function AnalyticsPage() {
  const { role } = useRole();
  const isBoard = role === "board";
  const [panelBMode, setPanelBMode] = React.useState<"nights" | "unique">("nights");

  // Panel A — Enrolled Patients Overview
  const sexSplit = { M: patients.filter((p) => p.sex === "M").length, F: patients.filter((p) => p.sex === "F").length };
  const ageBrackets = AGE_ORDER.map((bracket) => ({
    bracket,
    count: patients.filter((p) => ageBracket(computeAge(p.birthDate)) === bracket).length,
  }));
  const illnessBreakdown = ["cancer", "thalassemia", "other"].map((cat) => ({
    category: cat,
    count: patients.filter((p) => p.diagnosisIds.some((id) => diagnoses.find((d) => d.id === id)?.category === cat)).length,
  }));
  const statusBreakdown = ["ongoing", "check_up", "completed", "expired", "lost_to_follow_up", "non_pedia"].map((s) => ({
    status: s,
    count: patients.filter((p) => p.status === s).length,
  }));

  // Panel B — Accommodated Clients by Diagnosis
  const accommodated = patients.filter((p) => p.status === "ongoing" || p.status === "check_up");
  const panelBData = ["cancer", "thalassemia", "other"].map((cat) => {
    const catPatients = accommodated.filter((p) => p.diagnosisIds.some((id) => diagnoses.find((d) => d.id === id)?.category === cat));
    const nights = catPatients.reduce((sum, p) => sum + Math.min(180, Math.abs(daysUntil(p.admittedAt))), 0);
    return { category: cat, unique: catPatients.length, nights };
  });

  // Panel C — Distribution by Province
  const byProvince = provinces
    .map((prov) => ({ name: prov.name, count: patients.filter((p) => p.provinceId === prov.id).length }))
    .filter((p) => p.count > 0)
    .sort((a, b) => b.count - a.count);

  // Panel D — Live Census
  const today = censusHistory[censusHistory.length - 1];

  // Panel E — Impact YTD
  const ytd = metricSnapshots.reduce(
    (acc, m) => ({
      bedNights: acc.bedNights + m.bedNights,
      meals: acc.meals + m.meals,
      trips: acc.trips + m.trips,
      careCartMeals: acc.careCartMeals + m.careCartMeals,
      activityParticipants: acc.activityParticipants + m.activityParticipants,
    }),
    { bedNights: 0, meals: 0, trips: 0, careCartMeals: 0, activityParticipants: 0 }
  );
  const lastMonth = metricSnapshots[metricSnapshots.length - 1];
  const prevMonth = metricSnapshots[metricSnapshots.length - 2];
  const bedNightDelta = prevMonth ? Math.round(((lastMonth.bedNights - prevMonth.bedNights) / prevMonth.bedNights) * 100) : undefined;

  // Panel F — Donations & Inventory
  const cashTotal = donations.filter((d) => d.kind === "cash").reduce((s, d) => s + d.totalValue, 0);
  const inKindTotal = donations.filter((d) => d.kind === "in_kind").reduce((s, d) => s + d.totalValue, 0);
  const topDonors = [...donors].sort((a, b) => b.lifetimeValue - a.lifetimeValue).slice(0, 5);
  const expiringSoon = inventoryLots.filter((l) => l.expiryDate && daysUntil(l.expiryDate) <= 14 && daysUntil(l.expiryDate) >= 0).length;
  const lowStockItems = inventoryItems.filter((item) => {
    const stock = inventoryLots.filter((l) => l.itemId === item.id).reduce((s, l) => s + l.quantity, 0);
    return stock <= item.reorderPoint;
  }).length;

  // Panel G — Financial
  const totalIn = cashEntries.filter((e) => e.direction === "inflow").reduce((s, e) => s + e.amount, 0);
  const totalOut = cashEntries.filter((e) => e.direction === "outflow").reduce((s, e) => s + e.amount, 0);
  const monthlyBurn = totalOut / 7; // sample period ≈ 7 months
  const cashOnHand = accounts.reduce((s, a) => s + (a.currency === "PHP" ? a.balance : a.balance * 56), 0);
  const runwayMonths = monthlyBurn > 0 ? Math.round(cashOnHand / monthlyBurn) : undefined;
  const programSpendChart = programs.map((p) => ({
    program: p.name,
    amount: cashEntries.filter((e) => e.direction === "outflow" && e.programId === p.id).reduce((s, e) => s + e.amount, 0),
  }));

  const cashflowChartConfig: ChartConfig = {
    bedNights: { label: "Bed Nights", color: "var(--chart-1)" },
  };
  const programChartConfig: ChartConfig = { amount: { label: "Spend", color: "var(--chart-2)" } };

  return (
    <div className="flex flex-1 flex-col gap-8">
      <PageHeader
        title="Analytics Dashboard"
        description={isBoard ? "Aggregate view — no clinical detail is shown to the Board role." : "All panels derived from operations data — nothing here can disagree with the modules that feed it."}
      />

      {/* Panel A */}
      {!isBoard && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground">Panel A — Enrolled Patients Overview</h2>
          <KpiGrid>
            <KpiCard label="Total Enrolled" value={patients.length} icon={Users} color="purple" />
            <KpiCard label="Male / Female" value={`${sexSplit.M} / ${sexSplit.F}`} icon={Users} color="blue" />
            <KpiCard label="Cancer" value={illnessBreakdown.find((i) => i.category === "cancer")?.count ?? 0} icon={HeartPulse} color="rose" />
            <KpiCard label="Thalassemia" value={illnessBreakdown.find((i) => i.category === "thalassemia")?.count ?? 0} icon={Droplets} color="red" />
          </KpiGrid>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-sm">Age Brackets</CardTitle></CardHeader>
              <CardContent>
                <ChartContainer config={{ count: { label: "Patients", color: "var(--chart-1)" } }} className="h-56 w-full">
                  <BarChart data={ageBrackets}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="bracket" tickLine={false} axisLine={false} fontSize={11} />
                    <YAxis hide />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="count" fill="var(--color-count)" radius={4} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Status Breakdown</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {statusBreakdown.map((s) => (
                  <Badge key={s.status} variant="secondary" className="text-xs capitalize">
                    {s.status.replace("_", " ")}: {s.count}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          </div>
        </section>
      )}

      {/* Panel B */}
      {!isBoard && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground">Panel B — Accommodated Clients by Diagnosis</h2>
            <div className="flex gap-1">
              <Button size="sm" variant={panelBMode === "nights" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setPanelBMode("nights")}>
                Patient-Nights
              </Button>
              <Button size="sm" variant={panelBMode === "unique" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setPanelBMode("unique")}>
                Unique Patients
              </Button>
            </div>
          </div>
          <p className="text-xs text-amber-700 dark:text-amber-400">
            ⚠ These two measures tell very different stories — &ldquo;162 cancer patients&rdquo; reads as headcount but often means patient-nights. Toggle to compare.
          </p>
          <KpiGrid>
            {panelBData.map((row) => (
              <KpiCard
                key={row.category}
                label={`${row.category[0].toUpperCase()}${row.category.slice(1)} (${panelBMode === "nights" ? "nights" : "patients"})`}
                value={panelBMode === "nights" ? row.nights : row.unique}
                icon={row.category === "cancer" ? HeartPulse : row.category === "thalassemia" ? Droplets : Users}
                color={row.category === "cancer" ? "rose" : row.category === "thalassemia" ? "red" : "slate"}
              />
            ))}
          </KpiGrid>
        </section>
      )}

      {/* Panel C */}
      {!isBoard && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground">Panel C — Distribution by Province/Area</h2>
          <Card>
            <CardContent className="flex flex-col gap-2 pt-6">
              {byProvince.map((p) => (
                <div key={p.name} className="flex items-center gap-3">
                  <span className="w-32 shrink-0 text-sm">{p.name}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${(p.count / byProvince[0].count) * 100}%` }}
                    />
                  </div>
                  <span className="w-6 text-right text-xs text-muted-foreground">{p.count}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      )}

      {/* Panel D */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Panel D — Live House Census</h2>
        <KpiGrid>
          <KpiCard label="In-House Now" value={today.inHouse} icon={Users} color="orange" />
          <KpiCard label="Units Occupied" value={`${today.unitsOccupied} / ${today.totalUnits}`} icon={Home} color="blue" />
          <KpiCard label="Units Shared" value={today.unitsShared} icon={Share2} color="purple" />
          <KpiCard label="Utilization" value={`${Math.round((today.unitsOccupied / today.totalUnits) * 100)}%`} icon={Percent} color="amber" />
        </KpiGrid>
      </section>

      {/* Panel E */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Panel E — Impact YTD</h2>
        <KpiGrid>
          <KpiCard label="Bed Nights" value={ytd.bedNights.toLocaleString()} icon={Bed} color="blue" deltaPct={bedNightDelta} deltaLabel="vs prior month" />
          <KpiCard label="Meals" value={ytd.meals.toLocaleString()} icon={Utensils} color="green" />
          <KpiCard label="Trips" value={ytd.trips.toLocaleString()} icon={Car} color="cyan" />
          <KpiCard label="Care Cart Meals" value={ytd.careCartMeals.toLocaleString()} icon={HandCoins} color="orange" />
          <KpiCard label="Activity Participants" value={ytd.activityParticipants.toLocaleString()} icon={Sparkles} color="purple" />
        </KpiGrid>
        <Card>
          <CardHeader><CardTitle className="text-sm">Bed Nights — Monthly Trend</CardTitle></CardHeader>
          <CardContent>
            <ChartContainer config={cashflowChartConfig} className="h-56 w-full">
              <LineChart data={metricSnapshots}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5, 7)} fontSize={11} tickLine={false} axisLine={false} />
                <YAxis hide />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line type="monotone" dataKey="bedNights" stroke="var(--color-bedNights)" strokeWidth={2} dot={false} />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </section>

      {/* Panel F */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Panel F — Donations & Inventory</h2>
        <KpiGrid>
          <KpiCard label="Cash Donations" value={formatCurrency(cashTotal)} icon={HandCoins} color="green" />
          <KpiCard label="In-Kind Value" value={formatCurrency(inKindTotal)} icon={Package} color="teal" />
          <KpiCard label="Expiring ≤ 14 days" value={expiringSoon} icon={PackageX} color="rose" />
          <KpiCard label="Below Reorder Point" value={lowStockItems} icon={PackageX} color="amber" />
        </KpiGrid>
        <Card>
          <CardHeader><CardTitle className="text-sm">Top Donors (Lifetime Value)</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2">
            {topDonors.map((d) => (
              <div key={d.id} className="flex items-center justify-between text-sm">
                <span>{d.name}</span>
                <span className="font-medium tabular-nums">{formatCurrency(d.lifetimeValue)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      {/* Panel G */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Panel G — Financial</h2>
        <KpiGrid>
          <KpiCard label="Cashflow In" value={formatCurrency(totalIn)} icon={HandCoins} color="green" />
          <KpiCard label="Cashflow Out" value={formatCurrency(totalOut)} icon={TrendingDown} color="rose" />
          <KpiCard label="Cash on Hand (PHP eq.)" value={formatCurrency(cashOnHand)} icon={Wallet} color="blue" />
          <KpiCard label="Runway" value={runwayMonths ? `${runwayMonths} months` : "—"} icon={Timer} color="amber" />
        </KpiGrid>
        <Card>
          <CardHeader><CardTitle className="text-sm">Program Allocation</CardTitle></CardHeader>
          <CardContent>
            <ChartContainer config={programChartConfig} className="h-56 w-full">
              <BarChart data={programSpendChart}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="program" tickLine={false} axisLine={false} fontSize={10} interval={0} angle={-20} textAnchor="end" height={50} />
                <YAxis hide />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="amount" fill="var(--color-amount)" radius={4} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
