"use client";

import { use } from "react";
import { notFound } from "next/navigation";
import { toast } from "sonner";
import { EntityDetailHeader } from "@/components/patterns/entity-detail-header";
import { StatusBadge } from "@/components/patterns/status-badge";
import { EmptyState } from "@/components/patterns/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  inventoryItems,
  inventoryLots,
  inventoryTxns,
  unitsOfMeasure,
  donors,
} from "@/lib/mock-data";
import { storageLocationPath } from "@/lib/utils/storage-path";
import { formatDate, daysUntil } from "@/lib/utils/date";
import { TODAY_ISO } from "@/lib/utils/seeded-random";

function expiryStatus(daysLeft: number) {
  if (daysLeft < 0) return "expired";
  if (daysLeft <= 14) return "soon14";
  if (daysLeft <= 30) return "soon30";
  if (daysLeft <= 60) return "soon60";
  return "fresh";
}

export default function InventoryItemPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = use(params);
  const item = inventoryItems.find((i) => i.id === itemId);
  if (!item) notFound();

  const lots = inventoryLots.filter((l) => l.itemId === item.id);
  const txns = inventoryTxns.filter((t) => t.itemId === item.id).sort((a, b) => b.date.localeCompare(a.date));
  const uom = unitsOfMeasure.find((u) => u.id === item.defaultUomId);
  const totalStock = lots.reduce((sum, l) => sum + l.quantity, 0);

  const issuedTotal = txns.filter((t) => t.type === "issue").reduce((sum, t) => sum + t.quantity, 0);
  const consumptionPerDay = issuedTotal / 14; // txn history spans ~2 weeks in the seed data
  const daysOfCover = consumptionPerDay > 0 ? Math.round(totalStock / consumptionPerDay) : Infinity;
  const reorderStatus = totalStock === 0 ? "out" : totalStock <= item.reorderPoint ? "reorder" : totalStock <= item.reorderPoint * 1.5 ? "low" : "ok";

  function action(label: string) {
    toast.success(`${label} recorded (demo — no persistence beyond this session)`);
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <EntityDetailHeader
        title={item.name}
        subtitle={`${item.category} · Default unit: ${uom?.name ?? "—"}`}
        badge={<StatusBadge domain="stock" status={reorderStatus} />}
        metadata={[
          { label: "Total Stock", value: `${totalStock} ${uom?.code ?? ""}` },
          { label: "Consumption / Day", value: consumptionPerDay > 0 ? consumptionPerDay.toFixed(1) : "—" },
          { label: "Days of Cover", value: Number.isFinite(daysOfCover) ? `${daysOfCover}d` : "—" },
          { label: "Reorder Point / Qty", value: `${item.reorderPoint} / ${item.reorderQty}` },
        ]}
        actions={
          <>
            <Button size="sm" onClick={() => action("Replenish")}>Replenish</Button>
            <Button size="sm" variant="outline" onClick={() => action("Issue")}>Issue</Button>
            <Button size="sm" variant="outline" onClick={() => action("Move")}>Move</Button>
            <Button size="sm" variant="outline" onClick={() => action("Adjust")}>Adjust</Button>
            <Button size="sm" variant="outline" className="text-red-600" onClick={() => action("Waste")}>Mark Waste</Button>
          </>
        }
      />

      <Tabs defaultValue="lots">
        <TabsList>
          <TabsTrigger value="lots">Lots ({lots.length})</TabsTrigger>
          <TabsTrigger value="history">Transaction History ({txns.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="lots" className="pt-4">
          {lots.length === 0 ? (
            <EmptyState title="No lots on hand" />
          ) : (
            <div className="flex flex-col gap-2">
              {lots.map((lot) => {
                const donor = donors.find((d) => d.id === lot.sourceDonorId);
                const daysLeft = lot.expiryDate ? daysUntil(lot.expiryDate) : undefined;
                return (
                  <Card key={lot.id}>
                    <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                      <div className="flex flex-col">
                        <span className="font-medium">
                          {lot.quantity} {uom?.code} · {storageLocationPath(lot.storageLocationId)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Received {formatDate(lot.receivedAt)} · Cost ₱{lot.unitCost} · Source: {donor?.name ?? "Purchased"}
                        </span>
                      </div>
                      {lot.expiryDate ? (
                        <div className="flex flex-col items-end">
                          <StatusBadge domain="expiry" status={expiryStatus(daysLeft!)} label={`${daysLeft}d left`} />
                          <span className="text-[11px] text-muted-foreground">exp {formatDate(lot.expiryDate)}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">No expiry</span>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="history" className="pt-4">
          {txns.length === 0 ? (
            <EmptyState title="No transactions yet" />
          ) : (
            <div className="flex flex-col gap-2">
              {txns.map((t) => (
                <Card key={t.id}>
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                    <div className="flex flex-col">
                      <span className="font-medium capitalize">{t.type} · {t.quantity} {uom?.code}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(t.date)} · {t.performedBy}{t.reason ? ` · ${t.reason}` : ""}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <p className="text-xs text-muted-foreground">As of {TODAY_ISO}</p>
    </div>
  );
}
