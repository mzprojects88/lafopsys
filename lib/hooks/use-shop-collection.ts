"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import { shrinkImage } from "@/lib/utils/shrink-image";
import { fetchAll } from "@/lib/supabase/fetch-all";
import type { CustomerStep, DeliveryArea, OrderStep, ShopCustomer, ShopCustomerEvent, ShopCustomerStatus, ShopDeliveryFee, ShopGift, ShopOrder, ShopOrderEvent, ShopOrderItem, ShopOrderStatus, ShopPhoto, ShopProduct, ShopSettings, ShopStatus, ShopSupply, ShopVariant, StockReason } from "@/lib/utils/shop";

export type MutationResult = { ok: true } | { ok: false; error: string };

const shop = () => createClient().schema("shop");
const bucket = () => createClient().storage.from("shop");
const num = (v: number | string | null | undefined) => Number(v ?? 0);

/** The address of a product photo in the public `shop` bucket. */
export const shopPhotoUrl = (path: string): string => bucket().getPublicUrl(path).data.publicUrl;

/** shop.products (0155). */
export const shopProductsStore = createCollection<ShopProduct[]>({
  key: "shop.products",
  empty: [],
  tables: [{ schema: "shop", table: "products" }],
  fetch: async () => {
    const { data, error } = await shop().from("products").select("id, slug, name, category, collection, description, details, supply, lead_min, lead_max, weight_grams, badge, status, sort, updated_at").order("sort").order("name");
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      id: r.id as string,
      slug: r.slug as string,
      name: r.name as string,
      category: r.category as string,
      collection: (r.collection as string | null) ?? "",
      description: (r.description as string) ?? "",
      details: (r.details as string) ?? "",
      supply: r.supply as ShopSupply,
      leadMin: num(r.lead_min),
      leadMax: num(r.lead_max),
      weightGrams: num(r.weight_grams),
      badge: (r.badge as string | null) ?? "",
      status: r.status as ShopStatus,
      sort: num(r.sort),
      updatedAt: r.updated_at as string,
    }));
  },
});

/** shop.variants: every item (one colour and size of a product), with its price and count. */
export const shopVariantsStore = createCollection<ShopVariant[]>({
  key: "shop.variants",
  empty: [],
  tables: [{ schema: "shop", table: "variants" }],
  fetch: async () => {
    const { data, error } = await shop().from("variants").select("id, product_id, sku, colour, size, price, cost, stock, held, reorder_at, active, sort").order("sort").order("sku");
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      id: r.id as string,
      productId: r.product_id as string,
      sku: r.sku as string,
      colour: (r.colour as string | null) ?? "",
      size: (r.size as string | null) ?? "",
      price: num(r.price),
      cost: r.cost == null ? null : num(r.cost),
      stock: num(r.stock),
      held: num(r.held),
      reorderAt: num(r.reorder_at),
      active: r.active !== false,
      sort: num(r.sort),
    }));
  },
});

export const shopPhotosStore = createCollection<ShopPhoto[]>({
  key: "shop.photos",
  empty: [],
  tables: [{ schema: "shop", table: "photos" }],
  fetch: async () => {
    const { data, error } = await shop().from("photos").select("id, product_id, path, label, alt, sort").order("sort").order("created_at");
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({ id: r.id as string, productId: r.product_id as string, path: r.path as string, label: (r.label as string | null) ?? "", alt: (r.alt as string) ?? "", sort: num(r.sort) }));
  },
});

const BLANK_SETTINGS: ShopSettings = { shopOpen: false, packMin: 1, packMax: 2, pickupEnabled: true, pickupAddress: "", pickupNote: "", categories: [], collections: [], couriers: [], siteUrl: "", cashPosting: false, givingOpen: false, giftAmounts: [], giftMin: 100, giftMax: 50000, termsText: "", privacyText: "", returnsText: "" };

export const shopSettingsStore = createCollection<ShopSettings>({
  key: "shop.settings",
  empty: BLANK_SETTINGS,
  tables: [{ schema: "shop", table: "settings" }],
  fetch: async () => {
    const { data, error } = await shop().from("settings").select("shop_open, pack_min, pack_max, pickup_enabled, pickup_address, pickup_note, categories, collections, couriers, site_url, cash_posting, giving_open, gift_amounts, gift_min, gift_max, terms_text, privacy_text, returns_text").maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return BLANK_SETTINGS;
    return {
      shopOpen: data.shop_open === true,
      packMin: num(data.pack_min),
      packMax: num(data.pack_max),
      pickupEnabled: data.pickup_enabled !== false,
      pickupAddress: (data.pickup_address as string) ?? "",
      pickupNote: (data.pickup_note as string) ?? "",
      categories: (data.categories as string[] | null) ?? [],
      collections: (data.collections as string[] | null) ?? [],
      couriers: (data.couriers as string[] | null) ?? [],
      siteUrl: (data.site_url as string) ?? "",
      cashPosting: data.cash_posting === true,
      givingOpen: data.giving_open === true,
      giftAmounts: ((data.gift_amounts as (number | string)[] | null) ?? []).map(Number),
      giftMin: num(data.gift_min as number),
      giftMax: num(data.gift_max as number),
      termsText: (data.terms_text as string) ?? "",
      privacyText: (data.privacy_text as string) ?? "",
      returnsText: (data.returns_text as string) ?? "",
    };
  },
});

export const shopFeesStore = createCollection<ShopDeliveryFee[]>({
  key: "shop.delivery_fees",
  empty: [],
  tables: [{ schema: "shop", table: "delivery_fees" }],
  fetch: async () => {
    const { data, error } = await shop().from("delivery_fees").select("id, area, max_grams, fee").order("area").order("max_grams");
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({ id: r.id as string, area: r.area as DeliveryArea, maxGrams: num(r.max_grams), fee: num(r.fee) }));
  },
});

const text = (v: unknown): string => (typeof v === "string" ? v : "");
const amount = (v: unknown): number | null => (v == null ? null : Number(v));

const ORDER_COLUMNS =
  "id, customer_id, number, token, status, name, email, phone, delivery, area, province, city, barangay, postal_code, address_line, landmark, weight_grams, subtotal, delivery_fee, total, placed_at, hold_until, paid_at, packed_at, shipped_at, delivered_at, closed_at, pay_method, pay_fee, pay_net, attention, courier, tracking_number, tracking_url, invoice_number, refund_reason, restocked, posted_source_id";

/** shop.orders (0156, 0157), newest first.
 * ponytail: every order is loaded; page them by period once there are a few thousand. */
export const shopOrdersStore = createCollection<ShopOrder[]>({
  key: "shop.orders",
  empty: [],
  tables: [{ schema: "shop", table: "orders" }],
  fetch: async () => {
    const rows = await fetchAll<Record<string, unknown>>((from, to) => shop().from("orders").select(ORDER_COLUMNS).order("placed_at", { ascending: false }).order("id").range(from, to));
    return rows.map((r) => ({
      id: r.id as string,
      customerId: (r.customer_id as string | null) ?? null,
      number: r.number as string,
      token: r.token as string,
      status: r.status as ShopOrderStatus,
      name: text(r.name),
      email: text(r.email),
      phone: text(r.phone),
      delivery: r.delivery === "pickup" ? "pickup" : "courier",
      area: text(r.area),
      province: text(r.province),
      city: text(r.city),
      barangay: text(r.barangay),
      postalCode: text(r.postal_code),
      addressLine: text(r.address_line),
      landmark: text(r.landmark),
      weightGrams: num(r.weight_grams as number),
      subtotal: num(r.subtotal as number),
      deliveryFee: num(r.delivery_fee as number),
      total: num(r.total as number),
      placedAt: r.placed_at as string,
      holdUntil: r.hold_until as string,
      paidAt: (r.paid_at as string | null) ?? null,
      packedAt: (r.packed_at as string | null) ?? null,
      shippedAt: (r.shipped_at as string | null) ?? null,
      deliveredAt: (r.delivered_at as string | null) ?? null,
      closedAt: (r.closed_at as string | null) ?? null,
      payMethod: text(r.pay_method),
      payFee: amount(r.pay_fee),
      payNet: amount(r.pay_net),
      attention: text(r.attention),
      courier: text(r.courier),
      trackingNumber: text(r.tracking_number),
      trackingUrl: text(r.tracking_url),
      invoiceNumber: text(r.invoice_number),
      refundReason: text(r.refund_reason),
      restocked: (r.restocked as boolean | null) ?? null,
      postedSourceId: text(r.posted_source_id),
    }));
  },
});

/** shop.order_items: what each order bought, as it was at that moment. */
export const shopOrderItemsStore = createCollection<ShopOrderItem[]>({
  key: "shop.order_items",
  empty: [],
  tables: [{ schema: "shop", table: "order_items" }],
  fetch: async () => {
    const rows = await fetchAll<Record<string, unknown>>((from, to) => shop().from("order_items").select("id, order_id, sku, name, option, counted, qty, unit_price, unit_cost, line_total, sort").order("order_id").order("sort").order("id").range(from, to));
    return rows.map((r) => ({
      id: r.id as string,
      orderId: r.order_id as string,
      sku: text(r.sku),
      name: text(r.name),
      option: text(r.option),
      counted: r.counted === true,
      qty: num(r.qty as number),
      unitPrice: num(r.unit_price as number),
      unitCost: amount(r.unit_cost),
      lineTotal: num(r.line_total as number),
    }));
  },
});

/** shop.customers (0160): the accounts of the shop site's customers. A customer is never an ArkOS account, and
 * no code, session or password is among these columns: staff cannot read those at all. */
export const shopCustomersStore = createCollection<ShopCustomer[]>({
  key: "shop.customers",
  empty: [],
  tables: [{ schema: "shop", table: "customers" }],
  fetch: async () => {
    const rows = await fetchAll<Record<string, unknown>>((from, to) =>
      shop().from("customers").select("id, email, name, phone, area, province, city, barangay, postal_code, address_line, landmark, status, status_at, created_at, last_sign_in_at, sign_in_count").order("created_at", { ascending: false }).order("id").range(from, to),
    );
    return rows.map((r) => ({
      id: r.id as string,
      email: text(r.email),
      name: text(r.name),
      phone: text(r.phone),
      area: text(r.area),
      province: text(r.province),
      city: text(r.city),
      barangay: text(r.barangay),
      postalCode: text(r.postal_code),
      addressLine: text(r.address_line),
      landmark: text(r.landmark),
      status: r.status as ShopCustomerStatus,
      statusAt: (r.status_at as string | null) ?? null,
      createdAt: r.created_at as string,
      lastSignInAt: (r.last_sign_in_at as string | null) ?? null,
      signInCount: num(r.sign_in_count as number),
    }));
  },
});

/** shop.gifts (0161): the gifts customers made from their accounts. A paid one made with real money is also in
 * Donors, with the receipt number shown here. Nothing here can be changed from the browser. */
export const shopGiftsStore = createCollection<ShopGift[]>({
  key: "shop.gifts",
  empty: [],
  tables: [{ schema: "shop", table: "gifts" }],
  fetch: async () => {
    const rows = await fetchAll<Record<string, unknown>>((from, to) =>
      shop().from("gifts").select("id, reference, customer_id, amount, anonymous, status, created_at, paid_at, pay_method, pay_fee, live, receipt_no, attention").order("created_at", { ascending: false }).order("id").range(from, to),
    );
    return rows.map((r) => ({
      id: r.id as string,
      reference: text(r.reference),
      customerId: r.customer_id as string,
      amount: num(r.amount as number),
      anonymous: r.anonymous === true,
      status: r.status as ShopGift["status"],
      createdAt: r.created_at as string,
      paidAt: (r.paid_at as string | null) ?? null,
      payMethod: text(r.pay_method),
      payFee: r.pay_fee === null || r.pay_fee === undefined ? null : num(r.pay_fee as number),
      live: r.live === true,
      receiptNo: text(r.receipt_no),
      attention: text(r.attention),
    }));
  },
});

/** Customers of the shop site with their gifts, and the steps staff take on an account (0160, 0161). */
export function useShopCustomers() {
  const { data: customers, loading: customersLoading } = useCollection(shopCustomersStore);
  const { data: gifts, loading: giftsLoading } = useCollection(shopGiftsStore);
  const loading = customersLoading || giftsLoading;
  return {
    customers,
    gifts,
    loading,
    /** One staff step on an account (block, unblock, sign_out, close, edit), through the database's function: it
     * checks the person's level and records who did it. The sign-in address is not something staff can change. */
    step: async (customerId: string, step: CustomerStep, data: Record<string, string> = {}): Promise<MutationResult> => {
      const { error } = await shop().rpc("customer_step", { p_customer: customerId, p_step: step, p_data: data });
      if (error) return { ok: false, error: /permission denied|42501/.test(error.message) ? "You can look at customers but not change them." : error.message };
      await shopCustomersStore.refetch();
      return { ok: true };
    },
    /** The trail of one account, newest first. */
    trail: async (customerId: string): Promise<ShopCustomerEvent[]> => {
      const { data } = await shop().from("customer_events").select("id, event, detail, by_staff_id, at").eq("customer_id", customerId).order("at", { ascending: false }).order("id").limit(60);
      return (data ?? []).map((r) => ({ id: r.id as string, event: text(r.event), detail: text(r.detail), byStaffId: (r.by_staff_id as string | null) ?? null, at: r.at as string }));
    },
    /** How many devices the customer is signed in on. The sessions themselves are read by nobody. */
    devices: async (customerId: string): Promise<number> => {
      const { data } = await shop().rpc("customer_devices", { p_customer: customerId });
      return Number(data ?? 0);
    },
  };
}

/** Messages the database gives for an order's steps, shortened to what staff need. */
const stepMessage = (message: string): string => (/permission denied|42501/.test(message) ? "You can look at orders but not change them." : message);

/** Orders, their lines, and the steps staff take on them (0157). */
export function useShopOrders() {
  const { data: orders, loading } = useCollection(shopOrdersStore);
  const { data: items } = useCollection(shopOrderItemsStore);
  return {
    orders,
    items,
    loading,
    /** One staff step on an order (pack, ship, ready, deliver, invoice, looked, cancel, refund), through the
     * database's function: it checks the order's state, records who did it, and queues the customer's email. */
    step: async (orderId: string, step: OrderStep, data: Record<string, string | boolean> = {}): Promise<MutationResult> => {
      const { error } = await shop().rpc("order_step", { p_order: orderId, p_step: step, p_data: data });
      if (error) return { ok: false, error: stepMessage(error.message) };
      await Promise.all([shopOrdersStore.refetch(), ...(step === "cancel" || step === "refund" ? [shopVariantsStore.refetch()] : [])]);
      return { ok: true };
    },
    /** The trail of one order, oldest first. */
    trail: async (orderId: string): Promise<ShopOrderEvent[]> => {
      const { data } = await shop().from("order_events").select("id, event, detail, by_staff_id, at").eq("order_id", orderId).order("at").order("id");
      return (data ?? []).map((r) => ({ id: r.id as string, event: text(r.event), detail: text(r.detail), byStaffId: (r.by_staff_id as string | null) ?? null, at: r.at as string }));
    },
    /** Posts one finished day's proceeds to the cash book (Finance only; off until Shop settings switch it on). */
    postDay: async (day: string): Promise<MutationResult & { posted?: number; amount?: number }> => {
      const { data, error } = await shop().rpc("post_proceeds", { p_day: day });
      if (error) return { ok: false, error: /42501|Only Finance/.test(error.message) ? "Only Finance posts shop proceeds to the cash book." : error.message };
      await shopOrdersStore.refetch();
      const r = (data ?? {}) as { posted?: number; amount?: number };
      return { ok: true, posted: Number(r.posted ?? 0), amount: Number(r.amount ?? 0) };
    },
  };
}

export type ProductDraft = Omit<ShopProduct, "id" | "updatedAt">;
export type VariantDraft = Pick<ShopVariant, "sku" | "colour" | "size" | "price" | "cost" | "reorderAt" | "active" | "sort">;

const productRow = (p: ProductDraft) => ({
  slug: p.slug.trim(),
  name: p.name.trim(),
  category: p.category.trim(),
  collection: p.collection.trim() || null,
  description: p.description.trim(),
  details: p.details.trim(),
  supply: p.supply,
  lead_min: p.leadMin,
  lead_max: p.leadMax,
  weight_grams: p.weightGrams,
  badge: p.badge.trim() || null,
  status: p.status,
  sort: p.sort,
});
const variantRow = (v: VariantDraft) => ({
  sku: v.sku.trim().toUpperCase(),
  colour: v.colour.trim() || null,
  size: v.size.trim() || null,
  price: v.price,
  cost: v.cost,
  reorder_at: v.reorderAt,
  active: v.active,
  sort: v.sort,
});

/** Messages the database gives for the catalogue's rules, in plain words. */
function plain(message: string): string {
  if (/settings_giving_check/.test(message)) return "Check the giving amounts: one to six, each between the smallest and the largest gift.";
  if (/settings_fulfilment_check/.test(message)) return "Check the shop site's address (https://…), the couriers (12 at most) and the length of the policy texts.";
  if (/products_slug_key/.test(message)) return "Another product already uses that address.";
  if (/variants_sku_key/.test(message)) return "Another item already uses that code.";
  if (/variants_one_per_option/.test(message)) return "This product already has an item in that colour and size.";
  if (/delivery_fees_area_max_grams_key/.test(message)) return "That area already has a fee for this weight.";
  if (/row-level security|permission denied/.test(message)) return "You can look at the Shop but not change it.";
  return message;
}

async function done(error: { message: string } | null, stores: { refetch: () => Promise<unknown> }[]): Promise<MutationResult> {
  if (error) return { ok: false, error: plain(error.message) };
  await Promise.all(stores.map((s) => s.refetch()));
  return { ok: true };
}

/** A data URL (from shrinkImage) as a file body. */
function blobOf(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(",");
  const bytes = Uint8Array.from(atob(b64 ?? ""), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: /^data:([^;]+)/.exec(head ?? "")?.[1] ?? "image/jpeg" });
}

export function useShopData() {
  const { data: products, loading } = useCollection(shopProductsStore);
  const { data: variants } = useCollection(shopVariantsStore);
  const { data: photos } = useCollection(shopPhotosStore);
  const { data: settings, loading: settingsLoading } = useCollection(shopSettingsStore);
  const { data: fees } = useCollection(shopFeesStore);

  return {
    products,
    variants,
    photos,
    settings,
    fees,
    loading,
    settingsLoading,

    /** Adds a product (id null) or saves one; returns the id so the caller can go on to its items and photos. */
    saveProduct: async (id: string | null, draft: ProductDraft): Promise<MutationResult & { id?: string }> => {
      const newId = id ?? crypto.randomUUID();
      const { error } = id ? await shop().from("products").update(productRow(draft)).eq("id", id) : await shop().from("products").insert({ id: newId, ...productRow(draft) });
      const r = await done(error, [shopProductsStore]);
      return r.ok ? { ok: true, id: newId } : r;
    },
    /** Removes a product with its items and photos; the photo files go too. */
    removeProduct: async (id: string): Promise<MutationResult> => {
      const paths = photos.filter((f) => f.productId === id).map((f) => f.path);
      const { error } = await shop().from("products").delete().eq("id", id);
      if (!error && paths.length) await bucket().remove(paths);
      return done(error, [shopProductsStore, shopVariantsStore, shopPhotosStore]);
    },

    saveVariant: async (id: string | null, productId: string, draft: VariantDraft): Promise<MutationResult> =>
      done(id ? (await shop().from("variants").update(variantRow(draft)).eq("id", id)).error : (await shop().from("variants").insert({ id: crypto.randomUUID(), product_id: productId, ...variantRow(draft) })).error, [shopVariantsStore]),
    removeVariant: async (id: string): Promise<MutationResult> => done((await shop().from("variants").delete().eq("id", id)).error, [shopVariantsStore]),

    /** Changes an item's count through the database's function, which records who, why and the count after. */
    changeStock: async (variantId: string, qty: number, reason: StockReason, note: string): Promise<MutationResult> =>
      done((await shop().rpc("stock_change", { p_variant: variantId, p_qty: qty, p_reason: reason, p_note: note.trim() || null })).error, [shopVariantsStore]),

    /** Shrinks a picture to at most 1,200 px, stores it in the public `shop` bucket and lists it on the product. */
    addPhoto: async (product: Pick<ShopProduct, "id" | "slug" | "name">, file: File, label: string, sort: number): Promise<MutationResult> => {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return { ok: false, error: "Choose a JPG, PNG or WebP picture." };
      let body: Blob;
      try {
        body = blobOf(await shrinkImage(file, 1200, 0.86));
      } catch {
        return { ok: false, error: "That picture couldn't be read. Try another file." };
      }
      if (body.size > 2 * 1024 * 1024) return { ok: false, error: "The picture is too large even after shrinking (2 MB at most)." };
      const path = `products/${product.slug}/${crypto.randomUUID().slice(0, 8)}.jpg`;
      const up = await bucket().upload(path, body, { contentType: "image/jpeg", cacheControl: "31536000", upsert: false });
      if (up.error) return { ok: false, error: plain(up.error.message) };
      const { error } = await shop().from("photos").insert({ product_id: product.id, path, label: label.trim() || null, alt: `${product.name}${label.trim() ? `, ${label.trim().toLowerCase()}` : ""}`.slice(0, 160), sort });
      if (error) await bucket().remove([path]);
      return done(error, [shopPhotosStore]);
    },
    savePhoto: async (id: string, patch: { label?: string; sort?: number }): Promise<MutationResult> =>
      done((await shop().from("photos").update({ ...(patch.label !== undefined ? { label: patch.label.trim() || null } : {}), ...(patch.sort !== undefined ? { sort: patch.sort } : {}) }).eq("id", id)).error, [shopPhotosStore]),
    removePhoto: async (photo: ShopPhoto): Promise<MutationResult> => {
      const { error } = await shop().from("photos").delete().eq("id", photo.id);
      if (!error) await bucket().remove([photo.path]);
      return done(error, [shopPhotosStore]);
    },

    saveSettings: async (s: ShopSettings): Promise<MutationResult> =>
      done(
        (
          await shop()
            .from("settings")
            .update({ shop_open: s.shopOpen, pack_min: s.packMin, pack_max: s.packMax, pickup_enabled: s.pickupEnabled, pickup_address: s.pickupAddress.trim(), pickup_note: s.pickupNote.trim(), categories: s.categories, collections: s.collections, couriers: s.couriers, site_url: s.siteUrl.trim().replace(/\/+$/, ""), cash_posting: s.cashPosting, giving_open: s.givingOpen, gift_amounts: s.giftAmounts, gift_min: s.giftMin, gift_max: s.giftMax, terms_text: s.termsText.trim(), privacy_text: s.privacyText.trim(), returns_text: s.returnsText.trim() })
            .eq("id", true)
        ).error,
        [shopSettingsStore],
      ),
    saveFee: async (id: string | null, fee: Omit<ShopDeliveryFee, "id">): Promise<MutationResult> =>
      done(
        id
          ? (await shop().from("delivery_fees").update({ area: fee.area, max_grams: fee.maxGrams, fee: fee.fee }).eq("id", id)).error
          : (await shop().from("delivery_fees").insert({ area: fee.area, max_grams: fee.maxGrams, fee: fee.fee })).error,
        [shopFeesStore],
      ),
    removeFee: async (id: string): Promise<MutationResult> => done((await shop().from("delivery_fees").delete().eq("id", id)).error, [shopFeesStore]),
  };
}
