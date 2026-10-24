"use client";

import { AlertTriangle, PackageX, Warehouse } from "lucide-react";
import { DaysLeftChart, STATUS_SHORT } from "@/components/modules/house-ops/days-left-chart";
import { PageHeader } from "@/components/patterns/page-header";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { useHouseStocks, type HouseStockBox } from "@/lib/hooks/use-kitchen-records";
import { cn } from "@/lib/utils";
import { STATUS_TONE_CLASSES, type StatusTone } from "@/lib/utils/status-colors";

const TONE: Record<HouseStockBox["status"], StatusTone> = { out: "negative", low: "warning", ok: "positive", no_forecast: "neutral", no_items: "neutral" };
const qty = (n: number) => Math.round(n * 100) / 100;

/**
 * Operations Stocks (0106): the critical items the house must have, as LAF Inventory counts
 * them -- each box's on hand, a low-stock warning and the projected days of use left. Read only:
 * the boxes and their items are kept in LAF Inventory › Operations Stocks.
 */
export default function HouseStocksPage() {
  const { rows, error } = useHouseStocks();
  const boxes = rows ?? [];
  const low = boxes.filter((b) => b.status === "low").length;
  const out = boxes.filter((b) => b.status === "out").length;
  const groups = [...new Map(boxes.map((b) => [b.groupId, b.groupName])).entries()];

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Operations Stocks" description="A tracking of critical items and their status, from LAF Inventory. Read only: the boxes and the items they count are kept in LAF Inventory › Operations Stocks." />
      <KpiGrid>
        <KpiCard label="Boxes tracked" value={String(boxes.length)} icon={Warehouse} />
        <KpiCard label="Running low" value={String(low)} icon={AlertTriangle} tone={low ? "warning" : "default"} />
        <KpiCard label="Out of stock" value={String(out)} icon={PackageX} tone={out ? "negative" : "default"} />
      </KpiGrid>
      {error ? (
        <p className="text-theme-sm text-destructive">{error}</p>
      ) : rows === null ? (
        <p className="text-theme-sm text-muted-foreground">Loading stocks…</p>
      ) : (
        <>
          {boxes.length > 0 ? (
            <section className="rounded-2xl border border-border bg-card p-4">
              <h2 className="mb-1 text-theme-sm font-semibold text-foreground">Days of use left</h2>
              <p className="mb-3 text-theme-xs text-muted-foreground">Every box on one scale, grouped as below.</p>
              <DaysLeftChart boxes={boxes} />
            </section>
          ) : null}
          {groups.map(([id, name]) => (
          <section key={id} className="rounded-2xl border border-border bg-card p-4">
            <h2 className="mb-3 text-theme-sm font-semibold text-foreground">{name}</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {boxes
                .filter((b) => b.groupId === id)
                .map((b) => {
                  const warn = b.status === "low" || b.status === "out";
                  const note =
                    b.status === "no_items"
                      ? "No catalogue items linked yet"
                      : b.status === "out"
                        ? "Nothing on hand"
                        : b.daysLeft !== null
                          ? `≈ ${Math.round(b.daysLeft)} days · ${qty(b.usedPerDay)} ${b.uom ?? ""}/day · min ${b.minDays}`
                          : `${b.draws} draw${b.draws === 1 ? "" : "s"} recorded; not enough for a forecast`;
                  return (
                    <div key={b.lineId} className={cn("flex h-full min-w-0 flex-col rounded-2xl border p-3", warn ? "border-destructive/40 bg-destructive/5" : "border-border")}>
                      <span className="text-theme-sm font-semibold text-foreground [overflow-wrap:anywhere]">{b.name}</span>
                      <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
                        {b.items === 0 ? "—" : qty(b.onHand)} {b.items === 0 ? null : <span className="text-theme-sm font-medium text-muted-foreground">{b.uom ?? ""}</span>}
                      </p>
                      <span className={cn("mt-1.5 w-fit rounded-full px-2 py-0.5 text-theme-xs font-medium whitespace-nowrap", STATUS_TONE_CLASSES[TONE[b.status]])}>{STATUS_SHORT[b.status]}</span>
                      <p className={cn("mt-1.5 text-theme-xs [overflow-wrap:anywhere]", warn ? "text-destructive" : "text-muted-foreground")}>
                        {note}
                        {b.mixedUnits ? " · mixed units" : ""}
                      </p>
                    </div>
                  );
                })}
            </div>
          </section>
          ))}
        </>
      )}
    </div>
  );
}
