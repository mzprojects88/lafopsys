"use client";

import * as React from "react";
import Link from "next/link";
import { Banknote, Download, HandCoins, Receipt, ShoppingBag, Wallet } from "lucide-react";
import { toast } from "sonner";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { LoadingState } from "@/components/patterns/loading-state";
import { PageHeader } from "@/components/patterns/page-header";
import { PeriodPresetsBar, usePeriodPresets } from "@/components/patterns/period-presets";
import { SectionCard } from "@/components/patterns/section-card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import { useShopData, useShopOrders } from "@/lib/hooks/use-shop-collection";
import { csvLines, downloadCsv } from "@/lib/utils/csv";
import { formatDate } from "@/lib/utils/date";
import { earned, manilaDay, payMethodLabel, proceedsByDay, proceedsOf, soldByItem, soldIn, type ProceedsDay } from "@/lib/utils/shop";
import { formatPesoCents } from "@/lib/utils/vehicle-expenses";

const money = (n: number) => n.toFixed(2);

/**
 * Shop › Proceeds (0157): what the shop sold in a period, what the payment partner kept, what reached the
 * foundation and what the goods earned, by day and by item. Finance posts a finished day to the cash book from
 * here, once Shop settings switch that on.
 */
function Proceeds() {
  const access = useModuleAccess();
  const period = usePeriodPresets("shop-proceeds", "this_month", true);
  const { orders, items, loading, postDay } = useShopOrders();
  const { settings } = useShopData();
  const [posting, setPosting] = React.useState<ProceedsDay | null>(null);
  const [busy, setBusy] = React.useState(false);

  if (loading) return <LoadingState />;

  const sold = soldIn(orders, period.window);
  const totals = proceedsOf(sold, items);
  const profit = earned(totals);
  const days = proceedsByDay(sold);
  const byItem = soldByItem(sold, items);
  const inWindow = (iso: string | null) => !!iso && (!period.window || (manilaDay(iso) >= period.window.from && manilaDay(iso) <= period.window.to));
  // Refunds are shown by the day they were made; the ones already in the cash book are Finance's to record there.
  const refunds = orders.filter((o) => o.status === "refunded" && inWindow(o.closedAt));
  const canPost = settings.cashPosting && access.level("finance") === "edit";

  async function post(day: ProceedsDay) {
    setBusy(true);
    const r = await postDay(day.day);
    setBusy(false);
    setPosting(null);
    if (!r.ok) return void toast.error(r.error);
    toast.success(r.posted ? `${formatPesoCents(r.amount ?? 0)} posted to the cash book` : "Nothing to post for that day");
  }

  function download() {
    const byOrder = csvLines(
      ["Order", "Paid on", "Customer", "Goods", "Delivery fee", "Total", "Payment method", "Payment fee", "Reached the foundation", "Sales invoice", "Cash book"],
      sold.map((o) => [o.number, o.paidAt ? manilaDay(o.paidAt) : "", o.name, money(o.subtotal), money(o.deliveryFee), money(o.total), payMethodLabel(o.payMethod), o.payFee == null ? "" : money(o.payFee), money(o.payNet ?? o.total), o.invoiceNumber, o.postedSourceId ? "Posted" : ""]),
    );
    downloadCsv(byOrder, `shop-proceeds-${period.window ? `${period.window.from}-to-${period.window.to}` : "all"}.csv`);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Proceeds"
        description="What the shop sold, what the payment partner kept, and what reached the foundation."
        action={<Button variant="outline" disabled={!sold.length} onClick={download}><Download className="size-4" />Download the orders</Button>}
      />
      <PeriodPresetsBar state={period.state} onChange={period.setState} today={period.today} allowAll />

      <KpiGrid>
        <KpiCard label="Sold" value={formatPesoCents(totals.sold)} sublabel={`${totals.orders} paid order${totals.orders === 1 ? "" : "s"} · ${period.label}`} icon={ShoppingBag} />
        <KpiCard label="Payment fees" value={formatPesoCents(totals.fees)} sublabel="Kept by the payment partner" icon={Receipt} />
        <KpiCard label="Reached the foundation" value={formatPesoCents(totals.net)} sublabel={`Includes ${formatPesoCents(totals.delivery)} of delivery fees`} icon={Wallet} />
        <KpiCard
          label="Earned on the goods"
          value={profit == null ? "Not known" : formatPesoCents(profit)}
          sublabel={profit == null ? `${totals.costMissing} sold line${totals.costMissing === 1 ? " has" : "s have"} no cost recorded` : `Goods ${formatPesoCents(totals.goods)} less cost ${formatPesoCents(totals.cost)} and fees`}
          icon={HandCoins}
          tone={profit == null ? "warning" : "default"}
        />
      </KpiGrid>

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard
          flush
          className="overflow-hidden"
          title="By day"
          description={settings.cashPosting ? "A finished day is posted to the cash book once, as one inflow of what reached the foundation." : "Posting to the cash book is switched off in Shop settings."}
        >
          {days.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Day paid</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="text-right">Sold</TableHead>
                  <TableHead className="text-right">Fees</TableHead>
                  <TableHead className="text-right">Reached us</TableHead>
                  <TableHead>Cash book</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {days.map((d) => (
                  <TableRow key={d.day}>
                    <TableCell className="font-medium">{formatDate(d.day, "EEE, MMM d")}</TableCell>
                    <TableCell className="text-right">{d.orders}</TableCell>
                    <TableCell className="text-right">{formatPesoCents(d.sold)}</TableCell>
                    <TableCell className="text-right">{formatPesoCents(d.fees)}</TableCell>
                    <TableCell className="text-right font-medium">{formatPesoCents(d.net)}</TableCell>
                    <TableCell>
                      {d.posted ? (
                        <Badge variant="secondary">Posted</Badge>
                      ) : d.day >= period.today ? (
                        <span className="text-theme-xs text-muted-foreground">Day not over</span>
                      ) : canPost ? (
                        <Button size="sm" variant="outline" className="h-7" disabled={busy} onClick={() => setPosting(d)}><Banknote className="size-3.5" />Post</Button>
                      ) : (
                        <span className="text-theme-xs text-muted-foreground">Not posted</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="px-5 pb-5 text-theme-sm text-muted-foreground">No paid order in this period.</p>
          )}
        </SectionCard>

        <SectionCard flush className="overflow-hidden" title="By item" description="What sold in this period, best seller first.">
          {byItem.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Pieces</TableHead>
                  <TableHead className="text-right">Sales</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byItem.slice(0, 50).map((p) => (
                  <TableRow key={`${p.name}|${p.option}`}>
                    <TableCell>
                      <div className="font-medium">{p.name}</div>
                      {p.option ? <div className="text-theme-xs text-muted-foreground">{p.option}</div> : null}
                    </TableCell>
                    <TableCell className="text-right">{p.qty}</TableCell>
                    <TableCell className="text-right">{formatPesoCents(p.sales)}</TableCell>
                    <TableCell className="text-right">{p.cost == null ? <span className="text-muted-foreground">Not recorded</span> : formatPesoCents(p.cost)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="px-5 pb-5 text-theme-sm text-muted-foreground">Nothing sold in this period.</p>
          )}
        </SectionCard>
      </div>

      {refunds.length ? (
        <SectionCard flush className="overflow-hidden" title="Refunds" description="Orders refunded in this period. One that was already in the cash book needs its refund recorded there by Finance.">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Refunded</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Cash book</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {refunds.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">{o.number}</TableCell>
                  <TableCell>{formatDate(o.closedAt, "MMM d, h:mm a")}</TableCell>
                  <TableCell className="max-w-80 whitespace-normal">{o.refundReason}</TableCell>
                  <TableCell className="text-right">{formatPesoCents(o.total)}</TableCell>
                  <TableCell>{o.postedSourceId ? <Badge variant="destructive">Was posted: record the refund</Badge> : <span className="text-theme-xs text-muted-foreground">Never posted</span>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>
      ) : null}

      <p className="text-theme-xs text-muted-foreground">
        Delivery fees are collected for the courier and are not counted as earnings. An order counts on the day its payment arrived (Manila time). See each order in <Link className="underline" href="/shop/orders">Orders</Link>.
      </p>

      <AlertDialog open={!!posting} onOpenChange={(open) => !open && setPosting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Post {posting ? formatDate(posting.day, "MMMM d") : ""} to the cash book?</AlertDialogTitle>
            <AlertDialogDescription>
              One inflow of {posting ? formatPesoCents(posting.net) : ""} for {posting?.orders} order{posting?.orders === 1 ? "" : "s"}: what reached the foundation after {posting ? formatPesoCents(posting.fees) : ""} of payment fees. A day is posted once and is not undone from here.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => posting && void post(posting)}>Post to the cash book</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function ShopProceedsPage() {
  return (
    <React.Suspense fallback={<LoadingState />}>
      <Proceeds />
    </React.Suspense>
  );
}
