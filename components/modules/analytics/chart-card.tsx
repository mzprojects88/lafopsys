"use client";

import * as React from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { Download } from "lucide-react";
import { SectionCard } from "@/components/patterns/section-card";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { csvLines, downloadCsv } from "@/lib/utils/csv";

export interface ChartSeries {
  key: string;
  label: string;
}

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

/**
 * One Analytics chart: bars over time ("bar"), a line over time ("line"), or a breakdown laid
 * sideways ("rank"). Every chart downloads its own numbers as CSV.
 */
export function ChartCard({
  title,
  note,
  data,
  series,
  kind = "bar",
  xKey = "label",
  csvName,
  stacked = false,
}: {
  title: string;
  note?: string;
  data: Record<string, string | number>[];
  series: ChartSeries[];
  kind?: "bar" | "line" | "rank";
  xKey?: string;
  csvName: string;
  stacked?: boolean;
}) {
  const config = Object.fromEntries(series.map((s, i) => [s.key, { label: s.label, color: COLORS[i % COLORS.length] }])) satisfies ChartConfig;
  const empty = data.every((row) => series.every((s) => !Number(row[s.key])));

  function csv() {
    const header = [xKey === "label" ? "Period" : "Group", ...series.map((s) => s.label)];
    downloadCsv(csvLines(header, data.map((row) => [String(row[xKey] ?? ""), ...series.map((s) => String(row[s.key] ?? 0))])), `${csvName}.csv`);
  }

  return (
    <SectionCard
      title={title}
      actions={
        <Button size="icon-sm" variant="ghost" aria-label={`Download ${title} as CSV`} onClick={csv} className="print:hidden">
          <Download />
        </Button>
      }
    >
      {note ? <p className="-mt-1 mb-2 text-theme-xs text-muted-foreground">{note}</p> : null}
      {empty ? (
        <p className="py-8 text-center text-theme-sm text-muted-foreground">Nothing in this range.</p>
      ) : (
        <ChartContainer config={config} className={kind === "rank" ? "w-full" : "h-60 w-full"} style={kind === "rank" ? { height: Math.max(120, data.length * 28 + 30) } : undefined}>
          {kind === "line" ? (
            <LineChart data={data} margin={{ left: 4, right: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey={xKey} tickLine={false} axisLine={false} fontSize={11} minTickGap={16} />
              <YAxis tickLine={false} axisLine={false} fontSize={11} width={36} allowDecimals={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              {series.length > 1 && <ChartLegend content={<ChartLegendContent />} />}
              {series.map((s) => (
                <Line key={s.key} dataKey={s.key} type="monotone" stroke={`var(--color-${s.key})`} strokeWidth={2} dot={false} />
              ))}
            </LineChart>
          ) : kind === "rank" ? (
            <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
              <CartesianGrid horizontal={false} />
              <XAxis type="number" hide allowDecimals={false} />
              <YAxis type="category" dataKey={xKey} tickLine={false} axisLine={false} fontSize={11} width={140} />
              <ChartTooltip content={<ChartTooltipContent />} />
              {series.map((s) => (
                <Bar key={s.key} dataKey={s.key} fill={`var(--color-${s.key})`} radius={4} />
              ))}
            </BarChart>
          ) : (
            <BarChart data={data} margin={{ left: 4, right: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey={xKey} tickLine={false} axisLine={false} fontSize={11} minTickGap={12} />
              <YAxis tickLine={false} axisLine={false} fontSize={11} width={36} allowDecimals={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              {series.length > 1 && <ChartLegend content={<ChartLegendContent />} />}
              {series.map((s) => (
                <Bar key={s.key} dataKey={s.key} fill={`var(--color-${s.key})`} radius={stacked ? 0 : 4} stackId={stacked ? "a" : undefined} />
              ))}
            </BarChart>
          )}
        </ChartContainer>
      )}
    </SectionCard>
  );
}
