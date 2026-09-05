"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { Package, Archive, AlertTriangle, XCircle, Wallet, ExternalLink, MapPin, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { StatusBadge } from "@/components/patterns/status-badge";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { EmptyState } from "@/components/patterns/empty-state";
import { ModuleSubNav, type ModuleSubNavItem } from "@/components/patterns/module-subnav";
import { Button } from "@/components/ui/button";
import { useStockSummary } from "@/lib/hooks/use-inventory-views";
import type { StockSummaryRow } from "@/lib/types/inventory-views";
import { formatCurrency } from "@/lib/utils/currency";
import { inventoryAppHref } from "@/lib/utils/inventory-app";

const SUB_NAV: ModuleSubNavItem[] = [
  { href: "/inventory/assets", label: "Fixed Assets", icon: Archive, color: "indigo" },
  { href: "/inventory/locations", label: "Locations", icon: MapPin, color: "teal" },
  { href: "/inventory/expiry", label: "Expiry Alerts", icon: AlertTriangle, color: "amber" },
  { href: "/inventory/waste", label: "Waste Log", icon: Trash2, color: "red" },
];

/** v_stock_summary is one row per item per House; HQ sees the org, so fold
 * Houses together per item. Status is the worst across Houses. */
interface ItemRow {
  item_id: string;
  name: string;
  category: string;
  uom: string;
  on_hand_qty: number;
  stock_value: number;
  reorder_point: number;
  status: StockSummaryRow["status"];
}

const STATUS_RANK = { out: 0, low: 1, ok: 2 } as const;

function foldByItem(rows: StockSummaryRow[]): ItemRow[] {
  const byItem = new Map<string, ItemRow>();
  for (const r of rows) {
    const cur = byItem.get(r.item_id);
    if (!cur) {
      byItem.set(r.item_id, { ...r });
      continue;
    }
    cur.on_hand_qty += r.on_hand_qty;
    cur.stock_value += r.stock_value;
    if (STATUS_RANK[r.status] < STATUS_RANK[cur.status]) cur.status = r.status;
  }
  return [...byItem.values()];
}

const columns: ColumnDef<ItemRow>[] = [
  { accessorKey: "name", header: "Item" },
  { accessorKey: "category", header: "Category", cell: ({ row }) => <span className="capitalize">{row.original.category.toLowerCase()}</span> },
  { id: "stock", header: "On Hand", cell: ({ row }) => `${row.original.on_hand_qty} ${row.original.uom}` },
  { id: "value", header: "Stock Value", cell: ({ row }) => formatCurrency(row.original.stock_value) },
  { id: "status", header: "Stock Status", cell: ({ row }) => <StatusBadge domain="stock" status={row.original.status} /> },
];

export default function InventoryPage() {
  const router = useRouter();
  const { rows, loading, error } = useStockSummary();
  const items = React.useMemo(() => foldByItem(rows), [rows]);

  const lowStock = items.filter((i) => i.status === "low").length;
  const outOfStock = items.filter((i) => i.status === "out").length;
  const totalValue = items.reduce((s, i) => s + i.stock_value, 0);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Inventory"
        description="Live from the LAF Inventory app's published views. Receiving, drawing, counts and waste are recorded there."
        action={
          <>
            <Button asChild>
              <a href={inventoryAppHref("/")} target="_blank" rel="noreferrer">
                <ExternalLink />
                Open LAF Inventory
              </a>
            </Button>
            <ModuleSubNav items={SUB_NAV} />
          </>
        }
      />

      <KpiGrid>
        <KpiCard label="Items in Stock" value={loading ? "…" : items.length} icon={Package} color="teal" />
        <KpiCard label="Low Stock" value={loading ? "…" : lowStock} icon={AlertTriangle} color="amber" sublabel="At or below reorder point" />
        <KpiCard label="Out of Stock" value={loading ? "…" : outOfStock} icon={XCircle} color="red" />
        <KpiCard label="Stock Value" value={loading ? "…" : formatCurrency(totalValue)} icon={Wallet} color="green" />
      </KpiGrid>

      {error ? (
        <EmptyState title="Couldn't load inventory" description={error} />
      ) : (
        <DataTable
          columns={columns}
          data={items}
          searchPlaceholder="Search items…"
          emptyMessage={loading ? "Loading inventory…" : "No items with stock on hand."}
          onRowClick={(item) => router.push(`/inventory/${item.item_id}`)}
        />
      )}
    </div>
  );
}
