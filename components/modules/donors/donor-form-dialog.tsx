"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { TriangleAlert } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDonorsData } from "@/lib/hooks/use-donors-collection";
import type { Donor, DonorType } from "@/lib/types/donor";
import { checkDonorInput, likelyDuplicates, type DonorInput } from "@/lib/utils/donor-details";
import { formatDonorName } from "@/lib/utils/donor-format";

const TYPES: { value: DonorType; label: string }[] = [
  { value: "individual", label: "Individual" },
  { value: "corporate", label: "Corporate" },
  { value: "foundation", label: "Foundation" },
  { value: "government", label: "Government" },
  { value: "anonymous", label: "Anonymous" },
];

const fromDonor = (d?: Donor): DonorInput => ({
  name: d?.name ?? "",
  salutation: d?.salutation ?? "",
  type: d?.type ?? "individual",
  taxJurisdiction: d?.taxJurisdiction ?? "PH",
  email: d?.email ?? "",
  phone: d?.phone ?? "",
  tin: d?.tin ?? "",
});

/**
 * Add a donor (no `donor`) or edit one's details. A donor with the same name (ignoring titles,
 * case and punctuation) or the same email is shown before saving, with a link to it; saving anyway
 * takes a second, deliberate click. Totals are not editable: they come from the donations.
 */
export function DonorFormDialog({ open, onOpenChange, donor }: { open: boolean; onOpenChange: (open: boolean) => void; donor?: Donor }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Mounted on each opening, so the form starts from the donor as saved. */}
        {open && <DonorForm donor={donor} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function DonorForm({ donor, onDone }: { donor?: Donor; onDone: () => void }) {
  const router = useRouter();
  const { donors, saveDonor } = useDonorsData();
  const [form, setForm] = React.useState<DonorInput>(() => fromDonor(donor));
  const [confirmDuplicate, setConfirmDuplicate] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const set = <K extends keyof DonorInput>(key: K, value: DonorInput[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setConfirmDuplicate(false);
  };
  const duplicates = likelyDuplicates(donors, form, donor?.id);
  // LAF's name style (lib/utils/donor-format.ts), offered while typing, never forced.
  const styled = form.name.trim().length >= 2 ? formatDonorName(form.name) : null;
  const styleDiffers =
    !!styled && (styled.name !== form.name.trim() || (styled.salutation && styled.salutation !== form.salutation) || (form.type === "individual" && styled.suggestedType !== "individual"));
  function useStyle() {
    if (!styled) return;
    setForm((f) => ({ ...f, name: styled.name, salutation: styled.salutation ?? f.salutation, type: f.type === "individual" ? styled.suggestedType : f.type }));
    setConfirmDuplicate(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const checked = checkDonorInput(form);
    if (!checked.ok) {
      toast.error(checked.error);
      return;
    }
    if (duplicates.length && !confirmDuplicate) {
      setConfirmDuplicate(true);
      return;
    }
    setSaving(true);
    const result = await saveDonor(checked.value, donor?.id);
    setSaving(false);
    if (!result.ok) {
      toast.error(`Couldn't save the donor: ${result.error}`);
      return;
    }
    toast.success(donor ? "Donor details saved" : "Donor added");
    onDone();
    if (!donor && result.id) router.push(`/donors/${result.id}`);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{donor ? "Edit donor details" : "Add a donor"}</DialogTitle>
        <DialogDescription>
          {donor ? "Gifts and totals aren't edited here: they follow the donations." : "In-kind gifts are recorded in LAF Inventory; this adds the donor to the register."}
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <div className="grid grid-cols-[5.5rem_1fr] gap-3">
          <Field>
            <FieldLabel htmlFor="donorSalutation">Title</FieldLabel>
            <Input id="donorSalutation" value={form.salutation} onChange={(e) => set("salutation", e.target.value)} maxLength={20} placeholder="Ms." autoComplete="off" />
          </Field>
          <Field>
            <FieldLabel htmlFor="donorName">Name</FieldLabel>
            <Input id="donorName" value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={200} autoComplete="off" required />
          </Field>
        </div>
        {styleDiffers && styled && (
          <div className="-mt-2 flex flex-wrap items-center gap-2 text-theme-xs text-muted-foreground">
            <span>
              LAF style: <span className="font-medium text-foreground">{styled.salutation ? `${styled.salutation} ` : ""}{styled.name}</span>
              {form.type === "individual" && styled.suggestedType !== "individual" ? ` (${styled.suggestedType})` : ""}
              {styled.incomplete ? " · add the full name" : ""}
            </span>
            <Button type="button" size="sm" variant="outline" className="h-7" onClick={useStyle}>
              Use
            </Button>
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="donorType">Type</FieldLabel>
            <Select value={form.type} onValueChange={(v) => set("type", v as DonorType)}>
              <SelectTrigger id="donorType" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="donorJurisdiction">Tax jurisdiction</FieldLabel>
            <Select value={form.taxJurisdiction} onValueChange={(v) => set("taxJurisdiction", v as "PH" | "US")}>
              <SelectTrigger id="donorJurisdiction" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PH">Philippines</SelectItem>
                <SelectItem value="US">United States</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="donorEmail">Email (optional)</FieldLabel>
          <Input id="donorEmail" type="email" inputMode="email" value={form.email} onChange={(e) => set("email", e.target.value)} maxLength={254} autoComplete="off" />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="donorPhone">Phone (optional)</FieldLabel>
            <Input id="donorPhone" type="tel" inputMode="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} maxLength={30} autoComplete="off" />
          </Field>
          <Field>
            <FieldLabel htmlFor="donorTin">TIN (optional)</FieldLabel>
            <Input id="donorTin" inputMode="numeric" value={form.tin} onChange={(e) => set("tin", e.target.value)} maxLength={20} placeholder="123-456-789-000" autoComplete="off" />
          </Field>
        </div>
      </FieldGroup>

      {duplicates.length > 0 && (
        <div role="status" className="flex gap-2.5 rounded-lg border border-warning/40 bg-warning/10 p-3 text-theme-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          <div className="flex min-w-0 flex-col gap-1">
            <span className="font-medium text-foreground">This may already be in the register:</span>
            {duplicates.slice(0, 3).map((d) => (
              <Link key={d.id} href={`/donors/${d.id}`} className="truncate text-primary hover:underline" onClick={onDone}>
                {d.name}
                {d.email ? ` · ${d.email}` : ""} · {d.giftCount} gift{d.giftCount === 1 ? "" : "s"}
              </Link>
            ))}
            {confirmDuplicate && <span className="text-muted-foreground">Save again to {donor ? "keep these details" : "add a separate donor"} anyway.</span>}
          </div>
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : confirmDuplicate ? "Save anyway" : donor ? "Save details" : "Add donor"}
        </Button>
      </DialogFooter>
    </form>
  );
}
