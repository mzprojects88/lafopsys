"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ExternalLink, Printer } from "lucide-react";
import { toast } from "sonner";
import { ReasonDialog } from "@/components/patterns/reason-dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useShopOrders } from "@/lib/hooks/use-shop-collection";
import { useStaffRoster } from "@/lib/hooks/use-staff-roster";
import { formatDate } from "@/lib/utils/date";
import { ORDER_STATUS_LABEL, addressOf, isSold, nextStep, payMethodLabel, type OrderStep, type ShopOrder, type ShopOrderEvent, type ShopOrderItem } from "@/lib/utils/shop";
import { formatPesoCents } from "@/lib/utils/vehicle-expenses";

const at = (iso: string | null) => formatDate(iso, "MMM d, h:mm a");
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type Ask = { step: OrderStep; title: string; description: string; confirm: string; reason: boolean; destructive?: boolean };

/**
 * One order (0157): who bought what and where it goes, the step that moves it on, and its trail. Each step runs in
 * the database, which checks the order's state, records who did it and emails the customer. The page gives it a
 * key per order, so a half-typed form never carries over to the next order.
 */
export function OrderDialog({ order, items, couriers, siteUrl, canEdit, onClose }: { order: ShopOrder | null; items: ShopOrderItem[]; couriers: string[]; siteUrl: string; canEdit: boolean; onClose: () => void }) {
  const { step, trail } = useShopOrders();
  const { staff } = useStaffRoster();
  const [events, setEvents] = React.useState<ShopOrderEvent[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [ask, setAsk] = React.useState<Ask | null>(null);
  const [ship, setShip] = React.useState<{ courier: string; number: string; link: string } | null>(null);
  const [refund, setRefund] = React.useState<{ reason: string; restock: boolean } | null>(null);
  const [invoice, setInvoice] = React.useState<string | null>(null);
  const id = order?.id ?? null;
  const status = order?.status ?? null;

  React.useEffect(() => {
    let live = true;
    if (id) void trail(id).then((rows) => live && setEvents(rows));
    return () => {
      live = false;
    };
    // The trail is read again whenever the order moves on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, status, order?.attention, order?.invoiceNumber]);

  if (!order) return null;
  const lines = items.filter((i) => i.orderId === order.id);
  const next = nextStep(order);
  const who = (staffId: string) => {
    const s = staff.find((x) => x.id === staffId);
    return s ? `${s.firstName} ${s.lastName}`.trim() : "Staff";
  };

  async function run(name: OrderStep, data: Record<string, string | boolean>, done: string) {
    if (!order) return;
    setBusy(true);
    const r = await step(order.id, name, data);
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success(done);
    setShip(null);
    setRefund(null);
    setInvoice(null);
  }

  function onNext() {
    if (!next) return;
    if (next.step === "pack") return void run("pack", {}, "Marked packed");
    if (next.step === "ship") return setShip({ courier: couriers[0] ?? "", number: "", link: "" });
    if (next.step === "ready") return setAsk({ step: "ready", title: "Ready for pick-up?", description: "The customer is emailed that the order is waiting, with the pick-up address and hours.", confirm: "Mark ready", reason: false });
    setAsk({ step: "deliver", title: order?.delivery === "pickup" ? "Picked up?" : "Delivered?", description: "This closes the order and emails the customer.", confirm: next.label, reason: false });
  }

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-3">
              {order.number}
              <StatusBadge domain="shop_order" status={order.status} label={ORDER_STATUS_LABEL[order.status]} />
            </DialogTitle>
            <DialogDescription>
              Placed {at(order.placedAt)}
              {order.paidAt ? ` · paid ${at(order.paidAt)}` : order.status === "placed" ? ` · held until ${at(order.holdUntil)}` : ""}
            </DialogDescription>
          </DialogHeader>

          {order.attention ? (
            <div className="flex flex-wrap items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-theme-sm" role="alert">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <p className="min-w-0 flex-1 text-foreground">{order.attention}</p>
              {canEdit ? (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => setAsk({ step: "looked", title: "Dealt with?", description: "Say in a few words what was done. The note stays on the order's trail.", confirm: "Clear the flag", reason: true })}>
                  Dealt with
                </Button>
              ) : null}
            </div>
          ) : null}

          {canEdit && next && !ship ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button disabled={busy} onClick={onNext}>{next.label}</Button>
              <span className="text-theme-xs text-muted-foreground">{next.step === "pack" ? "Pack the items below, then mark it." : next.step === "ship" ? "Hand it to the courier, then record the waybill." : "The customer is emailed."}</span>
            </div>
          ) : null}

          {ship ? (
            <div className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="ship-courier">Courier</FieldLabel>
                <Select value={ship.courier} onValueChange={(v) => setShip({ ...ship, courier: v })}>
                  <SelectTrigger id="ship-courier" className="w-full"><SelectValue placeholder="Choose" /></SelectTrigger>
                  <SelectContent>{couriers.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
                {couriers.length ? null : <FieldDescription>Add the couriers in Shop settings first.</FieldDescription>}
              </Field>
              <Field>
                <FieldLabel htmlFor="ship-number">Tracking number</FieldLabel>
                <Input id="ship-number" maxLength={60} value={ship.number} onChange={(e) => setShip({ ...ship, number: e.target.value })} />
                <FieldDescription>From the waybill.</FieldDescription>
              </Field>
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="ship-link">Tracking link (optional)</FieldLabel>
                <Input id="ship-link" inputMode="url" maxLength={300} placeholder="https://" value={ship.link} onChange={(e) => setShip({ ...ship, link: e.target.value })} />
              </Field>
              <div className="flex gap-2 sm:col-span-2">
                <Button
                  disabled={busy || !ship.courier || !ship.number.trim() || (!!ship.link.trim() && !/^https:\/\//.test(ship.link.trim()))}
                  onClick={() => run("ship", { courier: ship.courier, tracking_number: ship.number.trim(), ...(ship.link.trim() ? { tracking_url: ship.link.trim() } : {}) }, "Marked shipped; the customer is emailed")}
                >
                  Mark shipped
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => setShip(null)}>Not yet</Button>
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <section className="rounded-lg border border-border p-4 text-theme-sm">
              <h3 className="mb-2 font-semibold text-foreground">Customer</h3>
              <p className="font-medium text-foreground">{order.name}</p>
              <p className="text-muted-foreground">{order.phone}</p>
              <p className="break-all text-muted-foreground">{order.email}</p>
            </section>
            <section className="rounded-lg border border-border p-4 text-theme-sm">
              <h3 className="mb-2 font-semibold text-foreground">{order.delivery === "pickup" ? "Pick-up" : `Delivery · ${order.area}`}</h3>
              {order.delivery === "pickup" ? <p className="text-muted-foreground">The customer collects the order.</p> : <p className="text-foreground">{addressOf(order)}</p>}
              {order.landmark ? <p className="text-muted-foreground">Note: {order.landmark}</p> : null}
              <p className="text-muted-foreground">Packed weight about {(order.weightGrams / 1000).toLocaleString("en-PH", { maximumFractionDigits: 2 })} kg</p>
              {order.trackingNumber ? (
                <p className="mt-1 text-foreground">
                  {order.courier} · {order.trackingUrl ? <a className="underline" href={order.trackingUrl} target="_blank" rel="noreferrer noopener">{order.trackingNumber}</a> : order.trackingNumber}
                </p>
              ) : null}
            </section>
          </div>

          <div className="overflow-hidden rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell>
                      <div className="font-medium">{i.name}</div>
                      <div className="text-theme-xs text-muted-foreground">{[i.option, i.sku, i.counted ? "" : "made to order"].filter(Boolean).join(" · ")}</div>
                    </TableCell>
                    <TableCell className="text-right font-medium">{i.qty}</TableCell>
                    <TableCell className="text-right">{formatPesoCents(i.unitPrice)}</TableCell>
                    <TableCell className="text-right">{formatPesoCents(i.lineTotal)}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell colSpan={3} className="text-right text-muted-foreground">Delivery</TableCell>
                  <TableCell className="text-right">{order.delivery === "pickup" ? "Free pick-up" : formatPesoCents(order.deliveryFee)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell colSpan={3} className="text-right font-semibold">Total</TableCell>
                  <TableCell className="text-right font-semibold">{formatPesoCents(order.total)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          {order.paidAt ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <section className="rounded-lg border border-border p-4 text-theme-sm">
                <h3 className="mb-2 font-semibold text-foreground">Payment</h3>
                <dl className="grid grid-cols-2 gap-y-1">
                  <dt className="text-muted-foreground">Paid by</dt><dd className="text-right">{payMethodLabel(order.payMethod)}</dd>
                  <dt className="text-muted-foreground">Payment fee</dt><dd className="text-right">{order.payFee == null ? "Not reported" : formatPesoCents(order.payFee)}</dd>
                  <dt className="text-muted-foreground">Reached the foundation</dt><dd className="text-right font-medium">{formatPesoCents(order.payNet ?? order.total)}</dd>
                  {order.postedSourceId ? <><dt className="text-muted-foreground">Cash book</dt><dd className="text-right">Posted</dd></> : null}
                  {order.status === "refunded" ? <><dt className="text-muted-foreground">Refund</dt><dd className="text-right">{order.refundReason}{order.restocked ? " (pieces back in stock)" : ""}</dd></> : null}
                </dl>
              </section>
              <section className="rounded-lg border border-border p-4 text-theme-sm">
                <h3 className="mb-2 font-semibold text-foreground">Sales invoice</h3>
                {canEdit && isSold(order) ? (
                  <div className="flex items-end gap-2">
                    <Field className="flex-1">
                      <FieldLabel htmlFor="order-invoice">Invoice number</FieldLabel>
                      <Input id="order-invoice" maxLength={40} value={invoice ?? order.invoiceNumber} onChange={(e) => setInvoice(e.target.value)} />
                    </Field>
                    <Button variant="outline" disabled={busy || invoice === null || !invoice.trim() || invoice.trim() === order.invoiceNumber} onClick={() => run("invoice", { invoice_number: (invoice ?? "").trim() }, "Invoice number saved")}>Save</Button>
                  </div>
                ) : (
                  <p className="text-muted-foreground">{order.invoiceNumber ? `No. ${order.invoiceNumber}` : "Not recorded"}</p>
                )}
                <p className="mt-2 text-theme-xs text-muted-foreground">The number of the invoice from the booklet that goes in the parcel. The customer sees it on their order page.</p>
              </section>
            </div>
          ) : null}

          {refund ? (
            <div className="grid gap-3 rounded-lg border border-destructive/40 p-4">
              <p className="text-theme-sm text-foreground">Send the money back in the payment partner&apos;s dashboard first. This records the refund on the order and emails the customer.</p>
              <Field>
                <FieldLabel htmlFor="refund-reason">Reason</FieldLabel>
                <Textarea id="refund-reason" rows={2} maxLength={300} value={refund.reason} onChange={(e) => setRefund({ ...refund, reason: e.target.value })} />
              </Field>
              {lines.some((i) => i.counted) ? (
                <label className="flex items-center gap-2 text-theme-sm">
                  <Checkbox checked={refund.restock} onCheckedChange={(v) => setRefund({ ...refund, restock: v === true })} />
                  The pieces are back with us and can be sold again
                </label>
              ) : null}
              <div className="flex gap-2">
                <Button variant="destructive" disabled={busy || refund.reason.trim().length < 5} onClick={() => run("refund", { reason: refund.reason.trim(), restock: refund.restock }, "Refund recorded; the customer is emailed")}>Record the refund</Button>
                <Button variant="ghost" disabled={busy} onClick={() => setRefund(null)}>Keep the order</Button>
              </div>
            </div>
          ) : null}

          <section className="text-theme-sm">
            <h3 className="mb-2 font-semibold text-foreground">Trail</h3>
            <ol className="flex flex-col gap-1.5">
              {events.map((e) => (
                <li key={e.id} className="flex flex-wrap gap-x-2 text-muted-foreground">
                  <span className="w-32 shrink-0">{at(e.at)}</span>
                  <span className="font-medium text-foreground">{sentence(e.event)}</span>
                  {e.detail ? <span className="min-w-0 break-words">{e.detail}</span> : null}
                  {e.byStaffId ? <span>· {who(e.byStaffId)}</span> : null}
                </li>
              ))}
            </ol>
          </section>

          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
            <Button asChild variant="outline" size="sm">
              <Link href={`/shop/orders/${order.id}/print`} target="_blank"><Printer className="size-3.5" />Packing slip</Link>
            </Button>
            {siteUrl ? (
              <Button asChild variant="outline" size="sm">
                <a href={`${siteUrl}/order/${order.token}`} target="_blank" rel="noreferrer noopener"><ExternalLink className="size-3.5" />The customer&apos;s order page</a>
              </Button>
            ) : null}
            <span className="flex-1" />
            {canEdit && order.status === "placed" ? (
              <Button variant="ghost" size="sm" className="text-destructive" disabled={busy} onClick={() => setAsk({ step: "cancel", title: "Cancel this unpaid order?", description: "The held pieces go back on sale and the customer is emailed that nothing was charged.", confirm: "Cancel the order", reason: false, destructive: true })}>
                Cancel order
              </Button>
            ) : null}
            {canEdit && isSold(order) && !refund ? (
              <Button variant="ghost" size="sm" className="text-destructive" disabled={busy} onClick={() => setRefund({ reason: "", restock: false })}>
                Refund
              </Button>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      {/* A plain yes/no for the steps that email the customer; a note where the trail needs one. */}
      <AlertDialog open={!!ask && !ask.reason && ask.step !== "cancel"} onOpenChange={(open) => !open && setAsk(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{ask?.title}</AlertDialogTitle>
            <AlertDialogDescription>{ask?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction onClick={() => ask && void run(ask.step, {}, ask.step === "ready" ? "Marked ready; the customer is emailed" : "Order closed; the customer is emailed")}>{ask?.confirm}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ReasonDialog
        open={!!ask && (ask.reason || ask.step === "cancel")}
        onOpenChange={(open) => !open && setAsk(null)}
        title={ask?.title ?? ""}
        description={ask?.description}
        confirmLabel={ask?.confirm}
        requireReason={ask?.reason ?? false}
        minLength={5}
        destructive={ask?.destructive}
        onConfirm={(reason) => ask && void run(ask.step, reason.trim().length >= 5 ? { reason: reason.trim() } : {}, ask.step === "cancel" ? "Order cancelled" : "Flag cleared")}
      />
    </>
  );
}
