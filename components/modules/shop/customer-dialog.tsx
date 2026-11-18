"use client";

import * as React from "react";
import { toast } from "sonner";
import { ReasonDialog } from "@/components/patterns/reason-dialog";
import { StatusBadge } from "@/components/patterns/status-badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useShopCustomers } from "@/lib/hooks/use-shop-collection";
import { useStaffRoster } from "@/lib/hooks/use-staff-roster";
import { formatDate } from "@/lib/utils/date";
import { CUSTOMER_EVENT_LABEL, CUSTOMER_STATE_LABEL, DELIVERY_AREAS, GIFT_METHOD_LABEL, ORDER_STATUS_LABEL, addressOf, type CustomerRow, type CustomerStep, type ShopCustomer, type ShopCustomerEvent, type ShopGift, type ShopOrder } from "@/lib/utils/shop";
import { formatPesoCents } from "@/lib/utils/vehicle-expenses";

const at = (iso: string | null) => (iso ? formatDate(iso, "MMM d, yyyy, h:mm a") : "Never");
type Details = { name: string; phone: string; area: string; province: string; city: string; barangay: string; address_line: string; postal_code: string; landmark: string };
type Ask = { step: Extract<CustomerStep, "block" | "unblock" | "sign_out">; title: string; description: string; confirm: string };

/**
 * One customer of the shop site (0160): who they are, how they sign in, what they ordered, and the trail of their
 * account. A customer signs in with a code sent to their address, so there is no password to see or reset, and
 * codes and sessions cannot be read by anyone. Staff can block the sign-in, sign every device out, correct the
 * details and close the account; the sign-in address is the customer's own to change. A guest (someone who bought
 * without an account) has no account to act on: only what their orders say.
 */
export function CustomerDialog({ row, customer, orders, gifts, canEdit, onOpenOrder, onClose }: { row: CustomerRow | null; customer: ShopCustomer | null; orders: ShopOrder[]; gifts: ShopGift[]; canEdit: boolean; onOpenOrder: (orderId: string) => void; onClose: () => void }) {
  const { step, trail, devices } = useShopCustomers();
  const { staff } = useStaffRoster();
  const [events, setEvents] = React.useState<ShopCustomerEvent[]>([]);
  const [signedIn, setSignedIn] = React.useState<number | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [ask, setAsk] = React.useState<Ask | null>(null);
  const [closing, setClosing] = React.useState(false);
  const [edit, setEdit] = React.useState<Details | null>(null);
  const id = customer?.id ?? null;
  const status = customer?.status ?? null;
  const stamp = `${customer?.lastSignInAt ?? ""}|${customer?.name ?? ""}|${customer?.phone ?? ""}|${customer?.addressLine ?? ""}`;

  React.useEffect(() => {
    let live = true;
    if (id) {
      void trail(id).then((rows) => live && setEvents(rows));
      void devices(id).then((n) => live && setSignedIn(n));
    }
    return () => {
      live = false;
    };
    // Read again whenever the account changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, status, stamp]);

  if (!row) return null;
  const mine = orders.filter((o) => row.orderIds.includes(o.id)).sort((a, b) => b.placedAt.localeCompare(a.placedAt));
  const latest = mine[0] ?? null;
  // Their gifts that were paid (a test payment is listed too, marked as one), newest first.
  const given = gifts.filter((g) => g.customerId === row.customerId && g.status === "paid").sort((a, b) => (b.paidAt ?? b.createdAt).localeCompare(a.paidAt ?? a.createdAt));
  const account = customer && customer.status !== "closed" ? customer : null;
  const who = (staffId: string | null) => {
    if (!staffId) return "The customer";
    const s = staff.find((x) => x.id === staffId);
    return s ? `${s.firstName} ${s.lastName}`.trim() : "Staff";
  };

  async function run(name: CustomerStep, data: Record<string, string>, done: string) {
    if (!customer) return;
    setBusy(true);
    const r = await step(customer.id, name, data);
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success(done);
    setEdit(null);
    if (name === "sign_out") setSignedIn(0);
  }

  const detail = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-4 py-1">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium [overflow-wrap:anywhere] text-foreground">{value}</dd>
    </div>
  );

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-3">
              {row.state === "closed" ? "Closed account" : row.name || "No name given yet"}
              <StatusBadge domain="shop_customer" status={row.state} label={CUSTOMER_STATE_LABEL[row.state]} />
            </DialogTitle>
            <DialogDescription>
              {row.state === "guest" ? `Bought without an account · first order ${at(row.createdAt)}` : row.state === "closed" ? `Closed ${at(customer?.statusAt ?? null)} · the details were removed; the orders and gifts stay as records` : `${row.email} · account created ${at(row.createdAt)}`}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            {account ? (
              <section className="rounded-lg border border-border p-4 text-theme-sm">
                <h3 className="mb-2 font-semibold text-foreground">Sign-in</h3>
                <dl>
                  <div className="py-1">
                    <dt className="text-muted-foreground">Sign-in address</dt>
                    <dd className="font-medium [overflow-wrap:anywhere] text-foreground">{account.email}</dd>
                  </div>
                  {detail("How they sign in", "A code sent to that address")}
                  {detail("Last signed in", at(account.lastSignInAt))}
                  {detail("Times signed in", account.signInCount)}
                  {detail("Devices signed in now", signedIn ?? "…")}
                </dl>
                <p className="mt-2 text-theme-xs text-muted-foreground">There is no password to see or reset, and nobody can read a code. Only the customer can change the sign-in address, with a code sent to the new one.</p>
              </section>
            ) : null}
            <section className="rounded-lg border border-border p-4 text-theme-sm">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="font-semibold text-foreground">{row.state === "guest" ? "From their latest order" : "Details"}</h3>
                {canEdit && account && !edit ? (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => setEdit({ name: account.name, phone: account.phone, area: account.area, province: account.province, city: account.city, barangay: account.barangay, address_line: account.addressLine, postal_code: account.postalCode, landmark: account.landmark })}>
                    Correct
                  </Button>
                ) : null}
              </div>
              {row.state === "closed" ? (
                <p className="text-muted-foreground">Nothing is kept about the person. Each order still shows who bought it and where it went.</p>
              ) : account ? (
                <dl>
                  {detail("Name", account.name || "Not given")}
                  {detail("Mobile number", account.phone || "Not given")}
                  {detail("Delivery address", account.addressLine ? `${addressOf(account)}${account.area ? ` (${account.area})` : ""}` : "Not given")}
                  {account.landmark ? detail("Note for the rider", account.landmark) : null}
                </dl>
              ) : (
                <dl>
                  {detail("Name", row.name)}
                  {detail("Email", row.email)}
                  {detail("Mobile number", row.phone)}
                  {latest ? detail("Went to", latest.delivery === "pickup" ? "Pick-up" : `${addressOf(latest)}${latest.area ? ` (${latest.area})` : ""}`) : null}
                </dl>
              )}
            </section>
          </div>

          {edit && account ? (
            <div className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="cu-name">Full name</FieldLabel>
                <Input id="cu-name" maxLength={80} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="cu-phone">Mobile number</FieldLabel>
                <Input id="cu-phone" inputMode="tel" maxLength={30} value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="cu-area">Delivery area</FieldLabel>
                <Select value={edit.area || "none"} onValueChange={(v) => setEdit({ ...edit, area: v === "none" ? "" : v })}>
                  <SelectTrigger id="cu-area" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not given</SelectItem>
                    {DELIVERY_AREAS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="cu-province">Province</FieldLabel>
                <Input id="cu-province" maxLength={60} value={edit.province} onChange={(e) => setEdit({ ...edit, province: e.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="cu-city">City or municipality</FieldLabel>
                <Input id="cu-city" maxLength={60} value={edit.city} onChange={(e) => setEdit({ ...edit, city: e.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="cu-barangay">Barangay</FieldLabel>
                <Input id="cu-barangay" maxLength={60} value={edit.barangay} onChange={(e) => setEdit({ ...edit, barangay: e.target.value })} />
              </Field>
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="cu-line">House number, street, building</FieldLabel>
                <Input id="cu-line" maxLength={200} value={edit.address_line} onChange={(e) => setEdit({ ...edit, address_line: e.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="cu-postal">Postal code</FieldLabel>
                <Input id="cu-postal" maxLength={10} value={edit.postal_code} onChange={(e) => setEdit({ ...edit, postal_code: e.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="cu-landmark">Note for the rider</FieldLabel>
                <Input id="cu-landmark" maxLength={200} value={edit.landmark} onChange={(e) => setEdit({ ...edit, landmark: e.target.value })} />
                <FieldDescription>The sign-in address is not here: only the customer changes it.</FieldDescription>
              </Field>
              <div className="flex gap-2 sm:col-span-2">
                <Button disabled={busy || edit.name.trim().length < 2} onClick={() => run("edit", edit, "Details corrected")}>Save the correction</Button>
                <Button variant="ghost" disabled={busy} onClick={() => setEdit(null)}>Cancel</Button>
              </div>
            </div>
          ) : null}

          <section>
            <h3 className="mb-2 text-theme-sm font-semibold text-foreground">Orders <span className="font-normal text-muted-foreground">{mine.length ? `${row.orders} counted · ${formatPesoCents(row.spent)} paid` : ""}</span></h3>
            {mine.length ? (
              <div className="overflow-hidden rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order</TableHead>
                      <TableHead>Placed</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mine.slice(0, 50).map((o) => (
                      <TableRow key={o.id} className="cursor-pointer" tabIndex={0} onClick={() => onOpenOrder(o.id)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpenOrder(o.id))}>
                        <TableCell className="font-medium">{o.number}</TableCell>
                        <TableCell>{formatDate(o.placedAt, "MMM d, yyyy, h:mm a")}</TableCell>
                        <TableCell><StatusBadge domain="shop_order" status={o.status} label={ORDER_STATUS_LABEL[o.status]} /></TableCell>
                        <TableCell className="text-right">{formatPesoCents(o.total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="text-theme-sm text-muted-foreground">No order yet.</p>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-theme-sm font-semibold text-foreground">Gifts <span className="font-normal text-muted-foreground">{row.gifts ? `${row.gifts} given · ${formatPesoCents(row.given)}` : ""}</span></h3>
            {given.length ? (
              <div className="overflow-hidden rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Receipt</TableHead>
                      <TableHead>Given</TableHead>
                      <TableHead>Paid by</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {given.slice(0, 50).map((g) => (
                      <TableRow key={g.id}>
                        <TableCell>
                          <div className="font-medium">{g.receiptNo || (g.live ? "Not yet in Donors" : "No receipt")}</div>
                          <div className="text-theme-xs text-muted-foreground">{g.reference}</div>
                          {g.attention ? <div className="text-theme-xs text-destructive">{g.attention}</div> : null}
                        </TableCell>
                        <TableCell>{formatDate(g.paidAt ?? g.createdAt, "MMM d, yyyy, h:mm a")}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span>{GIFT_METHOD_LABEL[g.payMethod] ?? "Online"}</span>
                            {g.live ? null : <StatusBadge domain="shop_customer" status="guest" label="Test payment" />}
                            {g.anonymous ? <StatusBadge domain="shop_customer" status="closed" label="Anonymous" /> : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{formatPesoCents(g.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="text-theme-sm text-muted-foreground">{row.customerId ? "No gift yet." : "Giving needs an account, so a guest has no gifts here."}</p>
            )}
            {given.some((g) => g.anonymous) ? <p className="mt-2 text-theme-xs text-muted-foreground">An anonymous gift is under “Anonymous donor” in Donors and names nobody on its receipt. Please do not thank this customer for it by name.</p> : null}
            {given.some((g) => !g.live) ? <p className="mt-2 text-theme-xs text-muted-foreground">A test payment moved no money: it is not in Donors, has no receipt and is not counted.</p> : null}
          </section>

          {canEdit && account ? (
            <div className="flex flex-wrap gap-2 border-t border-border pt-4">
              {account.status === "blocked" ? (
                <Button variant="outline" disabled={busy} onClick={() => setAsk({ step: "unblock", title: "Let this customer sign in again?", description: "They can ask for a code and sign in as before.", confirm: "Unblock sign-in" })}>Unblock sign-in</Button>
              ) : (
                <Button variant="outline" disabled={busy} onClick={() => setAsk({ step: "block", title: "Block this customer's sign-in?", description: "They are signed out of every device and get no new code until someone unblocks them. Their orders are not touched. Say why, for the trail.", confirm: "Block sign-in" })}>Block sign-in</Button>
              )}
              <Button variant="outline" disabled={busy || signedIn === 0} onClick={() => setAsk({ step: "sign_out", title: "Sign this customer out of every device?", description: "They sign in again with a new code. Use this when a phone was lost or shared.", confirm: "Sign out everywhere" })}>Sign out everywhere</Button>
              <Button variant="destructive" disabled={busy} onClick={() => setClosing(true)}>Close the account</Button>
            </div>
          ) : null}

          {id ? (
            <section>
              <h3 className="mb-2 text-theme-sm font-semibold text-foreground">Trail</h3>
              {events.length ? (
                <ul className="flex flex-col gap-1.5 text-theme-sm">
                  {events.map((e) => (
                    <li key={e.id} className="flex flex-wrap justify-between gap-x-4">
                      <span className="text-foreground">
                        {CUSTOMER_EVENT_LABEL[e.event] ?? e.event}
                        {e.detail ? <span className="text-muted-foreground"> · {e.detail}</span> : null}
                      </span>
                      <span className="text-theme-xs text-muted-foreground">{who(e.byStaffId)} · {formatDate(e.at, "MMM d, yyyy, h:mm a")}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-theme-sm text-muted-foreground">Nothing recorded yet.</p>
              )}
            </section>
          ) : null}
        </DialogContent>
      </Dialog>

      <ReasonDialog
        open={!!ask}
        onOpenChange={(open) => !open && setAsk(null)}
        title={ask?.title ?? ""}
        description={ask?.description ?? ""}
        confirmLabel={ask?.confirm ?? "Confirm"}
        requireReason={ask?.step === "block"}
        destructive={ask?.step === "block"}
        onConfirm={(reason) => {
          const a = ask;
          setAsk(null);
          if (a) void run(a.step, reason.trim() ? { note: reason.trim() } : {}, a.step === "block" ? "Sign-in blocked" : a.step === "unblock" ? "Sign-in unblocked" : "Signed out of every device");
        }}
      />

      <AlertDialog open={closing} onOpenChange={setClosing}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close this account?</AlertDialogTitle>
            <AlertDialogDescription>
              Do this only when the customer asks. Their name, mobile number, address and sign-in address are removed and every device is signed out. Their orders and gifts stay as the foundation&apos;s sales and donation records. This cannot be undone; the same email address can open a new, empty account later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep the account</AlertDialogCancel>
            <AlertDialogAction onClick={() => void run("close", {}, "Account closed")}>Close the account</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
