"use client";

import * as React from "react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useLotsOnHand, useStorageLocations } from "@/lib/hooks/use-inventory-views";
import type { LotOnHandRow, StorageLocationRow } from "@/lib/types/inventory-views";

function Bin({ bin, lots }: { bin: StorageLocationRow; lots: LotOnHandRow[] }) {
  return (
    <div className="flex items-start justify-between gap-3 text-xs">
      <span className="text-muted-foreground">
        {bin.name}
        {bin.code ? <span className="ml-1 font-mono text-[10px]">({bin.code})</span> : null}
      </span>
      <div className="flex flex-wrap justify-end gap-1">
        {lots.length === 0 ? (
          <span className="text-muted-foreground">Empty</span>
        ) : (
          lots.map((lot) => (
            <Badge key={lot.lot_id} variant="secondary" className="text-[10px]">
              {lot.name} · {lot.qty_remaining} {lot.uom}
            </Badge>
          ))
        )}
      </div>
    </div>
  );
}

export default function LocationsPage() {
  const { rows: locations, loading, error } = useStorageLocations();
  const { rows: lots } = useLotsOnHand();

  const childrenOf = React.useMemo(() => {
    const map = new Map<string | null, StorageLocationRow[]>();
    for (const l of locations) {
      const list = map.get(l.parent_id) ?? [];
      list.push(l);
      map.set(l.parent_id, list);
    }
    return (parentId: string | null) => map.get(parentId) ?? [];
  }, [locations]);

  const lotsAt = React.useMemo(() => {
    const map = new Map<string, LotOnHandRow[]>();
    for (const lot of lots) {
      const list = map.get(lot.storage_location_id) ?? [];
      list.push(lot);
      map.set(lot.storage_location_id, list);
    }
    return (binId: string) => map.get(binId) ?? [];
  }, [lots]);

  const sites = childrenOf(null);

  // The real hierarchy is Site › Room › Unit › Bin, but not every branch has
  // all four levels -- render whatever is under each node and treat a `bin`
  // (or any leaf) as the shelf that holds lots.
  function renderNode(node: StorageLocationRow): React.ReactNode {
    const kids = childrenOf(node.id);
    if (node.level === "bin" || kids.length === 0) return <Bin key={node.id} bin={node} lots={lotsAt(node.id)} />;
    return (
      <div key={node.id} className="flex flex-col gap-1">
        <span className="text-sm font-medium">{node.name}</span>
        <div className="ml-3 flex flex-col gap-1.5 border-l pl-3">{kids.map(renderNode)}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Storage Locations"
        description="Site › Room › Unit › Bin, live from the LAF Inventory app. Every lot lives at a specific bin, and bins carry the QR code that's scanned there."
      />

      {error ? (
        <EmptyState title="Couldn't load locations" description={error} />
      ) : loading ? (
        <EmptyState title="Loading locations…" />
      ) : sites.length === 0 ? (
        <EmptyState title="No storage locations yet" description="Add them in the LAF Inventory app under Locations." />
      ) : (
        <Accordion type="multiple" defaultValue={sites.map((s) => s.id)} className="flex flex-col gap-2">
          {sites.map((site) => (
            <AccordionItem key={site.id} value={site.id} className="rounded-md border px-3">
              <AccordionTrigger>{site.name}</AccordionTrigger>
              <AccordionContent>
                <div className="ml-1 flex flex-col gap-3 pb-2">{childrenOf(site.id).map(renderNode)}</div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}
    </div>
  );
}
