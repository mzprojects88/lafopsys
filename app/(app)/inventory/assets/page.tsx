"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Archive, ExternalLink, PackageX, ShieldCheck, Wallet } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { StatusBadge } from "@/components/patterns/status-badge";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAssetDisposals, useFixedAssets } from "@/lib/hooks/use-inventory-views";
import type { AssetDisposalRow, FixedAssetRow } from "@/lib/types/inventory-views";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/date";
import { inventoryAppHref } from "@/lib/utils/inventory-app";

/**
 * The fixed-asset register, read from laf-inventory's published views. Assets
 * were the one part of the inventory app HQ could not see at all, even though
 * acquisition value and disposal proceeds are exactly the figures finance and
 * the board need. Read-only, like every other inventory view here -- assets
 * are registered and disposed of in the LAF Inventory app itself.
 */
export default function FixedAssetsPage() {
  const { rows: assets, loading, error } = useFixedAssets();
  const { rows: disposals, loading: disposalsLoading, error: disposalsError } = useAssetDisposals();

  // value_on_books is already 0 for a disposed asset, so this is what the
  // foundation still owns without re-deriving the rule.
  const registerValue = assets.reduce((sum, a) => sum + a.value_on_books, 0);
  const owned = assets.filter((a) => !a.disposed_at).length;
  const proceeds = disposals.reduce((sum, d) => sum + d.proceeds, 0);
  const awaitingSignOff = disposals.filter((d) => !d.signed_off).length;

  const assetColumns: ColumnDef<FixedAssetRow>[] = [
    { accessorKey: "name", header: "Asset" },
    { accessorKey: "category", header: "Category" },
    {
      id: "condition",
      header: "Condition",
      accessorFn: (a) => a.condition,
      cell: ({ row }) =>
        row.original.disposed_at ? (
          <StatusBadge domain="asset" status="disposed" label="Disposed" />
        ) : (
          <StatusBadge domain="asset" status={row.original.condition} />
        ),
    },
    { id: "location", header: "Location", accessorFn: (a) => a.location_path ?? "—" },
    { id: "acquired", header: "Acquired", accessorFn: (a) => a.acquired_date, cell: ({ row }) => formatDate(row.original.acquired_date) },
    {
      id: "value",
      header: "Value",
      accessorFn: (a) => a.acquired_value,
      cell: ({ row }) => (
        <span className={row.original.disposed_at ? "text-muted-foreground line-through" : undefined}>
          {formatCurrency(row.original.acquired_value)}
        </span>
      ),
    },
  ];

  const disposalColumns: ColumnDef<AssetDisposalRow>[] = [
    { accessorKey: "date", header: "Date", cell: ({ row }) => formatDate(row.original.date) },
    { accessorKey: "name", header: "Asset" },
    { accessorKey: "reason", header: "Reason" },
    { id: "acquired_value", header: "Acquired for", accessorFn: (d) => d.acquired_value, cell: ({ row }) => formatCurrency(row.original.acquired_value) },
    { id: "proceeds", header: "Proceeds", accessorFn: (d) => d.proceeds, cell: ({ row }) => formatCurrency(row.original.proceeds) },
    {
      id: "sign_off",
      header: "Sign-off",
      accessorFn: (d) => (d.signed_off ? "Signed off" : "Awaiting"),
      cell: ({ row }) =>
        row.original.signed_off ? (
          <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
            <ShieldCheck className="size-3.5" />
            {row.original.sign_off_1} &amp; {row.original.sign_off_2}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Awaiting second signature</span>
        ),
    },
  ];

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Fixed Assets"
        description="Equipment and furnishings on the foundation's register, with what has been disposed of and what came back for it."
        action={
          <Button asChild variant="outline">
            <a href={inventoryAppHref("/fixed-assets")} target="_blank" rel="noreferrer">
              <ExternalLink />
              Open LAF Inventory
            </a>
          </Button>
        }
      />

      <KpiGrid>
        <KpiCard label="Register Value" value={loading ? "…" : formatCurrency(registerValue)} sublabel="Assets still owned" icon={Wallet} color="green" />
        <KpiCard label="Assets Owned" value={loading ? "…" : owned} icon={Archive} color="indigo" />
        <KpiCard label="Disposed" value={disposalsLoading ? "…" : disposals.length} sublabel={awaitingSignOff > 0 ? `${awaitingSignOff} awaiting sign-off` : "All signed off"} icon={PackageX} color="slate" />
        <KpiCard label="Disposal Proceeds" value={disposalsLoading ? "…" : formatCurrency(proceeds)} icon={Wallet} color="amber" />
      </KpiGrid>

      {error ? (
        <EmptyState title="Couldn't load the asset register" description={error} />
      ) : (
        <DataTable
          columns={assetColumns}
          data={assets}
          searchPlaceholder="Search assets…"
          emptyMessage={loading ? "Loading…" : "No fixed assets registered yet."}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Disposals</CardTitle>
        </CardHeader>
        <CardContent>
          {disposalsError ? (
            <EmptyState title="Couldn't load disposals" description={disposalsError} className="py-6" />
          ) : (
            <DataTable
              columns={disposalColumns}
              data={disposals}
              searchPlaceholder="Search disposals…"
              emptyMessage={disposalsLoading ? "Loading…" : "Nothing has been disposed of yet."}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
