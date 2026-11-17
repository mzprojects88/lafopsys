"use client";

import * as React from "react";
import { ImagePlus, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { shopPhotoUrl, useShopData, type ProductDraft, type VariantDraft } from "@/lib/hooks/use-shop-collection";
import { SKU_RE, SLUG_RE, STATUS_LABEL, STOCK_REASONS, leftToSell, marginOf, publishProblems, readAmount, recountChange, skuFor, slugFor, type ShopStatus, type ShopSupply, type ShopVariant, type StockReason } from "@/lib/utils/shop";
import { formatPesoCents } from "@/lib/utils/vehicle-expenses";

const BLANK: ProductDraft = { slug: "", name: "", category: "", collection: "", description: "", details: "", supply: "stock", leadMin: 7, leadMax: 10, weightGrams: 0, badge: "", status: "draft", sort: 0 };
const NONE = "__none__";
const whole = (text: string, max: number): number | null => (/^\d{1,6}$/.test(text.trim()) && Number(text) <= max ? Number(text) : null);

type ItemForm = { id: string | null; colour: string; size: string; price: string; cost: string; reorderAt: string; sku: string; skuTouched: boolean; active: boolean; sort: number };
type StockForm = { variant: ShopVariant; reason: StockReason; amount: string; note: string };

/**
 * One product of the Shop (0155): its details, its items (one colour and size each, with price and count) and its
 * photos. A new product is saved first, then its items and photos are added. Render with a `key` of the product id
 * so the form starts fresh for each product.
 */
export function ProductDialog({ productId, canEdit, onClose, onCreated }: { productId: string | null; canEdit: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const shop = useShopData();
  const product = productId ? shop.products.find((p) => p.id === productId) ?? null : null;
  const items = productId ? shop.variants.filter((v) => v.productId === productId) : [];
  const photos = productId ? shop.photos.filter((f) => f.productId === productId) : [];

  const [tab, setTab] = React.useState("details");
  const [draft, setDraft] = React.useState<ProductDraft>(() => (product ? { ...product } : { ...BLANK, sort: shop.products.length }));
  const [slugTouched, setSlugTouched] = React.useState(!!product);
  const [busy, setBusy] = React.useState(false);
  const [item, setItem] = React.useState<ItemForm | null>(null);
  const [stock, setStock] = React.useState<StockForm | null>(null);
  const [confirmRemove, setConfirmRemove] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);

  const set = <K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const problems = product ? publishProblems(draft, items, photos) : [];
  const run = async (work: () => Promise<{ ok: true } | { ok: false; error: string }>, okText: string): Promise<boolean> => {
    setBusy(true);
    const r = await work();
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error);
      return false;
    }
    toast.success(okText);
    return true;
  };

  async function saveDetails() {
    const slug = draft.slug.trim();
    if (draft.name.trim().length < 2) return void toast.error("Give the product a name.");
    if (!SLUG_RE.test(slug) || slug.length < 2) return void toast.error("The address may hold small letters, numbers and dashes only.");
    if (!draft.category) return void toast.error("Choose a category.");
    if (draft.leadMax < draft.leadMin) return void toast.error("The longest wait can't be shorter than the shortest.");
    setBusy(true);
    const r = await shop.saveProduct(productId, { ...draft, slug });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success(productId ? "Product saved" : "Product added. Now add its items and photos.");
    if (!productId && r.id) onCreated(r.id);
  }

  const blankItem = (): ItemForm => ({ id: null, colour: "", size: "", price: items[0] ? String(items[0].price) : "", cost: items[0]?.cost != null ? String(items[0].cost) : "", reorderAt: "0", sku: "", skuTouched: false, active: true, sort: items.length });
  const editItem = (v: ShopVariant): ItemForm => ({ id: v.id, colour: v.colour, size: v.size, price: String(v.price), cost: v.cost == null ? "" : String(v.cost), reorderAt: String(v.reorderAt), sku: v.sku, skuTouched: true, active: v.active, sort: v.sort });
  const skuOf = (f: ItemForm) => (f.skuTouched ? f.sku.trim().toUpperCase() : skuFor(product?.slug ?? "", f.colour, f.size));

  async function saveItem() {
    if (!item || !product) return;
    const price = readAmount(item.price);
    const cost = item.cost.trim() ? readAmount(item.cost) : null;
    const reorderAt = whole(item.reorderAt || "0", 100000);
    const sku = skuOf(item);
    if (price == null || price <= 0) return void toast.error("Enter the selling price.");
    if (item.cost.trim() && cost == null) return void toast.error("The cost must be a plain amount, or left empty.");
    if (reorderAt == null) return void toast.error("The reorder point is a whole number.");
    if (!SKU_RE.test(sku) || sku.length < 3) return void toast.error("The item code may hold capital letters, numbers and dashes only.");
    const body: VariantDraft = { sku, colour: item.colour, size: item.size, price, cost, reorderAt, active: item.active, sort: item.sort };
    if (await run(() => shop.saveVariant(item.id, product.id, body), item.id ? "Item saved" : "Item added")) setItem(null);
  }

  async function saveStock() {
    if (!stock) return;
    const n = whole(stock.amount, 100000);
    if (n == null) return void toast.error("Enter a whole number of pieces.");
    const rule = STOCK_REASONS.find((r) => r.value === stock.reason)!;
    const qty = rule.adds === null ? recountChange(stock.variant.stock, n) : rule.adds ? n : -n;
    if (qty === 0) return void toast.error(rule.adds === null ? "The count is already that number." : "Enter how many pieces.");
    if (await run(() => shop.changeStock(stock.variant.id, qty, stock.reason, stock.note), "Stock updated")) setStock(null);
  }

  async function addPhotos(files: FileList | null) {
    if (!files?.length || !product) return;
    setBusy(true);
    let added = 0;
    for (const file of Array.from(files).slice(0, 8)) {
      const r = await shop.addPhoto(product, file, "", photos.length + added);
      if (!r.ok) {
        toast.error(`${file.name}: ${r.error}`);
        break;
      }
      added++;
    }
    setBusy(false);
    if (fileInput.current) fileInput.current.value = "";
    if (added) toast.success(added === 1 ? "Photo added" : `${added} photos added`);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{product ? product.name : "Add a product"}</DialogTitle>
          <DialogDescription>
            {product ? (problems.length ? `Not on the site yet: ${problems.join(", ").toLowerCase()}.` : "On the site now.") : "Save the details first; then add its items (colours and sizes) and photos."}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="items" disabled={!product}>Items and stock{product ? ` (${items.length})` : ""}</TabsTrigger>
            <TabsTrigger value="photos" disabled={!product}>Photos{product ? ` (${photos.length})` : ""}</TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="mt-4 flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="shop-name">Name</FieldLabel>
                <Input id="shop-name" value={draft.name} maxLength={120} disabled={!canEdit} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value, slug: slugTouched ? d.slug : slugFor(e.target.value) }))} />
              </Field>
              <Field>
                <FieldLabel htmlFor="shop-slug">Address on the site</FieldLabel>
                <Input id="shop-slug" value={draft.slug} maxLength={80} disabled={!canEdit} onChange={(e) => { setSlugTouched(true); set("slug", e.target.value.toLowerCase()); }} />
                <FieldDescription>shop.littlearkfoundation.org/products/{draft.slug || "…"}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="shop-category">Category</FieldLabel>
                <Select value={draft.category || undefined} onValueChange={(v) => set("category", v)} disabled={!canEdit}>
                  <SelectTrigger id="shop-category" className="w-full"><SelectValue placeholder="Choose" /></SelectTrigger>
                  <SelectContent>
                    {[...new Set([...shop.settings.categories, ...(draft.category ? [draft.category] : [])])].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="shop-collection">Collection</FieldLabel>
                <Select value={draft.collection || NONE} onValueChange={(v) => set("collection", v === NONE ? "" : v)} disabled={!canEdit}>
                  <SelectTrigger id="shop-collection" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {[...new Set([...shop.settings.collections, ...(draft.collection ? [draft.collection] : [])])].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="shop-description">Description</FieldLabel>
              <Textarea id="shop-description" rows={3} maxLength={2000} value={draft.description} disabled={!canEdit} onChange={(e) => set("description", e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="shop-details">Details (material, size, care)</FieldLabel>
              <Textarea id="shop-details" rows={2} maxLength={2000} value={draft.details} disabled={!canEdit} onChange={(e) => set("details", e.target.value)} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field>
                <FieldLabel htmlFor="shop-supply">How it is supplied</FieldLabel>
                <Select value={draft.supply} onValueChange={(v) => set("supply", v as ShopSupply)} disabled={!canEdit}>
                  <SelectTrigger id="shop-supply" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="stock">Counted stock at the house</SelectItem>
                    <SelectItem value="made">Made to order</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="shop-weight">Weight packed, in grams</FieldLabel>
                <Input id="shop-weight" inputMode="numeric" value={String(draft.weightGrams)} disabled={!canEdit} onChange={(e) => set("weightGrams", whole(e.target.value || "0", 50000) ?? draft.weightGrams)} />
                <FieldDescription>Sets the delivery fee.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="shop-status">On the site</FieldLabel>
                <Select value={draft.status} onValueChange={(v) => set("status", v as ShopStatus)} disabled={!canEdit}>
                  <SelectTrigger id="shop-status" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(STATUS_LABEL) as ShopStatus[]).map((s) => <SelectItem key={s} value={s}>{s === "published" ? "Show on the site" : STATUS_LABEL[s]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              {draft.supply === "made" ? (
                <>
                  <Field>
                    <FieldLabel htmlFor="shop-lead-min">Ships after, days (shortest)</FieldLabel>
                    <Input id="shop-lead-min" inputMode="numeric" value={String(draft.leadMin)} disabled={!canEdit} onChange={(e) => set("leadMin", whole(e.target.value || "0", 90) ?? draft.leadMin)} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="shop-lead-max">Ships after, days (longest)</FieldLabel>
                    <Input id="shop-lead-max" inputMode="numeric" value={String(draft.leadMax)} disabled={!canEdit} onChange={(e) => set("leadMax", whole(e.target.value || "0", 120) ?? draft.leadMax)} />
                  </Field>
                </>
              ) : null}
              <Field>
                <FieldLabel htmlFor="shop-badge">Label on the picture (optional)</FieldLabel>
                <Input id="shop-badge" value={draft.badge} maxLength={24} placeholder="Best seller, New…" disabled={!canEdit} onChange={(e) => set("badge", e.target.value)} />
              </Field>
            </div>
            {canEdit ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                {product ? (
                  confirmRemove ? (
                    <span className="flex flex-wrap items-center gap-2 text-theme-sm">
                      Remove this product with its items and photos?
                      <Button size="sm" variant="destructive" disabled={busy} onClick={async () => { if (await run(() => shop.removeProduct(product.id), "Product removed")) onClose(); }}>Yes, remove it</Button>
                      <Button size="sm" variant="outline" onClick={() => setConfirmRemove(false)}>Keep it</Button>
                    </span>
                  ) : (
                    <Button variant="ghost" className="text-destructive" onClick={() => setConfirmRemove(true)}>Remove product</Button>
                  )
                ) : <span />}
                <Button disabled={busy} onClick={saveDetails}>{product ? "Save details" : "Save and continue"}</Button>
              </div>
            ) : null}
          </TabsContent>

          <TabsContent value="items" className="mt-4 flex flex-col gap-4">
            {items.length ? (
              <div className="overflow-x-auto rounded-xl border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead className="text-right">Earns</TableHead>
                      <TableHead className="text-right">{draft.supply === "stock" ? "On the shelf" : "Count"}</TableHead>
                      <TableHead>On sale</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((v) => {
                      const earns = marginOf(v);
                      return (
                        <TableRow key={v.id}>
                          <TableCell>
                            <div className="font-medium">{[v.colour, v.size].filter(Boolean).join(", ") || "One option"}</div>
                            <div className="text-theme-xs text-muted-foreground">{v.sku}</div>
                          </TableCell>
                          <TableCell className="text-right">{formatPesoCents(v.price)}</TableCell>
                          <TableCell className="text-right">{v.cost == null ? "—" : formatPesoCents(v.cost)}</TableCell>
                          <TableCell className="text-right">{earns == null ? "—" : formatPesoCents(earns)}</TableCell>
                          <TableCell className="text-right">
                            {draft.supply === "stock" ? (
                              <span className="inline-flex items-center gap-2">
                                {v.stock}
                                {v.held ? <span className="text-theme-xs text-muted-foreground">({v.held} held)</span> : null}
                                {v.active && leftToSell(v) <= v.reorderAt ? <Badge variant="destructive">{leftToSell(v) === 0 ? "Out" : "Low"}</Badge> : null}
                              </span>
                            ) : "Made to order"}
                          </TableCell>
                          <TableCell>
                            <Switch checked={v.active} disabled={!canEdit || busy} aria-label={`${v.sku} on sale`} onCheckedChange={(on) => void run(() => shop.saveVariant(v.id, v.productId, { ...v, active: on }), on ? "Item on sale" : "Item taken off sale")} />
                          </TableCell>
                          <TableCell className="text-right">
                            {canEdit ? (
                              <span className="inline-flex gap-1">
                                {draft.supply === "stock" ? <Button size="sm" variant="outline" className="h-7" onClick={() => setStock({ variant: v, reason: "received", amount: "", note: "" })}>Stock</Button> : null}
                                <Button size="sm" variant="ghost" className="h-7" aria-label={`Edit ${v.sku}`} onClick={() => setItem(editItem(v))}><Pencil className="size-3.5" /></Button>
                                <Button size="sm" variant="ghost" className="h-7 text-destructive" aria-label={`Remove ${v.sku}`} disabled={busy || v.stock > 0} title={v.stock > 0 ? "Take the stock to zero first" : undefined} onClick={() => void run(() => shop.removeVariant(v.id), "Item removed")}><Trash2 className="size-3.5" /></Button>
                              </span>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-theme-sm text-muted-foreground">No item yet. A product needs at least one: a T-shirt has one per size; a mug has just one.</p>
            )}

            {stock ? (
              <div className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-4">
                <div className="sm:col-span-4 text-theme-sm font-medium">Change the count of {stock.variant.sku} (now {stock.variant.stock})</div>
                <Field className="sm:col-span-2">
                  <FieldLabel htmlFor="shop-stock-reason">Why</FieldLabel>
                  <Select value={stock.reason} onValueChange={(v) => setStock({ ...stock, reason: v as StockReason })}>
                    <SelectTrigger id="shop-stock-reason" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{STOCK_REASONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="shop-stock-amount">{stock.reason === "count" ? "Counted now" : "Pieces"}</FieldLabel>
                  <Input id="shop-stock-amount" inputMode="numeric" value={stock.amount} onChange={(e) => setStock({ ...stock, amount: e.target.value })} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="shop-stock-note">Note (optional)</FieldLabel>
                  <Input id="shop-stock-note" maxLength={300} value={stock.note} onChange={(e) => setStock({ ...stock, note: e.target.value })} />
                </Field>
                <div className="flex gap-2 sm:col-span-4">
                  <Button disabled={busy} onClick={saveStock}>Save the count</Button>
                  <Button variant="outline" onClick={() => setStock(null)}>Cancel</Button>
                </div>
              </div>
            ) : null}

            {item ? (
              <div className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-3">
                <div className="sm:col-span-3 text-theme-sm font-medium">{item.id ? "Edit the item" : "Add an item"}</div>
                <Field>
                  <FieldLabel htmlFor="shop-item-colour">Colour (optional)</FieldLabel>
                  <Input id="shop-item-colour" maxLength={40} value={item.colour} onChange={(e) => setItem({ ...item, colour: e.target.value })} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="shop-item-size">Size (optional)</FieldLabel>
                  <Input id="shop-item-size" maxLength={20} value={item.size} onChange={(e) => setItem({ ...item, size: e.target.value })} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="shop-item-sku">Item code</FieldLabel>
                  <Input id="shop-item-sku" maxLength={40} value={skuOf(item)} onChange={(e) => setItem({ ...item, sku: e.target.value.toUpperCase(), skuTouched: true })} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="shop-item-price">Selling price, ₱</FieldLabel>
                  <Input id="shop-item-price" inputMode="decimal" value={item.price} onChange={(e) => setItem({ ...item, price: e.target.value })} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="shop-item-cost">Cost per piece, ₱ (optional)</FieldLabel>
                  <Input id="shop-item-cost" inputMode="decimal" value={item.cost} onChange={(e) => setItem({ ...item, cost: e.target.value })} />
                  <FieldDescription>Never shown on the site.</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="shop-item-reorder">Reorder when this few are left</FieldLabel>
                  <Input id="shop-item-reorder" inputMode="numeric" value={item.reorderAt} onChange={(e) => setItem({ ...item, reorderAt: e.target.value })} />
                </Field>
                <div className="flex gap-2 sm:col-span-3">
                  <Button disabled={busy} onClick={saveItem}>{item.id ? "Save the item" : "Add the item"}</Button>
                  <Button variant="outline" onClick={() => setItem(null)}>Cancel</Button>
                </div>
              </div>
            ) : canEdit && !stock ? (
              <div><Button variant="outline" onClick={() => setItem(blankItem())}><Plus className="size-4" />Add an item</Button></div>
            ) : null}
          </TabsContent>

          <TabsContent value="photos" className="mt-4 flex flex-col gap-4">
            {photos.length ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {photos.map((f, i) => (
                  <div key={f.id} className="flex flex-col gap-2 rounded-xl border border-border p-2">
                    <img src={shopPhotoUrl(f.path)} alt={f.alt} className="aspect-square w-full rounded-lg bg-white object-contain" />
                    <Input aria-label="What this photo shows" placeholder={i === 0 ? "Main photo" : "Front, Back…"} maxLength={30} defaultValue={f.label} disabled={!canEdit} onBlur={(e) => { if (e.target.value.trim() !== f.label) void run(() => shop.savePhoto(f.id, { label: e.target.value }), "Photo saved"); }} />
                    {canEdit ? (
                      <div className="flex items-center justify-between">
                        <Button size="sm" variant="ghost" className="h-7" disabled={busy || i === 0} onClick={() => void run(async () => { const a = await shop.savePhoto(f.id, { sort: photos[i - 1]!.sort }); return a.ok ? shop.savePhoto(photos[i - 1]!.id, { sort: f.sort === photos[i - 1]!.sort ? f.sort + 1 : f.sort }) : a; }, "Photo moved")}>Move first</Button>
                        <Button size="sm" variant="ghost" className="h-7 text-destructive" aria-label="Remove this photo" disabled={busy} onClick={() => void run(() => shop.removePhoto(f), "Photo removed")}><Trash2 className="size-3.5" /></Button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-theme-sm text-muted-foreground">No photo yet. The first photo is the one shown in the product list.</p>
            )}
            {canEdit ? (
              <div className="flex flex-wrap items-center gap-3">
                <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" id="shop-photo-files" onChange={(e) => void addPhotos(e.target.files)} />
                <Button variant="outline" disabled={busy} onClick={() => fileInput.current?.click()}><ImagePlus className="size-4" />Add photos</Button>
                <span className="text-theme-xs text-muted-foreground">JPG, PNG or WebP on a plain background. Each is shrunk to 1,200 px. These photos are public.</span>
              </div>
            ) : null}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
