"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/patterns/page-header";
import { SectionCard } from "@/components/patterns/section-card";
import { LoadingState } from "@/components/patterns/loading-state";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useShopData } from "@/lib/hooks/use-shop-collection";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import { COURIER_NAME_RE, DELIVERY_AREAS, readAmount, readGiving, type DeliveryArea, type ShopSettings } from "@/lib/utils/shop";
import { formatPesoCents } from "@/lib/utils/vehicle-expenses";

const listOf = (text: string): string[] => [...new Set(text.split(/[\n,]/).map((s) => s.trim()).filter((s) => s.length >= 2 && s.length <= 40))];
const days = (text: string, max: number): number | null => (/^\d{1,2}$/.test(text.trim()) && Number(text) <= max ? Number(text) : null);
const grams = (g: number) => (g % 1000 === 0 ? `${g / 1000} kg` : `${g.toLocaleString("en-PH")} g`);

/**
 * Shop › Shop settings (0155, 0157): whether the shop takes orders, how long packing takes, pick-up, the lists the
 * products choose from, the delivery fees by area and weight, the couriers, the texts of the site's policy pages,
 * whether proceeds may be posted to the cash book, and giving from a customer's account (0161: open or not, the
 * amounts offered, the smallest and largest gift). Every figure and text the site shows comes from here.
 */
export default function ShopSettingsPage() {
  const access = useModuleAccess();
  const canEdit = access.levelOfPath("/shop/settings") === "edit";
  const { settings, fees, settingsLoading, saveSettings, saveFee, removeFee } = useShopData();
  const [draft, setDraft] = React.useState<ShopSettings | null>(null);
  const [lists, setLists] = React.useState<{ categories: string; collections: string; couriers: string } | null>(null);
  // The Giving card's boxes as typed: six amounts to offer, the smallest and the largest gift.
  const [giving, setGiving] = React.useState<{ boxes: string[]; min: string; max: string } | null>(null);
  const [fee, setFee] = React.useState<{ area: DeliveryArea; kilos: string; fee: string }>({ area: "Metro Manila", kilos: "1", fee: "" });
  const [busy, setBusy] = React.useState(false);

  if (settingsLoading) return <LoadingState />;
  const s = draft ?? settings;
  const l = lists ?? { categories: settings.categories.join(", "), collections: settings.collections.join(", "), couriers: settings.couriers.join(", ") };
  const set = <K extends keyof ShopSettings>(key: K, value: ShopSettings[K]) => setDraft({ ...s, [key]: value });
  const g = giving ?? { boxes: Array.from({ length: 6 }, (_, i) => (settings.giftAmounts[i] === undefined ? "" : String(settings.giftAmounts[i]))), min: String(settings.giftMin), max: String(settings.giftMax) };
  const dirty = draft !== null || lists !== null || giving !== null;

  async function save() {
    const categories = listOf(l.categories);
    if (!categories.length) return void toast.error("Keep at least one category.");
    if (s.packMax < s.packMin) return void toast.error("The longest packing time can't be shorter than the shortest.");
    if (s.shopOpen && !fees.length) return void toast.error("Set the delivery fees before opening the shop.");
    if (s.shopOpen && s.pickupEnabled && !s.pickupAddress.trim()) return void toast.error("Give the pick-up address, or switch pick-up off, before opening the shop.");
    const couriers = listOf(l.couriers);
    if (couriers.length > 12 || couriers.some((c) => !COURIER_NAME_RE.test(c))) return void toast.error("List up to 12 couriers, by name only.");
    if (!/^https?:\/\/[a-z0-9.:-]+$/.test(s.siteUrl.trim().replace(/\/+$/, ""))) return void toast.error("Give the shop site's address, like https://shop.littlearkfoundation.org.");
    if (s.shopOpen && [s.termsText, s.privacyText, s.returnsText].some((t) => !t.trim())) return void toast.error("Write the terms of sale, the privacy notice and the returns text before opening the shop.");
    const gifts = readGiving(g.boxes, g.min, g.max);
    if (!gifts.ok) return void toast.error(gifts.error);
    setBusy(true);
    const r = await saveSettings({ ...s, categories, collections: listOf(l.collections), couriers, giftAmounts: gifts.amounts, giftMin: gifts.min, giftMax: gifts.max });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    setDraft(null);
    setLists(null);
    setGiving(null);
    toast.success("Shop settings saved");
  }

  async function addFee() {
    const kilos = Number(fee.kilos);
    const amount = readAmount(fee.fee);
    if (!/^\d{1,2}(\.\d{1,2})?$/.test(fee.kilos.trim()) || kilos <= 0 || kilos > 50) return void toast.error("Give the weight in kilos, up to 50.");
    if (amount == null) return void toast.error("Enter the fee as a plain amount.");
    setBusy(true);
    const r = await saveFee(null, { area: fee.area, maxGrams: Math.round(kilos * 1000), fee: amount });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    setFee({ ...fee, fee: "" });
    toast.success("Delivery fee added");
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Shop settings" description="What the shop site shows and charges: opening, packing time, pick-up, the product lists and the delivery fees." action={canEdit && dirty ? <Button disabled={busy} onClick={save}>Save settings</Button> : undefined} />

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="The shop" description="Closed, the site still shows the products but takes no orders.">
          <div className="flex flex-col gap-4 px-5 pb-5">
            <label className="flex items-center justify-between gap-4 text-theme-sm">
              <span><span className="font-medium text-foreground">The shop is open</span><br /><span className="text-muted-foreground">Needs delivery fees and, if pick-up is on, its address.</span></span>
              <Switch checked={s.shopOpen} disabled={!canEdit} onCheckedChange={(v) => set("shopOpen", v)} aria-label="The shop is open" />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="shop-pack-min">Packing takes, days (shortest)</FieldLabel>
                <Input id="shop-pack-min" inputMode="numeric" value={String(s.packMin)} disabled={!canEdit} onChange={(e) => set("packMin", days(e.target.value || "0", 30) ?? s.packMin)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="shop-pack-max">Packing takes, days (longest)</FieldLabel>
                <Input id="shop-pack-max" inputMode="numeric" value={String(s.packMax)} disabled={!canEdit} onChange={(e) => set("packMax", days(e.target.value || "0", 60) ?? s.packMax)} />
                <FieldDescription>Shown on counted items as “ships in {s.packMin === s.packMax ? s.packMin : `${s.packMin} to ${s.packMax}`} days”.</FieldDescription>
              </Field>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Pick-up" description="A free choice at checkout, beside courier delivery.">
          <div className="flex flex-col gap-4 px-5 pb-5">
            <label className="flex items-center justify-between gap-4 text-theme-sm">
              <span className="font-medium text-foreground">Customers may pick up their order</span>
              <Switch checked={s.pickupEnabled} disabled={!canEdit} onCheckedChange={(v) => set("pickupEnabled", v)} aria-label="Customers may pick up their order" />
            </label>
            <Field>
              <FieldLabel htmlFor="shop-pickup-address">Pick-up address</FieldLabel>
              <Textarea id="shop-pickup-address" rows={2} maxLength={300} value={s.pickupAddress} disabled={!canEdit || !s.pickupEnabled} onChange={(e) => set("pickupAddress", e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="shop-pickup-note">Days and hours, or a note</FieldLabel>
              <Input id="shop-pickup-note" maxLength={300} value={s.pickupNote} disabled={!canEdit || !s.pickupEnabled} onChange={(e) => set("pickupNote", e.target.value)} />
            </Field>
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Categories and collections" description="The lists a product chooses from. Separate the names with commas.">
        <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="shop-categories">Categories</FieldLabel>
            <Textarea id="shop-categories" rows={2} value={l.categories} disabled={!canEdit} onChange={(e) => setLists({ ...l, categories: e.target.value })} />
          </Field>
          <Field>
            <FieldLabel htmlFor="shop-collections">Collections</FieldLabel>
            <Textarea id="shop-collections" rows={2} value={l.collections} disabled={!canEdit} onChange={(e) => setLists({ ...l, collections: e.target.value })} />
          </Field>
        </div>
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Shipping and emails" description="What staff choose from when an order ships, and where the links in order emails lead.">
          <div className="flex flex-col gap-4 px-5 pb-5">
            <Field>
              <FieldLabel htmlFor="shop-couriers">Couriers</FieldLabel>
              <Input id="shop-couriers" value={l.couriers} disabled={!canEdit} onChange={(e) => setLists({ ...l, couriers: e.target.value })} />
              <FieldDescription>Separate the names with commas. The first one is offered first.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="shop-site-url">The shop site&apos;s address</FieldLabel>
              <Input id="shop-site-url" inputMode="url" maxLength={120} value={s.siteUrl} disabled={!canEdit} onChange={(e) => set("siteUrl", e.target.value)} />
              <FieldDescription>Order emails link to the customer&apos;s order page at this address.</FieldDescription>
            </Field>
          </div>
        </SectionCard>

        <SectionCard title="Cash book" description="How the shop's proceeds reach Finance.">
          <div className="flex flex-col gap-4 px-5 pb-5">
            <label className="flex items-center justify-between gap-4 text-theme-sm">
              <span><span className="font-medium text-foreground">Finance may post proceeds to the cash book</span><br /><span className="text-muted-foreground">Off until Finance and the accountant agree how shop sales are booked. On, Finance posts each finished day from Shop › Proceeds.</span></span>
              <Switch checked={s.cashPosting} disabled={!canEdit} onCheckedChange={(v) => set("cashPosting", v)} aria-label="Finance may post proceeds to the cash book" />
            </label>
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Giving" description="A signed-in customer can give a cash gift from their account on the shop site. Each paid gift is recorded in Donors with its LAF-CSH acknowledgment receipt.">
        <div className="flex flex-col gap-4 px-5 pb-5">
          <label className="flex items-center justify-between gap-4 text-theme-sm">
            <span><span className="font-medium text-foreground">Giving is open</span><br /><span className="text-muted-foreground">Closed, the account&apos;s Give Hope button leads to the main site&apos;s donate page. Open it once the payment partner is connected and the accountant has agreed how online gifts are booked.</span></span>
            <Switch checked={s.givingOpen} disabled={!canEdit} onCheckedChange={(v) => set("givingOpen", v)} aria-label="Giving is open" />
          </label>
          <div>
            <p className="mb-2 text-theme-sm font-medium text-foreground">Amounts offered, ₱</p>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
              {g.boxes.map((box, i) => (
                <Input key={i} inputMode="decimal" aria-label={`Amount ${i + 1}`} value={box} disabled={!canEdit} onChange={(e) => setGiving({ ...g, boxes: g.boxes.map((b, j) => (j === i ? e.target.value : b)) })} />
              ))}
            </div>
            <p className="mt-1.5 text-theme-xs text-muted-foreground">One to six amounts. Leave a box empty to offer fewer. The customer can also type another amount.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="shop-gift-min">Smallest gift, ₱</FieldLabel>
              <Input id="shop-gift-min" inputMode="decimal" value={g.min} disabled={!canEdit} onChange={(e) => setGiving({ ...g, min: e.target.value })} />
            </Field>
            <Field>
              <FieldLabel htmlFor="shop-gift-max">Largest gift online, ₱</FieldLabel>
              <Input id="shop-gift-max" inputMode="decimal" value={g.max} disabled={!canEdit} onChange={(e) => setGiving({ ...g, max: e.target.value })} />
              <FieldDescription>Above this, the site asks the giver to contact the foundation.</FieldDescription>
            </Field>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Policy pages" description="The texts of the site's Terms of sale, Privacy and Returns pages. A paragraph that starts with “# ” shows as a heading; leave a blank line between paragraphs.">
        <div className="grid gap-4 px-5 pb-5 lg:grid-cols-3">
          {([["termsText", "Terms of sale"], ["privacyText", "Privacy notice"], ["returnsText", "Returns and refunds"]] as const).map(([key, label]) => (
            <Field key={key}>
              <FieldLabel htmlFor={`shop-${key}`}>{label}</FieldLabel>
              <Textarea id={`shop-${key}`} rows={14} maxLength={8000} value={s[key]} disabled={!canEdit} onChange={(e) => set(key, e.target.value)} />
            </Field>
          ))}
        </div>
      </SectionCard>

      <SectionCard flush className="overflow-hidden" title="Delivery fees" description="By area and weight: an order pays the first line its packed weight fits. Take the figures from the courier's rate card.">
        {fees.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Area</TableHead>
                <TableHead>Up to</TableHead>
                <TableHead className="text-right">Fee</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {fees.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="font-medium">{f.area}</TableCell>
                  <TableCell>{grams(f.maxGrams)}</TableCell>
                  <TableCell className="text-right">{formatPesoCents(f.fee)}</TableCell>
                  <TableCell className="text-right">
                    {canEdit ? (
                      <Button size="sm" variant="ghost" className="h-7 text-destructive" aria-label={`Remove the ${f.area} fee up to ${grams(f.maxGrams)}`} disabled={busy} onClick={async () => { const r = await removeFee(f.id); if (!r.ok) toast.error(r.error); }}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="px-5 pb-4 text-theme-sm text-muted-foreground">No fee yet. The shop cannot open until each area you deliver to has at least one line.</p>
        )}
        {canEdit ? (
          <div className="grid items-end gap-3 border-t border-border p-5 sm:grid-cols-4">
            <Field>
              <FieldLabel htmlFor="shop-fee-area">Area</FieldLabel>
              <Select value={fee.area} onValueChange={(v) => setFee({ ...fee, area: v as DeliveryArea })}>
                <SelectTrigger id="shop-fee-area" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{DELIVERY_AREAS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="shop-fee-kilos">Up to, kilos</FieldLabel>
              <Input id="shop-fee-kilos" inputMode="decimal" value={fee.kilos} onChange={(e) => setFee({ ...fee, kilos: e.target.value })} />
            </Field>
            <Field>
              <FieldLabel htmlFor="shop-fee-amount">Fee, ₱</FieldLabel>
              <Input id="shop-fee-amount" inputMode="decimal" value={fee.fee} onChange={(e) => setFee({ ...fee, fee: e.target.value })} />
            </Field>
            <Button variant="outline" disabled={busy} onClick={addFee}><Plus className="size-4" />Add fee</Button>
          </div>
        ) : null}
      </SectionCard>
    </div>
  );
}
