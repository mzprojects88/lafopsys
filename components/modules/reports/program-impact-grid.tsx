"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SectionCard } from "@/components/patterns/section-card";
import { AiAnalysisPanel } from "@/components/modules/reports/report-ai";
import { IMPACT_GROUPS, cell, lineStatus, shown, total, type Bucket, type ImpactRow, type LineStatus } from "@/lib/utils/program-impact";
import { cn } from "@/lib/utils";

const STATUS: Record<LineStatus, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  live: { label: "Live from the app", variant: "default" },
  catching_up: { label: "Catching up", variant: "secondary" },
  not_encoded: { label: "Not encoded in the app yet", variant: "outline" },
  sheet_only: { label: "Sheet only", variant: "outline" },
};
const num = (n: number) => (Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 1 }));

/**
 * The sheet's Report as a grid: one row per line, a column per bucket (day, week or month), the
 * range's total. Each cell shows the app's figure (bold) and, until that source is switched off,
 * the sheet's figure under it. `analysis` is the AI's text per group, when the person asked for it.
 */
export function ProgramImpactGrid({ rows, buckets, analysis }: { rows: ImpactRow[]; buckets: Bucket[]; analysis?: Record<string, string> }) {
  const last = buckets[buckets.length - 1]?.key ?? "";
  return (
    <div className="flex flex-col gap-5">
      {IMPACT_GROUPS.map((g) => (
        <SectionCard
          key={g.group}
          flush
          className="overflow-hidden"
          title={g.group}
          description={g.description}
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
                  {buckets.map((b) => (
                    <th key={b.key} className="px-2 py-2 text-right font-medium whitespace-nowrap">
                      {b.label}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                  <th className="px-5 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {g.lines.map((l) => {
                  const status = lineStatus(rows, l.key, last);
                  return (
                    <tr key={l.key} className="border-b border-border last:border-0">
                      <td className="px-5 py-2 align-top">
                        <div className="font-medium text-foreground">{l.label}</div>
                        <div className="text-theme-xs text-muted-foreground">{l.unit}</div>
                      </td>
                      {buckets.map((b) => {
                        const c = cell(rows, l.key, b.key);
                        const hide = c.fromSheet === 0 || c.fromSheet === c.native;
                        return (
                          <td key={b.key} className="px-2 py-2 text-right align-top tabular-nums">
                            <div className={cn("font-semibold", c.native === 0 && "text-muted-foreground")}>{num(c.native)}</div>
                            {!hide ? <div className="text-theme-xs text-muted-foreground">{num(c.fromSheet)}</div> : null}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 text-right align-top font-semibold tabular-nums">
                        {num(total(rows, l.key))}
                        <div className="text-theme-xs font-normal text-muted-foreground">app {num(total(rows, l.key, (r) => r.native))}</div>
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
          {analysis?.[g.group] ? (
            <div className="px-5 pb-4">
              <AiAnalysisPanel text={analysis[g.group]} compact />
            </div>
          ) : null}
        </SectionCard>
      ))}
      <p className="text-theme-xs text-muted-foreground">
        Bold = from records made in the app. The smaller grey figure is what the sheet gave for that period (shown while the two differ). Totals add the larger of the two per column: {num(rows.reduce((s, r) => s + shown(r), 0))} in all.
      </p>
    </div>
  );
}
