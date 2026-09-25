"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, ScanLine, Search } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { IconCircle } from "@/components/patterns/icon-circle";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useStockSummary } from "@/lib/hooks/use-inventory-views";
import { inventoryAppHref } from "@/lib/utils/inventory-app";

/** Real scanning (camera, barcode lookup, receive/draw at the shelf) lives in
 * the LAF Inventory app -- this page used to be a demo "scan simulator" over
 * fabricated items. It now hands the person to the real scanner and offers a
 * name search over live stock for anyone at a desk. */
export default function ScanPage() {
  const router = useRouter();
  const { rows, loading } = useStockSummary();
  const [query, setQuery] = React.useState("");
  const deferred = React.useDeferredValue(query);
  const matches = React.useMemo(() => {
    const q = deferred.trim().toLowerCase();
    if (!q) return [];
    const seen = new Set<string>();
    return rows.filter((r) => r.name.toLowerCase().includes(q) && !seen.has(r.item_id) && seen.add(r.item_id)).slice(0, 8);
  }, [rows, deferred]);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Find an Item" description="Scan at the shelf with the LAF Inventory app, or look an item up by name here." />

      <Card>
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <IconCircle icon={ScanLine} size="lg" />
            <div>
              <p className="text-theme-sm font-medium text-foreground">Scan a barcode or bin QR</p>
              <p className="text-theme-xs text-muted-foreground">Opens the camera scanner in the LAF Inventory app.</p>
            </div>
          </div>
          <Button asChild>
            <a href={inventoryAppHref("/scan")} target="_blank" rel="noreferrer">
              <ExternalLink />
              Open scanner
            </a>
          </Button>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search items by name"
            placeholder={loading ? "Loading inventory…" : "Type an item name…"}
            className="pl-10"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {matches.length > 0 ? (
          <div className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {matches.map((m) => (
              <button
                key={m.item_id}
                type="button"
                onClick={() => router.push(`/inventory/${m.item_id}`)}
                className="flex items-center justify-between gap-3 px-5 py-3 text-left text-theme-sm hover:bg-muted/60"
              >
                <span className="font-medium">{m.name}</span>
                <span className="text-theme-xs tabular-nums text-muted-foreground">
                  {m.on_hand_qty} {m.uom}
                </span>
              </button>
            ))}
          </div>
        ) : null}
        {deferred.trim() && matches.length === 0 && !loading ? <p className="text-theme-xs text-muted-foreground">No item named “{deferred}”.</p> : null}
      </div>
    </div>
  );
}
