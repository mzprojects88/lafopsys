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
