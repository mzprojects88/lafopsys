"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Package, AlertTriangle, XCircle, Snowflake, ScanLine, MapPin, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { StatusBadge } from "@/components/patterns/status-badge";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { ModuleSubNav, type ModuleSubNavItem } from "@/components/patterns/module-subnav";
import { Button } from "@/components/ui/button";
import { inventoryItems, inventoryLots, unitsOfMeasure } from "@/lib/mock-data";
import type { InventoryItem } from "@/lib/types/inventory";

const SUB_NAV: ModuleSubNavItem[] = [
  { href: "/inventory/locations", label: "Locations", icon: MapPin, color: "teal" },
  { href: "/inventory/expiry", label: "Expiry Alerts", icon: AlertTriangle, color: "amber" },
  { href: "/inventory/waste", label: "Waste Log", icon: Trash2, color: "red" },
];

function stockOnHand(itemId: string) {
  return inventoryLots.filter((l) => l.itemId === itemId).reduce((sum, l) => sum + l.quantity, 0);
}

function stockStatus(item: InventoryItem) {
  const onHand = stockOnHand(item.id);
  if (onHand === 0) return "out";
  if (onHand <= item.reorderPoint) return "reorder";
  if (onHand <= item.reorderPoint * 1.5) return "low";
  return "ok";
}

const columns: ColumnDef<InventoryItem>[] = [
  { accessorKey: "name", header: "Item" },
  { accessorKey: "category", header: "Category" },
  {
    id: "stock",
    header: "On Hand",
    cell: ({ row }) => {
      const uom = unitsOfMeasure.find((u) => u.id === row.original.defaultUomId);
      return `${stockOnHand(row.original.id)} ${uom?.code ?? ""}`;
    },
  },
  { accessorKey: "perishable", header: "Perishable", cell: ({ row }) => (row.original.perishable ? "Yes" : "No") },
  {
    id: "status",
    header: "Stock Status",
    cell: ({ row }) => <StatusBadge domain="stock" status={stockStatus(row.original)} />,
  },
];

export default function InventoryPage() {
  const router = useRouter();
  const lowStockCount = inventoryItems.filter((i) => {
    const status = stockStatus(i);
    return status === "low" || status === "reorder";
  }).length;
  const outOfStockCount = inventoryItems.filter((i) => stockStatus(i) === "out").length;
  const perishableCount = inventoryItems.filter((i) => i.perishable).length;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Inventory"
        description="Scan a barcode and know everything about the item: replenish, expiry, and cabinet location."
        action={
          <>
            <Button asChild><Link href="/inventory/scan"><ScanLine />Simulate Scan</Link></Button>
            <ModuleSubNav items={SUB_NAV} />
          </>
        }
      />

      <KpiGrid>
        <KpiCard label="Total Items" value={inventoryItems.length} icon={Package} color="teal" />
        <KpiCard label="Low Stock" value={lowStockCount} icon={AlertTriangle} color="amber" />
        <KpiCard label="Out of Stock" value={outOfStockCount} icon={XCircle} color="red" />
        <KpiCard label="Perishable Items" value={perishableCount} icon={Snowflake} color="cyan" />
      </KpiGrid>

      <DataTable
        columns={columns}
        data={inventoryItems}
        searchPlaceholder="Search items…"
        onRowClick={(item) => router.push(`/inventory/${item.id}`)}
      />
    </div>
  );
}
