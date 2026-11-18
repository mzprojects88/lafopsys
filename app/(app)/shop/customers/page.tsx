"use client";

import * as React from "react";
import { Search, ShoppingBag, UserCheck, UserPlus, Users } from "lucide-react";
import { CustomerDialog } from "@/components/modules/shop/customer-dialog";
import { OrderDialog } from "@/components/modules/shop/order-dialog";
import { ClearFilters, FilterSelect, useFilters } from "@/components/patterns/filters";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { LoadingState } from "@/components/patterns/loading-state";
import { PageHeader } from "@/components/patterns/page-header";
import { PeriodPresetsBar, usePeriodPresets } from "@/components/patterns/period-presets";
import { SectionCard } from "@/components/patterns/section-card";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import { useShopCustomers, useShopData, useShopOrders } from "@/lib/hooks/use-shop-collection";
import { formatDate } from "@/lib/utils/date";
import { CUSTOMER_STATE_LABEL, CUSTOMER_VIEWS, DELIVERY_AREAS, ORDER_STATUS_LABEL, customerMatches, customerRows, customerViewDate, customersIn, manilaDay, type CustomerRow, type CustomerView } from "@/lib/utils/shop";
import { formatPesoCents } from "@/lib/utils/vehicle-expenses";

const EMPTY: Record<CustomerView, string> = {
  with_orders: "Nobody has ordered in this period.",
  new: "No account was created in this period.",
  donors: "Nobody has given from their account in this period.",
  all: "No customer yet.",
};
const DATE_HEAD: Record<CustomerView, string> = { with_orders: "Last order", new: "Last order", donors: "Last gift", all: "Last order" };
const STATES = (["active", "guest", "blocked", "closed"] as const).map((s) => ({ value: s, label: CUSTOMER_STATE_LABEL[s] }));
const day = (iso: string | null) => (iso ? formatDate(iso, "MMM d, yyyy") : "");

/**
 * Shop › Customers (0160): everyone who has an account on the shop site or has bought from it. A customer is never
 * an ArkOS account and cannot sign in here; this page is where their accounts are looked after. It opens on the
 * people who have ordered, latest order first; the other lists are the newest accounts and the latest donors
 * (customers who gave from their account, 0161: each such gift is also in Donors with its receipt).
 * ponytail: the list is put together in the browser from the orders and accounts already loaded; move it to a
 * database view with paging once there are a few thousand orders.
 */
export default function ShopCustomersPage() {
  const access = useModuleAccess();
  const canEdit = access.levelOfPath("/shop/customers") === "edit";
  const { customers, gifts, loading } = useShopCustomers();
  const { orders, items, loading: ordersLoading } = useShopOrders();
  const { settings } = useShopData();
  const period = usePeriodPresets("shop-customers", "all", true);
  const f = useFilters("state", "area", "gave");
  const [view, setView] = React.useState<CustomerView>("with_orders");
  const [search, setSearch] = React.useState("");
  const [openKey, setOpenKey] = React.useState<string | null>(null);
  const [openOrder, setOpenOrder] = React.useState<string | null>(null);

  if (loading || ordersLoading) return <LoadingState />;

  const rows = customerRows(customers, orders, gifts);
  const inPeriod = (iso: string | null) => !period.window || (!!iso && manilaDay(iso) >= period.window.from && manilaDay(iso) <= period.window.to);
  const passes = (r: CustomerRow, v: CustomerView) => inPeriod(customerViewDate(r, v)) && f.ok("state", r.state) && f.ok("area", r.area) && f.ok("gave", r.gifts > 0 ? "yes" : "no");
  const count = (v: CustomerView) => customersIn(rows, v).filter((r) => passes(r, v)).length;
  const term = search.trim();
  // A search looks across everyone; without one, the chosen list shows.
  const shown = (term ? customersIn(rows, "all").filter((r) => customerMatches(r, term)) : customersIn(rows, view).filter((r) => passes(r, view)));
  const open = rows.find((r) => r.key === openKey) ?? null;
  const order = orders.find((o) => o.id === openOrder) ?? null;
  // Whole Manila days between a moment and today (the period bar already knows today).
  const recent = (iso: string | null, days: number) => !!iso && (Date.parse(`${period.today}T00:00:00Z`) - Date.parse(`${manilaDay(iso)}T00:00:00Z`)) / 86_400_000 < days;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Customers" description="Everyone with an account on the shop site, and everyone who has bought from it. A customer cannot sign in to ArkOS." />

      <KpiGrid>
        <KpiCard label="Customers who ordered" value={rows.filter((r) => r.orders > 0).length} sublabel="With or without an account" icon={ShoppingBag} />
        <KpiCard label="Accounts" value={rows.filter((r) => r.state === "active" || r.state === "blocked").length} sublabel={`${rows.filter((r) => r.state === "blocked").length} blocked`} icon={Users} />
        <KpiCard label="New accounts" value={rows.filter((r) => r.customerId && r.state !== "closed" && recent(r.createdAt, 30)).length} sublabel="In the last 30 days" icon={UserPlus} />
        <KpiCard label="Signed in" value={rows.filter((r) => r.state === "active" && recent(r.lastSignInAt, 7)).length} sublabel="In the last 7 days" icon={UserCheck} />
      </KpiGrid>

      <PeriodPresetsBar state={period.state} onChange={period.setState} today={period.today} allowAll />
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect all="Every kind" value={f.values.state} onChange={f.set("state")} options={STATES} className="w-36" />
        <FilterSelect all="Every area" value={f.values.area} onChange={f.set("area")} options={DELIVERY_AREAS.map((a) => ({ value: a, label: a }))} className="w-40" />
        <FilterSelect all="Gave or not" value={f.values.gave} onChange={f.set("gave")} options={[{ value: "yes", label: "Has given" }, { value: "no", label: "Has not given" }]} className="w-40" />
        <ClearFilters active={f.active} onClear={f.clear} />
      </div>

      <SectionCard flush className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <Tabs value={view} onValueChange={(v) => setView(v as CustomerView)}>
            <TabsList className="h-auto flex-wrap">
              {CUSTOMER_VIEWS.map((v) => (
                <TabsTrigger key={v.key} value={v.key}>
                  {v.label} <span className="ml-1 text-muted-foreground">{count(v.key)}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input className="pl-9" placeholder="Name, email, mobile or order number" aria-label="Search customers" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        {shown.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>{view === "new" && !term ? "Created" : "Since"}</TableHead>
                <TableHead>Last signed in</TableHead>
                <TableHead className="text-right">Orders</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead>{term ? "Last order" : DATE_HEAD[view]}</TableHead>
                <TableHead className="text-right">Gifts</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.slice(0, 200).map((r) => (
                <TableRow key={r.key} className="cursor-pointer" tabIndex={0} onClick={() => setOpenKey(r.key)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpenKey(r.key))}>
                  <TableCell>
                    <div className="font-medium">{r.state === "closed" ? "Closed account" : r.name || "No name given yet"}</div>
                    <div className="text-theme-xs break-all text-muted-foreground">{r.email}</div>
                  </TableCell>
                  <TableCell><StatusBadge domain="shop_customer" status={r.state} label={CUSTOMER_STATE_LABEL[r.state]} /></TableCell>
                  <TableCell>{day(r.createdAt)}</TableCell>
                  <TableCell>{r.customerId ? day(r.lastSignInAt) || "Never" : <span className="text-muted-foreground">No account</span>}</TableCell>
                  <TableCell className="text-right">{r.orders}</TableCell>
                  <TableCell className="text-right">{formatPesoCents(r.spent)}</TableCell>
                  <TableCell>
                    {view === "donors" && !term ? (
                      day(r.lastGiftAt)
                    ) : r.lastOrderAt && r.lastOrderStatus ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span>{day(r.lastOrderAt)}</span>
                        <StatusBadge domain="shop_order" status={r.lastOrderStatus} label={ORDER_STATUS_LABEL[r.lastOrderStatus]} />
                      </div>
                    ) : (
                      <span className="text-muted-foreground">None</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">{r.gifts ? `${r.gifts} · ${formatPesoCents(r.given)}` : <span className="text-muted-foreground">None</span>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="px-5 pb-5 text-theme-sm text-muted-foreground">{term ? "No customer matches that search." : EMPTY[view]}</p>
        )}
        {shown.length > 200 ? <p className="border-t border-border px-5 py-3 text-theme-xs text-muted-foreground">Showing the first 200 of {shown.length}. Search or narrow the period to find the rest.</p> : null}
      </SectionCard>

      <CustomerDialog
        key={openKey ?? "none"}
        row={openOrder ? null : open}
        customer={open?.customerId ? (customers.find((c) => c.id === open.customerId) ?? null) : null}
        orders={orders}
        gifts={gifts}
        canEdit={canEdit}
        onOpenOrder={setOpenOrder}
        onClose={() => setOpenKey(null)}
      />
      {/* An order opened from a customer: closing it returns to that customer. */}
      <OrderDialog key={openOrder ?? "no-order"} order={order} items={items} couriers={settings.couriers} siteUrl={settings.siteUrl} canEdit={access.levelOfPath("/shop/orders") === "edit"} onClose={() => setOpenOrder(null)} />
    </div>
  );
}
