import Link from "next/link";
import { PageHeader } from "@/components/patterns/page-header";
import { StatusBadge } from "@/components/patterns/status-badge";
import { EmptyState } from "@/components/patterns/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { inventoryLots, inventoryItems, unitsOfMeasure } from "@/lib/mock-data";
import { daysUntil } from "@/lib/utils/date";
import { storageLocationPath } from "@/lib/utils/storage-path";

function expiryStatus(daysLeft: number) {
  if (daysLeft < 0) return "expired";
  if (daysLeft <= 14) return "soon14";
  if (daysLeft <= 30) return "soon30";
  return "soon60";
}

export default function ExpiryPage() {
  const withExpiry = inventoryLots
    .filter((l) => l.expiryDate)
    .map((l) => ({ ...l, daysLeft: daysUntil(l.expiryDate!) }))
    .filter((l) => l.daysLeft <= 60)
    .sort((a, b) => a.daysLeft - b.daysLeft); // FEFO — first expired, first out

  const buckets = [
    { label: "Expired / 14 days", items: withExpiry.filter((l) => l.daysLeft <= 14) },
    { label: "15–30 days", items: withExpiry.filter((l) => l.daysLeft > 14 && l.daysLeft <= 30) },
    { label: "31–60 days", items: withExpiry.filter((l) => l.daysLeft > 30 && l.daysLeft <= 60) },
  ];

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Expiry Alerts" description="Sorted first-expired-first-out (FEFO). 463 of 785 donation lines are food with no expiry tracked today." />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {buckets.map((bucket) => (
          <Card key={bucket.label}>
            <CardHeader>
              <CardTitle className="text-sm">{bucket.label}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {bucket.items.length === 0 ? (
                <EmptyState title="Nothing here" className="py-6" />
              ) : (
                bucket.items.map((lot) => {
                  const item = inventoryItems.find((i) => i.id === lot.itemId);
                  const uom = unitsOfMeasure.find((u) => u.id === lot.uomId);
                  return (
                    <Link
                      key={lot.id}
                      href={`/inventory/${lot.itemId}`}
                      className="flex items-center justify-between rounded-md border px-2.5 py-2 text-xs hover:bg-accent"
                    >
                      <div className="flex flex-col">
                        <span className="font-medium">{item?.name}</span>
                        <span className="text-muted-foreground">
                          {lot.quantity} {uom?.code} · {storageLocationPath(lot.storageLocationId)}
                        </span>
                      </div>
                      <StatusBadge domain="expiry" status={expiryStatus(lot.daysLeft)} label={`${lot.daysLeft}d`} />
                    </Link>
                  );
                })
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
