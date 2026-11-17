"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Package, Plus } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { LoadingState } from "@/components/patterns/loading-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProductDialog } from "@/components/modules/shop/product-dialog";
import { shopPhotoUrl, useShopData } from "@/lib/hooks/use-shop-collection";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import { STATUS_LABEL, isLow, leftToSell, priceRange, publishProblems, type ShopPhoto, type ShopProduct, type ShopVariant } from "@/lib/utils/shop";

type Row = { product: ShopProduct; items: ShopVariant[]; photo: ShopPhoto | null; problems: string[]; search: string };

/**
 * Shop › Products (0155): everything the shop sells. A row opens the product: its details, its items (one colour
 * and size each, with price and count) and its photos. Shop editors change them; Shop viewers read.
 */
export default function ShopProductsPage() {
  const access = useModuleAccess();
  const canEdit = access.levelOfPath("/shop/products") === "edit";
  const { products, variants, photos, loading } = useShopData();
  const [open, setOpen] = React.useState<{ id: string | null } | null>(null);

  const rows = React.useMemo<Row[]>(
    () =>
      products.map((product) => {
        const items = variants.filter((v) => v.productId === product.id);
        const mine = photos.filter((f) => f.productId === product.id);
        return { product, items, photo: mine[0] ?? null, problems: publishProblems(product, items, mine), search: [product.name, product.category, product.collection, ...items.map((v) => v.sku)].join(" ") };
      }),
    [products, variants, photos],
  );

  const columns: ColumnDef<Row>[] = [
    {
      id: "product",
      accessorFn: (r) => r.search,
      header: "Product",
      cell: ({ row }) => {
        const { product, photo } = row.original;
        return (
          <div className="flex items-center gap-3">
            {photo ? (
              <img src={shopPhotoUrl(photo.path)} alt="" className="size-11 shrink-0 rounded-lg border border-border bg-white object-contain" />
            ) : (
              <span className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground"><Package className="size-4" /></span>
            )}
            <div className="min-w-0">
              <div className="truncate font-medium text-foreground">{product.name}</div>
              <div className="text-theme-xs text-muted-foreground">{product.collection ? `${product.collection} collection` : "No collection"}</div>
            </div>
          </div>
        );
      },
    },
    { id: "category", accessorFn: (r) => r.product.category, header: "Category" },
    { id: "items", accessorFn: (r) => r.items.filter((v) => v.active).length, header: "Items on sale" },
    { id: "price", accessorFn: (r) => Math.min(...r.items.filter((v) => v.active).map((v) => v.price), Number.MAX_SAFE_INTEGER), header: "Price", cell: ({ row }) => priceRange(row.original.items) },
    {
      id: "stock",
      accessorFn: (r) => (r.product.supply === "made" ? -1 : r.items.reduce((s, v) => s + leftToSell(v), 0)),
      header: "Stock",
      cell: ({ row }) => {
        const { product, items } = row.original;
        if (product.supply === "made") return <Badge variant="secondary">Made to order</Badge>;
        const left = items.reduce((s, v) => s + leftToSell(v), 0);
        const lowCount = items.filter(isLow).length;
        return (
          <span className="inline-flex items-center gap-2">
            {left} left
            {lowCount ? <Badge variant="destructive">{lowCount} low</Badge> : null}
          </span>
        );
      },
    },
    {
      id: "status",
      accessorFn: (r) => r.product.status,
      header: "On the site",
      cell: ({ row }) => {
        const { product, problems } = row.original;
        if (!problems.length) return <Badge>On the site</Badge>;
        return (
          <span className="flex flex-col gap-0.5">
            <Badge variant={product.status === "published" ? "destructive" : "outline"}>{product.status === "published" ? "Not showing" : STATUS_LABEL[product.status]}</Badge>
            {product.status === "published" ? <span className="text-theme-xs text-muted-foreground">{problems.join(", ")}</span> : null}
          </span>
        );
      },
    },
  ];

  if (loading) return <LoadingState />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Products"
        description="What the shop sells: photos, prices, colours and sizes, stock, and whether each shows on the site."
        action={canEdit ? <Button onClick={() => setOpen({ id: null })}><Plus className="size-4" />Add product</Button> : undefined}
      />

      {rows.length ? (
        <DataTable columns={columns} data={rows} searchPlaceholder="Search products and item codes…" onRowClick={(r) => setOpen({ id: r.product.id })} emptyMessage="No product matches." />
      ) : (
        <EmptyState icon={Package} title="No products yet" description={canEdit ? "Add the first product: its details, then its items and photos." : "Products appear here once Shop staff add them."} action={canEdit ? <Button onClick={() => setOpen({ id: null })}>Add product</Button> : undefined} />
      )}

      {open ? <ProductDialog key={open.id ?? "new"} productId={open.id} canEdit={canEdit} onClose={() => setOpen(null)} onCreated={(id) => setOpen({ id })} /> : null}
    </div>
  );
}
