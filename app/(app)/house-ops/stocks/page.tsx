"use client";

import { AlertTriangle, PackageX, Warehouse } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { useHouseStocks, type HouseStockBox } from "@/lib/hooks/use-kitchen-records";
import { cn } from "@/lib/utils";
import { STATUS_TONE_CLASSES, type StatusTone } from "@/lib/utils/status-colors";

const STATUS: Record<HouseStockBox["status"], { label: string; tone: StatusTone }> = {
  out: { label: "Out of stock", tone: "negative" },
  low: { label: "Running low", tone: "warning" },
  ok: { label: "OK", tone: "positive" },
  no_forecast: { label: "No forecast yet", tone: "neutral" },
  no_items: { label: "No items linked", tone: "neutral" },
};
const qty = (n: number) => Math.round(n * 100) / 100;

/**
 * House Operations Stocks (0106): the critical items the house must have, as LAF Inventory counts
 * them -- each box's on hand, a low-stock warning and the projected days of use left. Read only:
 * the boxes and their items are kept in LAF Inventory › House Operations Stocks.
 */
export default function HouseStocksPage() {
  const { rows, error } = useHouseStocks();
  const boxes = rows ?? [];
  const low = boxes.filter((b) => b.status === "low").length;
  const out = boxes.filter((b) => b.status === "out").length;
  const groups = [...new Map(boxes.map((b) => [b.groupId, b.groupName])).entries()];

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="House Operations Stocks" description="A tracking of critical items and their status, from LAF Inventory. Read only: the boxes and the items they count are kept in LAF Inventory › House Operations Stocks." />
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
        groups.map(([id, name]) => (
          <section key={id} className="rounded-2xl border border-border bg-card p-4">
            <h2 className="mb-3 text-theme-sm font-semibold text-foreground">{name}</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {boxes
                .filter((b) => b.groupId === id)
                .map((b) => {
                  const warn = b.status === "low" || b.status === "out";
                  return (
                    <div key={b.lineId} className={cn("rounded-2xl border p-3", warn ? "border-destructive/40 bg-destructive/5" : "border-border")}>
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-theme-sm font-semibold text-foreground">{b.name}</span>
                        <span className={cn("rounded-full px-2 py-0.5 text-theme-xs font-medium whitespace-nowrap", STATUS_TONE_CLASSES[STATUS[b.status].tone])}>{STATUS[b.status].label}</span>
                      </div>
                      <p className="mt-2 text-2xl font-bold tabular-nums text-foreground">
                        {b.items === 0 ? "—" : qty(b.onHand)} <span className="text-theme-sm font-medium text-muted-foreground">{b.items === 0 ? "" : (b.uom ?? "")}</span>
                      </p>
                      <p className={cn("mt-1 text-theme-xs", warn ? "text-destructive" : "text-muted-foreground")}>
                        {b.status === "no_items"
                          ? "No catalogue items linked yet."
                          : b.status === "out"
                            ? "Nothing on hand."
                            : b.daysLeft !== null
                              ? `≈ ${Math.round(b.daysLeft)} days left · about ${qty(b.usedPerDay)} ${b.uom ?? ""} a day · minimum ${b.minDays}`
                              : `${b.draws} draw${b.draws === 1 ? "" : "s"} recorded; not enough for a forecast`}
                        {b.mixedUnits ? " · mixed units" : ""}
                      </p>
                    </div>
                  );
                })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
