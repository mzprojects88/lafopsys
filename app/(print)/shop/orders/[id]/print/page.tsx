import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/app/(print)/hr/payslips/[id]/print/print-button";
import { createClient } from "@/lib/supabase/server";

// This page is drawn on the server, which may run in another time zone: times are always written in Manila time.
const when = (iso: string) => new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));

/**
 * A shop order's packing slip (0157): what goes in the parcel and where it goes, with boxes to tick while packing.
 * No prices: the sales invoice from the booklet carries those. Read under the caller's own access to the Shop.
 */
export default async function PackingSlipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: order } = await supabase
    .schema("shop")
    .from("orders")
    .select("number, status, name, phone, delivery, area, province, city, barangay, postal_code, address_line, landmark, weight_grams, placed_at, paid_at, courier, tracking_number, invoice_number, order_items(sku, name, option, qty, counted, sort)")
    .eq("id", id)
    .maybeSingle();
  if (!order) notFound();
  const items = ((order.order_items ?? []) as { sku: string; name: string; option: string; qty: number; counted: boolean; sort: number }[]).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  const pieces = items.reduce((n, i) => n + i.qty, 0);
  const address = [order.address_line, order.barangay ? `Brgy. ${order.barangay}` : "", order.city, order.province, order.postal_code].filter(Boolean).join(", ");

  return (
    <div className="mx-auto max-w-3xl p-6 text-sm text-neutral-900 print:max-w-none print:p-0">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href="/shop/orders" className="text-xs underline">Back to Orders</Link>
        <PrintButton />
      </div>
      <div className="rounded-xl border border-neutral-300 p-8 print:rounded-none print:border-0 print:p-0">
        <header className="flex items-start justify-between gap-4 border-b border-neutral-300 pb-4">
          <div className="flex items-center gap-3">
            <Image src="/logo/laf-mark.png" alt="" width={48} height={51} />
            <div>
              <h1 className="text-lg font-semibold">Packing slip</h1>
              <p className="text-xs text-neutral-600">Little Ark Shop · Little Ark Foundation, Inc.</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-base font-semibold">{order.number}</p>
            <p className="text-xs text-neutral-600">Placed {when(order.placed_at)}</p>
            {order.status === "placed" ? <p className="text-xs font-semibold">NOT YET PAID: do not pack</p> : order.paid_at ? <p className="text-xs text-neutral-600">Paid {when(order.paid_at)}</p> : null}
          </div>
        </header>

        <section className="grid grid-cols-2 gap-6 border-b border-neutral-300 py-4">
          <div>
            <h2 className="text-xs font-semibold tracking-wide text-neutral-600 uppercase">{order.delivery === "pickup" ? "For pick-up by" : "Deliver to"}</h2>
            <p className="mt-1 text-base font-semibold">{order.name}</p>
            <p>{order.phone}</p>
            {order.delivery === "courier" ? <p className="mt-1">{address}</p> : null}
            {order.landmark ? <p className="text-neutral-600">Note: {order.landmark}</p> : null}
          </div>
          <div>
            <h2 className="text-xs font-semibold tracking-wide text-neutral-600 uppercase">Parcel</h2>
            <p className="mt-1">{order.delivery === "pickup" ? "Pick-up at the foundation" : `Courier · ${order.area}`}</p>
            <p>About {(Number(order.weight_grams) / 1000).toLocaleString("en-PH", { maximumFractionDigits: 2 })} kg packed · {pieces} piece{pieces === 1 ? "" : "s"}</p>
            <p>Courier: {order.courier || "________________"}</p>
            <p>Tracking no.: {order.tracking_number || "________________"}</p>
            <p>Sales invoice no.: {order.invoice_number || "________________"}</p>
          </div>
        </section>

        <table className="mt-4 w-full border-collapse">
          <thead>
            <tr className="border-b border-neutral-400 text-left text-xs text-neutral-600 uppercase">
              <th className="w-20 py-2">Packed</th>
              <th className="py-2">Item</th>
              <th className="py-2">Code</th>
              <th className="w-14 py-2 text-right">Qty</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i, n) => (
              <tr key={n} className="border-b border-neutral-200 align-top">
                <td className="py-2"><span className="inline-block size-4 border border-neutral-500" aria-hidden /></td>
                <td className="py-2">
                  <span className="font-medium">{i.name}</span>
                  {i.option ? <span className="text-neutral-700"> · {i.option}</span> : null}
                  {i.counted ? null : <span className="text-neutral-600"> (made to order)</span>}
                </td>
                <td className="py-2 font-mono text-xs">{i.sku}</td>
                <td className="py-2 text-right text-base font-semibold">{i.qty}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <footer className="mt-8 grid grid-cols-2 gap-6 text-xs text-neutral-600">
          <p>Packed by: ______________________ &nbsp; Date: ____________</p>
          <p className="text-right">Put the sales invoice in the parcel. Thank you for coming aboard.</p>
        </footer>
      </div>
    </div>
  );
}
