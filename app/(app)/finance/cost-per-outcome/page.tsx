"use client";

import * as React from "react";
import { Bed, Car, HandCoins, Utensils } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { SectionCard } from "@/components/patterns/section-card";
import { EmptyState } from "@/components/patterns/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils/currency";
import { todayIso } from "@/lib/utils/date";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface Row {
  month: number;
  spending: number;
  people_nights: number;
  food_cash: number;
  food_goods: number;
  meals: number;
  transport_cash: number;
  rides: number;
  care_cart_goods: number;
  care_cart_servings: number;
}

/** Cost of one unit, or null when either side is missing (no statement yet, nothing delivered). */
const per = (cost: number, units: number) => (cost > 0 && units > 0 ? cost / units : null);
const money = (n: number | null) => (n === null ? "—" : formatCurrency(Math.round(n * 100) / 100));

/**
 * Finance › Cost per outcome (0115): what the money and the donated goods bought each month,
 * against what the house delivered. Cash comes from the bank debits by purpose; goods from the
 * value of what Inventory drew for the kitchen and the Care Cart; units from the Programs report.
 */
export default function CostPerOutcomePage() {
  const thisYear = Number(todayIso().slice(0, 4));
  const [year, setYear] = React.useState(thisYear);
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    void createClient()
      .schema("ops")
      .rpc("cost_per_outcome", { p_year: year })
      .then(({ data, error: e }) => {
        if (!live) return;
        if (e) setError(e.message);
        else setRows(((data ?? []) as Row[]).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v)])) as unknown as Row));
      });
    return () => {
      live = false;
    };
  }, [year]);

  const sum = (k: keyof Row) => (rows ?? []).reduce((s, r) => s + r[k], 0);
  // The year so far counts only months with a statement, so a month not yet uploaded doesn't dilute the cost.
  const withBank = (rows ?? []).filter((r) => r.spending > 0);
  const sumBank = (k: keyof Row) => withBank.reduce((s, r) => s + r[k], 0);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Cost per Outcome"
        description="What each night, meal, ride and Care Cart serving cost: cash from the bank's debits by purpose, donated goods from what Inventory drew, units from Reports › Programs."
        action={
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[thisYear, thisYear - 1].map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      {error ? (
        <EmptyState title="Couldn't load the costs" description={error} />
      ) : !rows ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <KpiGrid>
            <KpiCard label="Per person-night" value={money(per(sumBank("spending"), sumBank("people_nights")))} sublabel="All spending ÷ people housed each night" icon={Bed} />
            <KpiCard label="Per meal" value={money(per(sumBank("food_cash"), sumBank("meals")))} sublabel={`Food bought; donated food adds ${money(per(sum("food_goods"), sum("meals")))}`} icon={Utensils} />
            <KpiCard label="Per ride" value={money(per(sumBank("transport_cash"), sumBank("rides")))} sublabel="Transport and fuel ÷ one-way rides" icon={Car} />
            <KpiCard label="Per Care Cart serving" value={money(per(sum("care_cart_goods"), sum("care_cart_servings")))} sublabel="Value of goods drawn ÷ servings" icon={HandCoins} />
          </KpiGrid>
          <SectionCard flush className="overflow-hidden" title={`${year} by month`} description="A month without an uploaded bank statement shows no cash costs. Purposes come from Bank import › What the money was spent on.">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-theme-sm">
                <thead>
                  <tr className="border-b border-border text-right text-theme-xs text-muted-foreground">
                    <th className="h-10 px-4 text-left font-medium">Month</th>
                    <th className="h-10 px-4 font-medium">Spending</th>
                    <th className="h-10 px-4 font-medium">People-nights</th>
                    <th className="h-10 px-4 font-medium">Per night</th>
                    <th className="h-10 px-4 font-medium">Meals</th>
                    <th className="h-10 px-4 font-medium">Cash per meal</th>
                    <th className="h-10 px-4 font-medium">Donated per meal</th>
                    <th className="h-10 px-4 font-medium">Rides</th>
                    <th className="h-10 px-4 font-medium">Per ride</th>
                    <th className="h-10 px-4 font-medium">Care Cart per serving</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.month} className="border-b border-border text-right tabular-nums">
                      <td className="px-4 py-2.5 text-left font-medium">{MONTHS[r.month - 1]}</td>
                      <td className="px-4 py-2.5">{r.spending ? formatCurrency(r.spending) : "—"}</td>
                      <td className="px-4 py-2.5">{r.people_nights || "—"}</td>
                      <td className="px-4 py-2.5">{money(per(r.spending, r.people_nights))}</td>
                      <td className="px-4 py-2.5">{r.meals || "—"}</td>
                      <td className="px-4 py-2.5">{money(per(r.food_cash, r.meals))}</td>
                      <td className="px-4 py-2.5">{money(per(r.food_goods, r.meals))}</td>
                      <td className="px-4 py-2.5">{r.rides || "—"}</td>
                      <td className="px-4 py-2.5">{money(per(r.transport_cash, r.rides))}</td>
                      <td className="px-4 py-2.5">{money(per(r.care_cart_goods, r.care_cart_servings))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
}
