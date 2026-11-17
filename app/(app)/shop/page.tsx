"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Circle, Package, Settings2, ShoppingBag, Store, Tags } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { SectionCard } from "@/components/patterns/section-card";
import { ModuleSubNav, type ModuleSubNavItem } from "@/components/patterns/module-subnav";
import { LoadingState } from "@/components/patterns/loading-state";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useShopData } from "@/lib/hooks/use-shop-collection";
import { isLow, leftToSell, publishProblems } from "@/lib/utils/shop";

const SUB_NAV: ModuleSubNavItem[] = [
  { href: "/shop/products", label: "Products", icon: Package },
  { href: "/shop/settings", label: "Shop settings", icon: Settings2 },
];

/**
 * Shop (0155): what is sold on shop.littlearkfoundation.org. This first part keeps the catalogue: what is on the
 * site, what still stops the shop from opening, and the counted items to reorder. Orders, deliveries and proceeds
 * join it in part 2.
 */
export default function ShopPage() {
  const { products, variants, photos, settings, fees, loading } = useShopData();
  if (loading) return <LoadingState />;

  const onSite = products.filter((p) => !publishProblems(p, variants.filter((v) => v.productId === p.id), photos.filter((f) => f.productId === p.id)).length);
  const onSiteIds = new Set(onSite.map((p) => p.id));
  const counted = new Map(products.filter((p) => p.supply === "stock").map((p) => [p.id, p]));
  const low = variants.filter((v) => counted.has(v.productId) && isLow(v)).sort((a, b) => leftToSell(a) - leftToSell(b));
  const waiting = products.filter((p) => !onSiteIds.has(p.id));
  const noWeight = onSite.filter((p) => p.weightGrams <= 0).length;

  const steps: { done: boolean; text: string; href: string }[] = [
    { done: onSite.length > 0, text: onSite.length ? `${onSite.length} product${onSite.length === 1 ? "" : "s"} on the site` : "Put at least one product on the site", href: "/shop/products" },
    { done: waiting.length === 0, text: waiting.length ? `${waiting.length} product${waiting.length === 1 ? " is" : "s are"} not on the site yet (a draft, hidden, or missing a photo or an item)` : "Every product is on the site", href: "/shop/products" },
    { done: fees.length > 0, text: fees.length ? "Delivery fees are set" : "Set the delivery fees by area and weight", href: "/shop/settings" },
    { done: noWeight === 0, text: noWeight ? `${noWeight} product${noWeight === 1 ? " has" : "s have"} no packed weight, so no delivery fee can be worked out` : "Every product has its packed weight", href: "/shop/products" },
    { done: !settings.pickupEnabled || settings.pickupAddress.trim().length > 0, text: settings.pickupEnabled && !settings.pickupAddress.trim() ? "Give the pick-up address, or switch pick-up off" : "Pick-up is set", href: "/shop/settings" },
    { done: settings.shopOpen, text: settings.shopOpen ? "The shop is open" : "Open the shop when everything above is ready", href: "/shop/settings" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Shop" description="What is sold on shop.littlearkfoundation.org: the products, their stock and the delivery fees." action={<ModuleSubNav items={SUB_NAV} />} />

      <KpiGrid>
        <KpiCard label="Products on the site" value={onSite.length} sublabel={`of ${products.length} in the catalogue`} icon={ShoppingBag} />
        <KpiCard label="Items on sale" value={variants.filter((v) => v.active && onSiteIds.has(v.productId)).length} sublabel="One per colour and size" icon={Tags} />
        <KpiCard label="Low or out of stock" value={low.length} sublabel="Counted items at their reorder point" icon={AlertTriangle} tone={low.length ? "warning" : "default"} />
        <KpiCard label="The shop" value={settings.shopOpen ? "Open" : "Closed"} sublabel={settings.shopOpen ? "Taking orders" : "Products show; no orders are taken"} icon={Store} />
      </KpiGrid>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Before the shop opens" description="Each line leads to the page where it is done.">
          <ul className="flex flex-col gap-1 px-5 pb-5">
            {steps.map((s) => (
              <li key={s.text}>
                <Link href={s.href} className="flex items-start gap-3 rounded-lg px-2 py-2 text-theme-sm hover:bg-muted">
                  {s.done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-label="Done" /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="To do" />}
                  <span className={s.done ? "text-muted-foreground" : "font-medium text-foreground"}>{s.text}</span>
                </Link>
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard flush className="overflow-hidden" title="Stock to reorder" description="Counted items at or under their reorder point, emptiest first.">
          {low.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Left</TableHead>
                  <TableHead className="text-right">Reorder at</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {low.slice(0, 12).map((v) => (
                  <TableRow key={v.id}>
                    <TableCell>
                      <div className="font-medium">{counted.get(v.productId)?.name}</div>
                      <div className="text-theme-xs text-muted-foreground">{[v.colour, v.size].filter(Boolean).join(", ") || v.sku}</div>
                    </TableCell>
                    <TableCell className="text-right">{leftToSell(v) === 0 ? <Badge variant="destructive">Out</Badge> : leftToSell(v)}</TableCell>
                    <TableCell className="text-right">{v.reorderAt}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="px-5 pb-5 text-theme-sm text-muted-foreground">Nothing to reorder.</p>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
