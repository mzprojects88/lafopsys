"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SectionCard } from "@/components/patterns/section-card";
import { IMPACT_GROUPS, cell, lineStatus, shown, ytd, type ImpactRow, type LineStatus } from "@/lib/utils/program-impact";
import { cn } from "@/lib/utils";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STATUS: Record<LineStatus, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  live: { label: "Live from the app", variant: "default" },
  catching_up: { label: "Catching up", variant: "secondary" },
  not_encoded: { label: "Not encoded in the app yet", variant: "outline" },
  sheet_only: { label: "Sheet only", variant: "outline" },
};
const num = (n: number) => (Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 1 }));

/**
 * The sheet's Report as a grid: one row per line, a column per month, YTD. Each cell shows the
 * app's figure (bold) and, until that source is switched off, the sheet's figure under it.
 */
export function ProgramImpactGrid({ rows, year, throughMonth, currentMonth }: { rows: ImpactRow[]; year: number; throughMonth: number; currentMonth: number }) {
  const months = MONTHS.slice(0, throughMonth);
  return (
    <div className="flex flex-col gap-5">
      {IMPACT_GROUPS.map((g) => (
        <SectionCard
          key={g.group}
          flush
          className="overflow-hidden"
          title={g.group}
          actions={
            <Link href={g.href} className="inline-flex items-center gap-1 text-theme-xs font-medium text-primary hover:underline">
              View more <ArrowUpRight className="size-3.5" />
            </Link>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-theme-sm">
              <thead>
                <tr className="border-b border-border text-left text-theme-xs text-muted-foreground">
                  <th className="px-5 py-2 font-medium">Line</th>
                  {months.map((m) => (
                    <th key={m} className="px-2 py-2 text-right font-medium">
                      {m}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right font-medium">{year} YTD</th>
                  <th className="px-5 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {g.lines.map((l) => {
                  const status = lineStatus(rows, l.key, currentMonth);
                  return (
                    <tr key={l.key} className="border-b border-border last:border-0">
                      <td className="px-5 py-2 align-top">
                        <div className="font-medium text-foreground">{l.label}</div>
                        <div className="text-theme-xs text-muted-foreground">{l.unit}</div>
                      </td>
                      {months.map((m, i) => {
                        const c = cell(rows, l.key, i + 1);
                        const hide = c.fromSheet === 0 || c.fromSheet === c.native;
                        return (
                          <td key={m} className="px-2 py-2 text-right align-top tabular-nums">
                            <div className={cn("font-semibold", c.native === 0 && "text-muted-foreground")}>{num(c.native)}</div>
                            {!hide ? <div className="text-theme-xs text-muted-foreground">{num(c.fromSheet)}</div> : null}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 text-right align-top font-semibold tabular-nums">
                        {num(ytd(rows, l.key, throughMonth))}
                        <div className="text-theme-xs font-normal text-muted-foreground">app {num(ytd(rows, l.key, throughMonth, (r) => r.native))}</div>
                      </td>
                      <td className="px-5 py-2 align-top">
                        <Badge variant={STATUS[status].variant}>{STATUS[status].label}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
      ))}
      <p className="text-theme-xs text-muted-foreground">
        Bold = from records made in the app. The smaller grey figure is what the sheet gave for that month (shown while the two differ). YTD adds the larger of the two per month: {num(rows.filter((r) => r.month <= throughMonth).reduce((s, r) => s + shown(r), 0))} entries in all.
      </p>
    </div>
  );
}
