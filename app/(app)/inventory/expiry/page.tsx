"use client";

import Link from "next/link";
import { PageHeader } from "@/components/patterns/page-header";
import { StatusBadge } from "@/components/patterns/status-badge";
import { EmptyState } from "@/components/patterns/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useExpiringLots, useStorageLocations } from "@/lib/hooks/use-inventory-views";
import { formatCurrency } from "@/lib/utils/currency";
import { expiryStatus } from "@/lib/utils/inventory-status";

export default function ExpiryPage() {
  const { rows, loading, error } = useExpiringLots();
  const { rows: locations } = useStorageLocations();
  const pathById = new Map(locations.map((l) => [l.id, l.path]));

  // v_expiring is already the 60-day window, sorted first-expired-first-out.
  const sorted = [...rows].sort((a, b) => a.days_left - b.days_left);
  const buckets = [
    { label: "Expired / 14 days", items: sorted.filter((l) => l.days_left <= 14) },
    { label: "15–30 days", items: sorted.filter((l) => l.days_left > 14 && l.days_left <= 30) },
    { label: "31–60 days", items: sorted.filter((l) => l.days_left > 30) },
  ];
  const valueAtRisk = rows.reduce((s, l) => s + l.value_at_risk, 0);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Expiry Alerts"
        description={
          loading ? "Loading…" : `${rows.length} lot${rows.length === 1 ? "" : "s"} expiring within 60 days · ${formatCurrency(valueAtRisk)} at risk. Sorted first-expired-first-out.`
        }
      />

      {error ? (
        <EmptyState title="Couldn't load expiry data" description={error} />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {buckets.map((bucket) => (
            <Card key={bucket.label}>
              <CardHeader>
                <CardTitle className="text-sm">{bucket.label}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {bucket.items.length === 0 ? (
                  <EmptyState title={loading ? "Loading…" : "Nothing here"} className="py-6" />
                ) : (
                  bucket.items.map((lot) => (
                    <Link
                      key={lot.lot_id}
                      href={`/inventory/${lot.item_id}`}
                      className="flex items-center justify-between rounded-md border px-2.5 py-2 text-xs hover:bg-accent"
                    >
                      <div className="flex flex-col">
                        <span className="font-medium">{lot.name}</span>
                        <span className="text-muted-foreground">
                          {lot.qty_remaining} · {pathById.get(lot.storage_location_id) ?? lot.storage_location_id} · {formatCurrency(lot.value_at_risk)}
                        </span>
                      </div>
                      <StatusBadge domain="expiry" status={expiryStatus(lot.days_left)} label={lot.days_left < 0 ? "expired" : `${lot.days_left}d`} />
                    </Link>
                  ))
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
