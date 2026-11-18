// The Shop (0155): the catalogue's shapes and the small rules the pages share. Pure: no database or browser code.

export type ShopSupply = "stock" | "made";
export type ShopStatus = "draft" | "published" | "hidden";

export interface ShopProduct {
  id: string;
  slug: string;
  name: string;
  category: string;
  collection: string;
  description: string;
  details: string;
  supply: ShopSupply;
  leadMin: number;
  leadMax: number;
  weightGrams: number;
  badge: string;
  status: ShopStatus;
  sort: number;
  updatedAt: string;
}

/** One item (SKU): a product in one colour and size. */
export interface ShopVariant {
  id: string;
  productId: string;
  sku: string;
  colour: string;
  size: string;
  price: number;
  cost: number | null;
  stock: number;
  held: number;
  reorderAt: number;
  active: boolean;
  sort: number;
}

export interface ShopPhoto {
  id: string;
  productId: string;
  path: string;
  label: string;
  alt: string;
  sort: number;
}

export interface ShopSettings {
  shopOpen: boolean;
  packMin: number;
  packMax: number;
  pickupEnabled: boolean;
  pickupAddress: string;
  pickupNote: string;
  categories: string[];
  collections: string[];
  /** The couriers staff choose from when shipping (0157). */
  couriers: string[];
  /** The shop site's address, for the links in order emails. */
  siteUrl: string;
  /** Whether Finance may post a day's proceeds to the cash book. */
  cashPosting: boolean;
  /** Giving from a customer's account (0161): open or not, the amounts offered, the smallest and largest gift. */
  givingOpen: boolean;
  giftAmounts: number[];
  giftMin: number;
  giftMax: number;
  termsText: string;
  privacyText: string;
  returnsText: string;
}

export const DELIVERY_AREAS = ["Metro Manila", "Luzon", "Visayas", "Mindanao"] as const;
export type DeliveryArea = (typeof DELIVERY_AREAS)[number];

export interface ShopDeliveryFee {
  id: string;
  area: DeliveryArea;
  maxGrams: number;
  fee: number;
}

export const STOCK_REASONS = [
  { value: "received", label: "Received from the supplier", adds: true },
  { value: "returned", label: "Returned by a customer", adds: true },
  { value: "damaged", label: "Damaged or lost", adds: false },
  { value: "count", label: "Recount (set the real number)", adds: null },
] as const;
export type StockReason = (typeof STOCK_REASONS)[number]["value"];

export const STATUS_LABEL: Record<ShopStatus, string> = { draft: "Draft", published: "On the site", hidden: "Hidden" };

/** "Our Children. Our Future. Tee" -> "our-children-our-future-tee": the product's address on the site. */
export function slugFor(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const SKU_RE = /^[A-Z0-9]+(-[A-Z0-9]+)*$/;

const code = (s: string, max: number) => s.normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "").toUpperCase().slice(0, max);

/** A readable item code from the product's address, colour and size: "GIVE-HOPE-TEE-NAVY-M". */
export function skuFor(slug: string, colour: string, size: string): string {
  const parts = [slug.toUpperCase().replace(/[^A-Z0-9-]+/g, "").slice(0, 24).replace(/-+$/g, ""), code(colour, 6), code(size, 5)].filter(Boolean);
  return parts.join("-").slice(0, 40).replace(/-+$/g, "");
}

/** What the site can still sell of a counted item. */
export const leftToSell = (v: Pick<ShopVariant, "stock" | "held">): number => Math.max(0, v.stock - v.held);

/** A counted item at or under its reorder point (0 = no reorder point, so only an empty shelf counts). */
export const isLow = (v: Pick<ShopVariant, "stock" | "held" | "reorderAt" | "active">): boolean => v.active && leftToSell(v) <= v.reorderAt;

/** What one piece earns before the payment fee, or null when the cost isn't recorded. */
export const marginOf = (v: Pick<ShopVariant, "price" | "cost">): number | null => (v.cost == null ? null : Math.round((v.price - v.cost) * 100) / 100);

/** "₱450" or "₱450 to ₱1,250" for a product's items. */
export function priceRange(variants: Pick<ShopVariant, "price" | "active">[]): string {
  const prices = variants.filter((v) => v.active).map((v) => v.price);
  if (!prices.length) return "No item on sale";
  const lo = Math.min(...prices), hi = Math.max(...prices);
  const fmt = (n: number) => "₱" + n.toLocaleString("en-PH", { maximumFractionDigits: 2 });
  return lo === hi ? fmt(lo) : `${fmt(lo)} to ${fmt(hi)}`;
}

/** Why a product can't show on the site yet, in the order to fix them; empty when it can. */
export function publishProblems(product: Pick<ShopProduct, "status">, variants: Pick<ShopVariant, "active">[], photos: unknown[]): string[] {
  const out: string[] = [];
  if (!photos.length) out.push("Add a photo");
  if (!variants.some((v) => v.active)) out.push("Add an item on sale");
  if (product.status !== "published") out.push(product.status === "hidden" ? "It is hidden" : "It is still a draft");
  return out;
}

/** The change to send for a recount: the counted number less what the system holds. */
export const recountChange = (current: number, counted: number): number => counted - current;

/** Reads a typed amount ("1,250.50") as pesos, or null when it isn't a plain amount. */
export function readAmount(text: string): number | null {
  const t = text.replace(/[₱,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Number(t);
}

// ---- Orders and proceeds (0156, 0157) ----

export type ShopOrderStatus = "placed" | "paid" | "packed" | "shipped" | "ready" | "delivered" | "expired" | "cancelled" | "refunded";

export interface ShopOrder {
  id: string;
  /** The customer account the order belongs to (0160); null when it was placed without signing in. */
  customerId: string | null;
  number: string;
  /** The customer's private link on the shop site: <site>/order/<token>. */
  token: string;
  status: ShopOrderStatus;
  name: string;
  email: string;
  phone: string;
  delivery: "courier" | "pickup";
  area: string;
  province: string;
  city: string;
  barangay: string;
  postalCode: string;
  addressLine: string;
  landmark: string;
  weightGrams: number;
  subtotal: number;
  deliveryFee: number;
  total: number;
  placedAt: string;
  holdUntil: string;
  paidAt: string | null;
  packedAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  closedAt: string | null;
  payMethod: string;
  payFee: number | null;
  payNet: number | null;
  /** Something staff must look at; empty when nothing is flagged. */
  attention: string;
  courier: string;
  trackingNumber: string;
  trackingUrl: string;
  invoiceNumber: string;
  refundReason: string;
  restocked: boolean | null;
  /** The cash book entry the order's day was posted under ("shop:2026-11-17"); empty until posted. */
  postedSourceId: string;
}

export interface ShopOrderItem {
  id: string;
  orderId: string;
  sku: string;
  name: string;
  option: string;
  counted: boolean;
  qty: number;
  unitPrice: number;
  unitCost: number | null;
  lineTotal: number;
}

export interface ShopOrderEvent {
  id: string;
  event: string;
  detail: string;
  byStaffId: string | null;
  at: string;
}

export const ORDER_STATUS_LABEL: Record<ShopOrderStatus, string> = {
  placed: "Waiting for payment",
  paid: "To pack",
  packed: "Packed",
  shipped: "On the way",
  ready: "Ready for pick-up",
  delivered: "Delivered",
  expired: "Not paid in time",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

/** An order whose money the foundation holds: paid and not refunded. */
export const isSold = (o: Pick<ShopOrder, "status">): boolean => ["paid", "packed", "shipped", "ready", "delivered"].includes(o.status);

export type OrderStep = "pack" | "ship" | "ready" | "deliver" | "invoice" | "looked" | "cancel" | "refund";

/** The step that moves an order forward, when staff have one to do. */
export function nextStep(o: Pick<ShopOrder, "status" | "delivery">): { step: OrderStep; label: string } | null {
  if (o.status === "paid") return { step: "pack", label: "Mark packed" };
  if (o.status === "packed") return o.delivery === "pickup" ? { step: "ready", label: "Ready for pick-up" } : { step: "ship", label: "Ship" };
  if (o.status === "shipped") return { step: "deliver", label: "Mark delivered" };
  if (o.status === "ready") return { step: "deliver", label: "Mark picked up" };
  return null;
}

export const ORDER_QUEUES = [
  { key: "todo", label: "To pack and send" },
  { key: "out", label: "On the way" },
  { key: "unpaid", label: "Waiting for payment" },
  { key: "done", label: "Delivered" },
  { key: "closed", label: "Closed" },
] as const;
export type OrderQueue = (typeof ORDER_QUEUES)[number]["key"];

/** The list an order sits in on the Orders page. */
export function queueOf(o: Pick<ShopOrder, "status">): OrderQueue {
  if (o.status === "paid" || o.status === "packed") return "todo";
  if (o.status === "shipped" || o.status === "ready") return "out";
  if (o.status === "placed") return "unpaid";
  return o.status === "delivered" ? "done" : "closed";
}

/** The Manila calendar day of a moment, "2026-11-17". */
export const manilaDay = (iso: string): string => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(iso));

/** Paid, unrefunded orders whose payment day (Manila) falls in the window; every such order when there is none. */
export function soldIn<T extends Pick<ShopOrder, "status" | "paidAt">>(orders: T[], window: { from: string; to: string } | null): T[] {
  return orders.filter((o) => isSold(o) && !!o.paidAt && (!window || (manilaDay(o.paidAt) >= window.from && manilaDay(o.paidAt) <= window.to)));
}

const cents = (n: number) => Math.round(n * 100) / 100;

export interface ProceedsTotals {
  orders: number;
  /** Everything customers paid: goods and delivery fees. */
  sold: number;
  goods: number;
  delivery: number;
  /** What the payment partner kept. */
  fees: number;
  /** What reached the foundation. */
  net: number;
  /** What the goods cost, for the lines whose cost was recorded. */
  cost: number;
  /** Lines sold without a recorded cost: the earnings figure is not shown while there are any. */
  costMissing: number;
}

/** The money of a set of sold orders. Give it the orders from soldIn and every order line. */
export function proceedsOf(sold: Pick<ShopOrder, "id" | "subtotal" | "deliveryFee" | "total" | "payFee" | "payNet">[], items: Pick<ShopOrderItem, "orderId" | "qty" | "unitCost">[]): ProceedsTotals {
  const ids = new Set(sold.map((o) => o.id));
  const lines = items.filter((i) => ids.has(i.orderId));
  return {
    orders: sold.length,
    sold: cents(sold.reduce((n, o) => n + o.total, 0)),
    goods: cents(sold.reduce((n, o) => n + o.subtotal, 0)),
    delivery: cents(sold.reduce((n, o) => n + o.deliveryFee, 0)),
    fees: cents(sold.reduce((n, o) => n + (o.payFee ?? 0), 0)),
    net: cents(sold.reduce((n, o) => n + (o.payNet ?? o.total), 0)),
    cost: cents(lines.reduce((n, i) => n + (i.unitCost ?? 0) * i.qty, 0)),
    costMissing: lines.filter((i) => i.unitCost == null).length,
  };
}

/** What the goods earned after their cost and the payment fees, or null while a sold line has no cost recorded.
 * Delivery fees are left out: they are passed on to the courier. */
export const earned = (t: ProceedsTotals): number | null => (t.costMissing ? null : cents(t.goods - t.cost - t.fees));

export interface ProceedsDay {
  day: string;
  orders: number;
  sold: number;
  fees: number;
  net: number;
  /** The cash book entry of the day, or empty when it is not posted. */
  posted: string;
}

/** Sold orders by the Manila day they were paid, newest first. */
export function proceedsByDay(sold: Pick<ShopOrder, "paidAt" | "total" | "payFee" | "payNet" | "postedSourceId">[]): ProceedsDay[] {
  const days = new Map<string, ProceedsDay>();
  for (const o of sold) {
    if (!o.paidAt) continue;
    const day = manilaDay(o.paidAt);
    const d = days.get(day) ?? { day, orders: 0, sold: 0, fees: 0, net: 0, posted: "" };
    days.set(day, { day, orders: d.orders + 1, sold: cents(d.sold + o.total), fees: cents(d.fees + (o.payFee ?? 0)), net: cents(d.net + (o.payNet ?? o.total)), posted: d.posted || o.postedSourceId });
  }
  return [...days.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
}

export interface ProductSales {
  name: string;
  option: string;
  qty: number;
  sales: number;
  /** Null when a line of it was sold without a recorded cost. */
  cost: number | null;
}

/** What was sold, by item, best seller first. */
export function soldByItem(sold: Pick<ShopOrder, "id">[], items: Pick<ShopOrderItem, "orderId" | "name" | "option" | "qty" | "unitCost" | "lineTotal">[]): ProductSales[] {
  const ids = new Set(sold.map((o) => o.id));
  const out = new Map<string, ProductSales>();
  for (const i of items) {
    if (!ids.has(i.orderId)) continue;
    const key = `${i.name}|${i.option}`;
    const p = out.get(key) ?? { name: i.name, option: i.option, qty: 0, sales: 0, cost: 0 };
    out.set(key, { ...p, qty: p.qty + i.qty, sales: cents(p.sales + i.lineTotal), cost: p.cost == null || i.unitCost == null ? null : cents(p.cost + i.unitCost * i.qty) });
  }
  return [...out.values()].sort((a, b) => b.sales - a.sales || a.name.localeCompare(b.name));
}

/** The delivery address on one line, for a list or a packing slip. */
export const addressOf = (o: Pick<ShopOrder, "addressLine" | "barangay" | "city" | "province" | "postalCode">): string =>
  [o.addressLine, o.barangay ? `Brgy. ${o.barangay}` : "", o.city, o.province, o.postalCode].filter(Boolean).join(", ");

/** A payment method as the payment partner names it, in the words staff and customers know. */
export function payMethodLabel(method: string): string {
  const known: Record<string, string> = { qrph: "QR Ph", gcash: "GCash", paymaya: "Maya", maya: "Maya", card: "Card", grab_pay: "GrabPay", dob: "Online banking", shopee_pay: "ShopeePay", billease: "BillEase" };
  const m = method.toLowerCase();
  return known[m] ?? (m ? m.replace(/_/g, " ") : "Online payment");
}

/** A courier's name as staff may type it in Shop settings. */
export const COURIER_NAME_RE = /^[A-Za-z0-9&.' -]{2,40}$/;

// ---- Customers (0160) ----
// A customer of the shop site is never an ArkOS account: these are the shop's own records, managed here.

export type ShopCustomerStatus = "active" | "blocked" | "closed";

export interface ShopCustomer {
  id: string;
  /** The sign-in address. A closed account has none left. */
  email: string;
  name: string;
  phone: string;
  area: string;
  province: string;
  city: string;
  barangay: string;
  postalCode: string;
  addressLine: string;
  landmark: string;
  status: ShopCustomerStatus;
  statusAt: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  signInCount: number;
}

export interface ShopCustomerEvent {
  id: string;
  event: string;
  detail: string;
  byStaffId: string | null;
  at: string;
}

export type CustomerStep = "block" | "unblock" | "sign_out" | "close" | "edit";

/** A gift made from a customer's account on the shop site (0161). A paid, live one is also in Donors. */
export interface ShopGift {
  id: string;
  /** The shop's own reference (LAF-GFT-2026-00001): what the payment partner shows. Not a receipt number. */
  reference: string;
  customerId: string;
  amount: number;
  /** The giver asked not to be named: the gift is under the anonymous donor in Donors. */
  anonymous: boolean;
  status: "pending" | "paid" | "expired";
  createdAt: string;
  paidAt: string | null;
  payMethod: string;
  payFee: number | null;
  /** False for a payment made with the partner's test keys: never in Donors, never counted. */
  live: boolean;
  /** The LAF-CSH acknowledgment receipt, once the gift is in Donors. */
  receiptNo: string;
  attention: string;
}

/** A gift that counts: paid, with real money. */
export const isGiven = (g: Pick<ShopGift, "status" | "live">): boolean => g.status === "paid" && g.live;

export const GIFT_METHOD_LABEL: Record<string, string> = { gcash: "GCash", qrph: "QR Ph", card: "Card", paymaya: "Maya", maya: "Maya", grab_pay: "GrabPay" };

/**
 * The Giving card of Shop settings, read as figures: up to six amounts to offer, the smallest and the largest
 * gift. The database holds the same rules (settings_giving_check).
 */
export function readGiving(boxes: string[], minText: string, maxText: string): { ok: true; amounts: number[]; min: number; max: number } | { ok: false; error: string } {
  const min = readAmount(minText);
  const max = readAmount(maxText);
  if (min === null || max === null || min < 1 || max < min || max > 1_000_000) return { ok: false, error: "Give the smallest and the largest gift in pesos; the largest cannot be below the smallest." };
  const typed = boxes.map((b) => b.trim()).filter(Boolean).map(readAmount);
  if (!typed.length || typed.length > 6 || typed.some((a) => a === null)) return { ok: false, error: "Give one to six amounts to offer, in pesos." };
  const amounts = [...new Set(typed as number[])].sort((a, b) => a - b);
  if (amounts.some((a) => a < min || a > max)) return { ok: false, error: "Each amount offered must lie between the smallest and the largest gift." };
  return { ok: true, amounts, min, max };
}

/** One line of the Customers page: a person with an account, or one who bought without one (by their address). */
export interface CustomerRow {
  /** The account's id, or "guest:<address>". */
  key: string;
  customerId: string | null;
  state: ShopCustomerStatus | "guest";
  name: string;
  email: string;
  phone: string;
  area: string;
  city: string;
  /** When the account was made; for a guest, their first order. */
  createdAt: string;
  lastSignInAt: string | null;
  /** Orders that were not left unpaid or cancelled. */
  orders: number;
  /** What they paid for (paid orders that were not refunded). */
  spent: number;
  lastOrderAt: string | null;
  lastOrderStatus: ShopOrderStatus | null;
  /** Every order of theirs, newest first. */
  orderIds: string[];
  orderNumbers: string[];
  /** Gifts from the account that were paid with real money (0161). A guest has none: giving needs an account. */
  gifts: number;
  given: number;
  lastGiftAt: string | null;
}

export const CUSTOMER_STATE_LABEL: Record<CustomerRow["state"], string> = { active: "Account", guest: "Guest", blocked: "Blocked", closed: "Closed" };

export const CUSTOMER_VIEWS = [
  { key: "with_orders", label: "With orders" },
  { key: "new", label: "Newly created" },
  { key: "donors", label: "Latest donors" },
  { key: "all", label: "All" },
] as const;
export type CustomerView = (typeof CUSTOMER_VIEWS)[number]["key"];

type CustomerOrder = Pick<ShopOrder, "id" | "number" | "status" | "name" | "email" | "phone" | "area" | "city" | "total" | "placedAt"> & { customerId: string | null };

/**
 * Everyone who has an account or has bought: each account once, with its orders, and each address that bought
 * without an account once ("Guest"). A closed account keeps its orders but shows no personal details.
 */
export function customerRows(customers: ShopCustomer[], orders: CustomerOrder[], gifts: Pick<ShopGift, "customerId" | "amount" | "status" | "live" | "paidAt" | "createdAt">[] = []): CustomerRow[] {
  const given = new Map<string, typeof gifts>();
  for (const g of gifts) if (isGiven(g)) given.set(g.customerId, [...(given.get(g.customerId) ?? []), g]);
  const giving = (customerId: string | null) => {
    const list = customerId ? (given.get(customerId) ?? []) : [];
    return { gifts: list.length, given: cents(list.reduce((n, g) => n + g.amount, 0)), lastGiftAt: list.map((g) => g.paidAt ?? g.createdAt).sort().pop() ?? null };
  };
  const newest = (list: CustomerOrder[]) => [...list].sort((a, b) => b.placedAt.localeCompare(a.placedAt));
  const figures = (list: CustomerOrder[]) => {
    const sorted = newest(list);
    return {
      orders: sorted.filter((o) => o.status !== "expired" && o.status !== "cancelled").length,
      spent: cents(sorted.filter(isSold).reduce((n, o) => n + o.total, 0)),
      lastOrderAt: sorted[0]?.placedAt ?? null,
      lastOrderStatus: sorted[0]?.status ?? null,
      orderIds: sorted.map((o) => o.id),
      orderNumbers: sorted.map((o) => o.number),
    };
  };
  const mine = new Map<string, CustomerOrder[]>();
  const guests = new Map<string, CustomerOrder[]>();
  for (const o of orders) {
    const [map, key] = o.customerId ? [mine, o.customerId] : [guests, o.email.trim().toLowerCase()];
    map.set(key, [...(map.get(key) ?? []), o]);
  }
  const accounts: CustomerRow[] = customers.map((c) => ({
    key: c.id,
    customerId: c.id,
    state: c.status,
    name: c.status === "closed" ? "" : c.name,
    email: c.status === "closed" ? "" : c.email,
    phone: c.phone,
    area: c.area,
    city: c.city,
    createdAt: c.createdAt,
    lastSignInAt: c.lastSignInAt,
    ...figures(mine.get(c.id) ?? []),
    ...giving(c.id),
  }));
  const walkIns: CustomerRow[] = [...guests].map(([email, list]) => {
    const sorted = newest(list);
    const latest = sorted[0]!;
    return {
      key: `guest:${email}`,
      customerId: null,
      state: "guest",
      name: latest.name,
      email,
      phone: latest.phone,
      area: latest.area,
      city: latest.city,
      createdAt: sorted[sorted.length - 1]!.placedAt,
      lastSignInAt: null,
      ...figures(list),
      ...giving(null),
    };
  });
  return [...accounts, ...walkIns];
}

/** The date a view is about: the latest order, when the account was made, the latest gift. */
export const customerViewDate = (r: CustomerRow, view: CustomerView): string | null =>
  view === "with_orders" ? r.lastOrderAt : view === "donors" ? r.lastGiftAt : view === "new" ? r.createdAt : [r.lastOrderAt, r.lastSignInAt, r.createdAt].filter((d): d is string => !!d).sort().pop() ?? null;

/**
 * The rows of one view, newest first by that view's date: "With orders" is everyone who has ordered, "Newly
 * created" the accounts (not guests, not closed ones), "Latest donors" those who gave, "All" everyone.
 */
export function customersIn(rows: CustomerRow[], view: CustomerView): CustomerRow[] {
  const kept = rows.filter((r) => (view === "with_orders" ? r.orders > 0 : view === "new" ? r.customerId !== null && r.state !== "closed" : view === "donors" ? r.gifts > 0 : true));
  return kept.sort((a, b) => (customerViewDate(b, view) ?? "").localeCompare(customerViewDate(a, view) ?? "") || a.key.localeCompare(b.key));
}

/** True when a row matches what was typed: a name, an address, a mobile number or an order number. */
export function customerMatches(r: CustomerRow, term: string): boolean {
  const t = term.trim().toLowerCase();
  return !t || [r.name, r.email, r.phone, ...r.orderNumbers].some((v) => v.toLowerCase().includes(t));
}

/** How a customer's trail reads. */
export const CUSTOMER_EVENT_LABEL: Record<string, string> = {
  created: "Account created",
  signed_in: "Signed in",
  signed_out: "Signed out",
  signed_out_everywhere: "Signed out of every device",
  details_changed: "Details changed",
  gift: "Gave a gift",
  email_changed: "Sign-in address changed",
  blocked: "Sign-in blocked",
  unblocked: "Sign-in unblocked",
  closed: "Account closed",
};
