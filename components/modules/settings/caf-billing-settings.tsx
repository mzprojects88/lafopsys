"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { useStaffRoster } from "@/lib/hooks/use-staff-roster";
import { updateCafSettings, type CafSettingsInput } from "@/app/(app)/settings/actions";

const NOBODY = "none";
const EMPTY: CafSettingsInput = {
  rate: 1000,
  cap: 15,
  discount_pct: 20,
  payer_name: "",
  payer_address: "",
  bank_name: "",
  bank_account_name: "",
  bank_account_no: "",
  bank_account_type: "Savings",
  prepared_by: null,
  approved_by: null,
};

/** Settings > NCH billing (0098): the rate, the nights a month, the PWD discount, NCH's address,
 * where NCH pays, and who signs. A draft bill takes these; a final bill keeps its own. */
export function CafBillingSettings({ canEdit }: { canEdit: boolean }) {
  const { staff } = useStaffRoster();
  const [form, setForm] = React.useState<CafSettingsInput | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    void createClient()
      .schema("shared")
      .from("app_settings")
      .select("caf")
      .eq("id", true)
      .maybeSingle()
      .then(({ data }) => setForm({ ...EMPTY, ...((data?.caf as Partial<CafSettingsInput>) ?? {}) }));
  }, []);

  if (!form) return <p className="text-xs text-muted-foreground">Loading…</p>;
  const set = <K extends keyof CafSettingsInput>(key: K, value: CafSettingsInput[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));
  const people = staff.filter((s) => s.active).sort((a, b) => a.lastName.localeCompare(b.lastName));

  async function save() {
    if (!form) return;
    setSaving(true);
    const r = await updateCafSettings(form);
    setSaving(false);
    if (!r.ok) return void toast.error(r.error ?? "Couldn't save.");
    toast.success("NCH billing figures saved");
  }

  const text = (key: keyof CafSettingsInput, label: string, max = 120) => (
    <Field>
      <FieldLabel htmlFor={`caf-${key}`}>{label}</FieldLabel>
      <Input id={`caf-${key}`} value={String(form[key] ?? "")} maxLength={max} disabled={!canEdit} onChange={(e) => set(key, e.target.value as never)} />
    </Field>
  );
  const number = (key: "rate" | "cap" | "discount_pct", label: string) => (
    <Field>
      <FieldLabel htmlFor={`caf-${key}`}>{label}</FieldLabel>
      <Input id={`caf-${key}`} type="number" inputMode="decimal" min={0} value={form[key]} disabled={!canEdit} onChange={(e) => set(key, Number(e.target.value))} />
    </Field>
  );
  const signer = (key: "prepared_by" | "approved_by", label: string) => (
    <Field>
      <FieldLabel htmlFor={`caf-${key}`}>{label}</FieldLabel>
      <Select value={form[key] ?? NOBODY} onValueChange={(v) => set(key, v === NOBODY ? null : v)} disabled={!canEdit}>
        <SelectTrigger id={`caf-${key}`} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NOBODY}>Nobody yet</SelectItem>
          {people.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.firstName} {s.lastName}
              {s.position ? ` · ${s.position}` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );

  return (
    <div className="flex flex-col gap-3">
      <span className="text-xs text-muted-foreground">
        A draft bill follows these; a final bill keeps the figures it was made with. The job title printed under each signature is the one under Manage Users.
      </span>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {number("rate", "Rate per stay (PHP)")}
        {number("cap", "Billable nights a month")}
        {number("discount_pct", "PWD discount (%)")}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {text("payer_name", "Billed to")}
        {text("payer_address", "Address", 200)}
        {text("bank_name", "Bank", 60)}
        {text("bank_account_type", "Account type", 30)}
        {text("bank_account_name", "Account name")}
        {text("bank_account_no", "Account number", 40)}
        {signer("prepared_by", "Prepared by")}
        {signer("approved_by", "Approved by")}
      </div>
      {canEdit && (
        <Button className="self-start" disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save"}
        </Button>
      )}
    </div>
  );
}
