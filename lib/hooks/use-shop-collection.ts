"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import { shrinkImage } from "@/lib/utils/shrink-image";
import type { DeliveryArea, ShopDeliveryFee, ShopPhoto, ShopProduct, ShopSettings, ShopStatus, ShopSupply, ShopVariant, StockReason } from "@/lib/utils/shop";

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

const BLANK_SETTINGS: ShopSettings = { shopOpen: false, packMin: 1, packMax: 2, pickupEnabled: true, pickupAddress: "", pickupNote: "", categories: [], collections: [] };

export const shopSettingsStore = createCollection<ShopSettings>({
  key: "shop.settings",
  empty: BLANK_SETTINGS,
  tables: [{ schema: "shop", table: "settings" }],
  fetch: async () => {
    const { data, error } = await shop().from("settings").select("shop_open, pack_min, pack_max, pickup_enabled, pickup_address, pickup_note, categories, collections").maybeSingle();
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
            .update({ shop_open: s.shopOpen, pack_min: s.packMin, pack_max: s.packMax, pickup_enabled: s.pickupEnabled, pickup_address: s.pickupAddress.trim(), pickup_note: s.pickupNote.trim(), categories: s.categories, collections: s.collections })
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
