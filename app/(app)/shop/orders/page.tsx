"use client";

import * as React from "react";
import { AlertTriangle, Package, PackageCheck, Search, Truck } from "lucide-react";
import { OrderDialog } from "@/components/modules/shop/order-dialog";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { LoadingState } from "@/components/patterns/loading-state";
import { PageHeader } from "@/components/patterns/page-header";
import { SectionCard } from "@/components/patterns/section-card";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import { useShopData, useShopOrders } from "@/lib/hooks/use-shop-collection";
import { formatDate } from "@/lib/utils/date";
import { ORDER_QUEUES, ORDER_STATUS_LABEL, queueOf, type OrderQueue } from "@/lib/utils/shop";
import { formatPesoCents } from "@/lib/utils/vehicle-expenses";

const EMPTY: Record<OrderQueue, string> = {
  todo: "Nothing to pack or send.",
  out: "Nothing is on the way or waiting for pick-up.",
  unpaid: "No order is waiting for payment.",
  done: "No delivered order yet.",
  closed: "No cancelled, lapsed or refunded order.",
};

/**
 * Shop › Orders (0157): every order from the shop site, in the list that says what it needs: to pack and send, on
 * the way, waiting for payment, delivered, closed. Opening an order shows its items and the next step.
 */
export default function ShopOrdersPage() {
  const access = useModuleAccess();
  const canEdit = access.levelOfPath("/shop/orders") === "edit";
  const { orders, items, loading } = useShopOrders();
  const { settings } = useShopData();
  const [queue, setQueue] = React.useState<OrderQueue>("todo");
  const [search, setSearch] = React.useState("");
  const [openId, setOpenId] = React.useState<string | null>(null);

  if (loading) return <LoadingState />;

  const pieces = new Map<string, number>();
  for (const i of items) pieces.set(i.orderId, (pieces.get(i.orderId) ?? 0) + i.qty);
  const count = (q: OrderQueue) => orders.filter((o) => queueOf(o) === q).length;
  const flagged = orders.filter((o) => o.attention);
  const term = search.trim().toLowerCase();
  // A search looks across every list; without one, the chosen list shows, flagged orders first, then oldest first
  // for work to do and newest first for the rest.
  const shown = (term ? orders.filter((o) => [o.number, o.name, o.email, o.phone, o.trackingNumber, o.invoiceNumber].some((v) => v.toLowerCase().includes(term))) : orders.filter((o) => queueOf(o) === queue))
    .slice()
    .sort((a, b) => Number(!!b.attention) - Number(!!a.attention) || (queue === "todo" && !term ? a.placedAt.localeCompare(b.placedAt) : b.placedAt.localeCompare(a.placedAt)));
  const open = orders.find((o) => o.id === openId) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Orders" description="Every order from the shop site, from payment to delivery." />

      <KpiGrid>
        <KpiCard label="To pack" value={orders.filter((o) => o.status === "paid").length} sublabel="Paid and waiting" icon={Package} tone={orders.some((o) => o.status === "paid") ? "warning" : "default"} />
        <KpiCard label="To send or hand over" value={orders.filter((o) => o.status === "packed").length} sublabel="Packed" icon={PackageCheck} />
        <KpiCard label="On the way" value={count("out")} sublabel="With the courier, or ready for pick-up" icon={Truck} />
        <KpiCard label="Needs a look" value={flagged.length} sublabel="Flagged by the system" icon={AlertTriangle} tone={flagged.length ? "warning" : "default"} />
      </KpiGrid>

      <SectionCard flush className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <Tabs value={queue} onValueChange={(v) => setQueue(v as OrderQueue)}>
            <TabsList className="h-auto flex-wrap">
              {ORDER_QUEUES.map((q) => (
                <TabsTrigger key={q.key} value={q.key}>
                  {q.label} <span className="ml-1 text-muted-foreground">{count(q.key)}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input className="pl-9" placeholder="Order, name, phone, tracking" aria-label="Search orders" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        {shown.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Goes to</TableHead>
                <TableHead className="text-right">Pieces</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.slice(0, 200).map((o) => (
                <TableRow key={o.id} className="cursor-pointer" tabIndex={0} onClick={() => setOpenId(o.id)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpenId(o.id))}>
                  <TableCell>
                    <div className="font-medium">{o.number}</div>
                    <div className="text-theme-xs text-muted-foreground">{formatDate(o.placedAt, "MMM d, h:mm a")}</div>
                  </TableCell>
                  <TableCell>
                    <div>{o.name}</div>
                    <div className="text-theme-xs text-muted-foreground">{o.phone}</div>
                  </TableCell>
                  <TableCell>{o.delivery === "pickup" ? "Pick-up" : [o.city, o.area].filter(Boolean).join(", ")}</TableCell>
                  <TableCell className="text-right">{pieces.get(o.id) ?? 0}</TableCell>
                  <TableCell className="text-right">{formatPesoCents(o.total)}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge domain="shop_order" status={o.status} label={ORDER_STATUS_LABEL[o.status]} />
                      {o.attention ? <StatusBadge domain="shop_order" status="flagged" label="Needs a look" /> : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="px-5 pb-5 text-theme-sm text-muted-foreground">{term ? "No order matches that search." : EMPTY[queue]}</p>
        )}
        {shown.length > 200 ? <p className="border-t border-border px-5 py-3 text-theme-xs text-muted-foreground">Showing the first 200 of {shown.length}. Search to find an older order.</p> : null}
      </SectionCard>

      <OrderDialog key={openId ?? "none"} order={open} items={items} couriers={settings.couriers} siteUrl={settings.siteUrl} canEdit={canEdit} onClose={() => setOpenId(null)} />
    </div>
  );
}
