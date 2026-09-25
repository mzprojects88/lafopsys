"use client";

import { use } from "react";
import { ExternalLink } from "lucide-react";
import { EntityDetailHeader } from "@/components/patterns/entity-detail-header";
import { StatusBadge } from "@/components/patterns/status-badge";
import { EmptyState } from "@/components/patterns/empty-state";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/patterns/loading-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useConsumptionDaily,
  useLotsOnHand,
  useStockSummary,
  useStorageLocations,
  useWasteLog,
} from "@/lib/hooks/use-inventory-views";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/date";
import { expiryStatus } from "@/lib/utils/inventory-status";
import { inventoryAppHref } from "@/lib/utils/inventory-app";

const CONSUMPTION_WINDOW_DAYS = 14;
const CHANNEL_LABEL: Record<string, string> = { kitchen: "Kitchen", care_cart: "Care Cart", family: "Family" };

export default function InventoryItemPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = use(params);
  const { rows: stock, loading: stockLoading, error } = useStockSummary();
  const { rows: allLots } = useLotsOnHand();
  const { rows: allConsumption } = useConsumptionDaily();
  const { rows: allWaste } = useWasteLog();
  const { rows: locations } = useStorageLocations();

  const summaryRows = stock.filter((r) => r.item_id === itemId);
  const lots = allLots.filter((l) => l.item_id === itemId);
  const consumption = allConsumption.filter((c) => c.item_id === itemId);
  const waste = allWaste.filter((w) => w.item_id === itemId);
  const pathById = new Map(locations.map((l) => [l.id, l.path]));

  if (stockLoading) {
    return <LoadingState />;
  }
  if (error) {
    return <EmptyState title="Couldn't load this item" description={error} />;
  }
  if (summaryRows.length === 0) {
    // v_stock_summary only carries items that have (or had) lots. An item with
    // no stock history at all is still a real catalogue entry in the inventory app.
    return (
      <EmptyState
        title="No stock on record for this item"
        description="It may be a catalogue entry that has never been received, or the id is wrong. Open it in the LAF Inventory app to check."
      />
    );
  }

  const first = summaryRows[0];
  const onHand = summaryRows.reduce((s, r) => s + r.on_hand_qty, 0);
  const stockValue = summaryRows.reduce((s, r) => s + r.stock_value, 0);
  const status = summaryRows.some((r) => r.status === "out") && onHand <= 0 ? "out" : summaryRows.some((r) => r.status === "low") ? "low" : "ok";

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - CONSUMPTION_WINDOW_DAYS);
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  const recentIssued = consumption.filter((c) => c.date >= cutoffIso).reduce((s, c) => s + c.qty_issued, 0);
  const perDay = recentIssued / CONSUMPTION_WINDOW_DAYS;
  const daysOfCover = perDay > 0 ? Math.round(onHand / perDay) : null;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <EntityDetailHeader
        title={first.name}
        subtitle={`${first.category.toLowerCase()} · Unit: ${first.uom}`}
        badge={<StatusBadge domain="stock" status={status} />}
        metadata={[
          { label: "On Hand", value: `${onHand} ${first.uom}` },
          { label: "Stock Value", value: formatCurrency(stockValue) },
          { label: `Drawn / Day (${CONSUMPTION_WINDOW_DAYS}d)`, value: perDay > 0 ? perDay.toFixed(1) : "—" },
          { label: "Days of Cover", value: daysOfCover != null ? `${daysOfCover}d` : "—" },
          { label: "Reorder Point", value: `${first.reorder_point} ${first.uom}` },
        ]}
        actions={
          <Button size="sm" asChild>
            <a href={inventoryAppHref(`/catalogue/${itemId}`)} target="_blank" rel="noreferrer">
              <ExternalLink />
              Open in LAF Inventory
            </a>
          </Button>
        }
      />

      <Tabs defaultValue="lots">
        <TabsList>
          <TabsTrigger value="lots">Lots on hand ({lots.length})</TabsTrigger>
          <TabsTrigger value="consumption">Consumption ({consumption.length})</TabsTrigger>
          <TabsTrigger value="waste">Waste ({waste.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="lots" className="pt-4">
          {lots.length === 0 ? (
            <EmptyState title="No lots on hand" />
          ) : (
            <div className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
              {lots.map((lot) => (
                <div key={lot.lot_id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-theme-sm hover:bg-muted/60">
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {lot.qty_remaining} {lot.uom} · {pathById.get(lot.storage_location_id) ?? lot.storage_location_id}
                      </span>
                      <span className="text-theme-xs text-muted-foreground">
                        Received {formatDate(lot.received_at)} · {formatCurrency(lot.unit_cost)}/{lot.uom} · {lot.source_type === "donation" ? "Donated" : "Purchased"}
                      </span>
                    </div>
                    {lot.expiry_date && lot.days_left != null ? (
                      <div className="flex flex-col items-end">
                        <StatusBadge domain="expiry" status={expiryStatus(lot.days_left)} label={lot.days_left < 0 ? "expired" : `${lot.days_left}d left`} />
                        <span className="text-theme-xs text-muted-foreground">exp {formatDate(lot.expiry_date)}</span>
                      </div>
                    ) : (
                      <span className="text-theme-xs text-muted-foreground">No expiry</span>
                    )}
                  </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="consumption" className="pt-4">
          {consumption.length === 0 ? (
            <EmptyState title="Nothing drawn yet" />
          ) : (
            <div className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
              {consumption.map((c) => (
                <div key={`${c.date}-${c.house_id}-${c.channel ?? "none"}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-theme-sm hover:bg-muted/60">
                    <span className="font-medium">
                      {c.qty_issued} {first.uom} · {c.channel ? CHANNEL_LABEL[c.channel] ?? c.channel : "Issued"}
                    </span>
                    <span className="text-theme-xs text-muted-foreground">
                      {formatDate(c.date)} · {formatCurrency(c.cost)}
                    </span>
                  </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="waste" className="pt-4">
          {waste.length === 0 ? (
            <EmptyState title="No waste recorded" />
          ) : (
            <div className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
              {waste.map((w) => (
                <div key={w.transaction_id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-theme-sm hover:bg-muted/60">
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {w.qty} {first.uom}
                        {w.reason ? ` · ${w.reason}` : ""}
                      </span>
                      <span className="text-theme-xs text-muted-foreground">
                        {formatDate(w.date)} · {w.performed_by} · {formatCurrency(w.value)}
                      </span>
                    </div>
                  </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
