"use client";

import { cn } from "@/lib/utils";

/** The fields of a Operations Stocks box the chart needs (Inventory 0066 / OS 0106). Same file in both apps. */
export interface DaysLeftBox {
  lineId: string;
  groupId: string;
  groupName: string;
  name: string;
  minDays: number;
  daysLeft: number | null;
  status: "out" | "low" | "ok" | "no_forecast" | "no_items";
}

/** Short status words, shared by the box cards and the chart rows. */
export const STATUS_SHORT: Record<DaysLeftBox["status"], string> = { out: "Out", low: "Low", ok: "OK", no_forecast: "No forecast", no_items: "No items" };

const BAR: Record<DaysLeftBox["status"], string> = { ok: "bg-success", low: "bg-warning", out: "bg-destructive", no_forecast: "bg-muted-foreground/40", no_items: "bg-muted-foreground/40" };

/**
 * One horizontal bar per box, grouped under its heading: length = projected days of use left,
 * a marker at the box's minimum. One scale for every group, capped at three times the largest
 * minimum, never under 60 days, so one well-stocked box doesn't flatten the rest ("60+" when clipped). Status is said
 * in words beside every bar, never by colour alone.
 */
export function DaysLeftChart({ boxes }: { boxes: DaysLeftBox[] }) {
  const groups = [...new Map(boxes.map((b) => [b.groupId, b.groupName])).entries()];
  const largestMin = Math.max(1, ...boxes.map((b) => b.minDays));
  const cap = Math.max(60, largestMin * 3);
  const max = Math.min(cap, Math.max(largestMin, ...boxes.map((b) => b.daysLeft ?? 0)) * 1.1);
  const pct = (days: number) => `${Math.min(100, (days / max) * 100)}%`;

  return (
    <div className="flex flex-col gap-4">
      {groups.map(([id, name]) => {
        const rows = boxes.filter((b) => b.groupId === id);
        const warn = rows.filter((b) => b.status === "low" || b.status === "out").length;
        return (
          <div key={id} className="flex flex-col gap-2">
            <p className="text-xs font-semibold text-foreground">
              {name}
              {warn ? <span className="ml-2 font-medium text-destructive">{warn} low or out</span> : null}
            </p>
            {rows.map((b) => {
              const clipped = b.daysLeft !== null && b.daysLeft > cap;
              const figure =
                b.status === "no_items" ? "no items" : b.status === "no_forecast" ? "no forecast" : b.status === "out" ? "0 d · Out" : `${clipped ? `${Math.round(cap)}+` : Math.round(b.daysLeft ?? 0)} d · ${STATUS_SHORT[b.status]}`;
              const label = `${b.name}: ${b.daysLeft === null ? "no forecast" : `${Math.round(b.daysLeft)} days left`}, minimum ${b.minDays}, ${STATUS_SHORT[b.status]}`;
              return (
                <div key={b.lineId} role="img" aria-label={label} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 text-xs text-foreground [overflow-wrap:anywhere] sm:w-44">{b.name}</span>
                  <div className="relative h-2.5 min-w-0 flex-1 rounded-full bg-muted">
                    {b.daysLeft !== null && b.daysLeft > 0 ? (
                      <div className={cn("h-full rounded-full", BAR[b.status])} style={{ width: pct(b.daysLeft) }} />
                    ) : b.status === "out" ? null : (
                      <div className={cn("h-full w-1 rounded-full", BAR[b.status])} />
                    )}
                    <span aria-hidden className="absolute top-1/2 h-4 w-0.5 -translate-y-1/2 rounded bg-foreground/60" style={{ left: pct(b.minDays) }} />
                  </div>
                  <span className={cn("w-24 shrink-0 text-right text-xs tabular-nums", b.status === "low" || b.status === "out" ? "font-medium text-destructive" : "text-muted-foreground")}>{figure}</span>
                </div>
              );
            })}
          </div>
        );
      })}
      <p className="text-xs text-muted-foreground">Bar = projected days of use left · | = the box&apos;s minimum days. A bar short of its marker is low.</p>
    </div>
  );
}
