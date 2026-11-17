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
import { DELIVERY_AREAS, readAmount, type DeliveryArea, type ShopSettings } from "@/lib/utils/shop";
import { formatPesoCents } from "@/lib/utils/vehicle-expenses";

const listOf = (text: string): string[] => [...new Set(text.split(/[\n,]/).map((s) => s.trim()).filter((s) => s.length >= 2 && s.length <= 40))];
const days = (text: string, max: number): number | null => (/^\d{1,2}$/.test(text.trim()) && Number(text) <= max ? Number(text) : null);
const grams = (g: number) => (g % 1000 === 0 ? `${g / 1000} kg` : `${g.toLocaleString("en-PH")} g`);

/**
 * Shop › Shop settings (0155): whether the shop takes orders, how long packing takes, pick-up, the lists the
 * products choose from, and the delivery fees by area and weight. Every figure the site shows comes from here.
 */
export default function ShopSettingsPage() {
  const access = useModuleAccess();
  const canEdit = access.levelOfPath("/shop/settings") === "edit";
  const { settings, fees, settingsLoading, saveSettings, saveFee, removeFee } = useShopData();
  const [draft, setDraft] = React.useState<ShopSettings | null>(null);
  const [lists, setLists] = React.useState<{ categories: string; collections: string } | null>(null);
  const [fee, setFee] = React.useState<{ area: DeliveryArea; kilos: string; fee: string }>({ area: "Metro Manila", kilos: "1", fee: "" });
  const [busy, setBusy] = React.useState(false);

  if (settingsLoading) return <LoadingState />;
  const s = draft ?? settings;
  const l = lists ?? { categories: settings.categories.join(", "), collections: settings.collections.join(", ") };
  const set = <K extends keyof ShopSettings>(key: K, value: ShopSettings[K]) => setDraft({ ...s, [key]: value });
  const dirty = draft !== null || lists !== null;

  async function save() {
    const categories = listOf(l.categories);
    if (!categories.length) return void toast.error("Keep at least one category.");
    if (s.packMax < s.packMin) return void toast.error("The longest packing time can't be shorter than the shortest.");
    if (s.shopOpen && !fees.length) return void toast.error("Set the delivery fees before opening the shop.");
    if (s.shopOpen && s.pickupEnabled && !s.pickupAddress.trim()) return void toast.error("Give the pick-up address, or switch pick-up off, before opening the shop.");
    setBusy(true);
    const r = await saveSettings({ ...s, categories, collections: listOf(l.collections) });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    setDraft(null);
    setLists(null);
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
