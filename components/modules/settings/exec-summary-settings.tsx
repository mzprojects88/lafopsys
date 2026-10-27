"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { updateExecSummarySettings, type ExecSummarySettingsInput } from "@/app/(app)/settings/actions";

/** Settings > Executive summary (0114): the purposes list, and the two amounts behind the monthly note. */
export function ExecSummarySettings({ canEdit }: { canEdit: boolean }) {
  const [form, setForm] = React.useState<{ purposes: string; confirm_from: number; name_from: number } | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    void createClient()
      .schema("shared")
      .from("app_settings")
      .select("exec_summary")
      .eq("id", true)
      .maybeSingle()
      .then(({ data }) => {
        const s = (data?.exec_summary as Partial<ExecSummarySettingsInput> | null) ?? {};
        setForm({ purposes: (s.purposes ?? []).join("\n"), confirm_from: s.confirm_from ?? 10000, name_from: s.name_from ?? 20000 });
      });
  }, []);

  if (!form) return <p className="text-xs text-muted-foreground">Loading…</p>;

  async function save() {
    if (!form) return;
    setSaving(true);
    const r = await updateExecSummarySettings({ purposes: form.purposes.split("\n"), confirm_from: form.confirm_from, name_from: form.name_from });
    setSaving(false);
    if (!r.ok) return void toast.error(r.error ?? "Couldn't save.");
    toast.success("Executive summary settings saved");
  }

  return (
    <div className="flex flex-col gap-3">
      <span className="text-xs text-muted-foreground">
        The app drafts each month&apos;s Key monthly drivers from the bank, the gifts and the house&apos;s activity; the CEO, finance or the Super Admin confirms it. Companies, foundations and government are always named; a person only from the amount below.
      </span>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="exec-confirm-from">Finance confirms a debit&apos;s purpose from (PHP)</FieldLabel>
          <Input id="exec-confirm-from" type="number" inputMode="decimal" min={0} value={form.confirm_from} disabled={!canEdit} onChange={(e) => setForm({ ...form, confirm_from: Number(e.target.value) })} />
        </Field>
        <Field>
          <FieldLabel htmlFor="exec-name-from">Name a person who gave at least (PHP, in the month)</FieldLabel>
          <Input id="exec-name-from" type="number" inputMode="decimal" min={0} value={form.name_from} disabled={!canEdit} onChange={(e) => setForm({ ...form, name_from: Number(e.target.value) })} />
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor="exec-purposes">What the money is spent on (one per line)</FieldLabel>
        <Textarea id="exec-purposes" rows={8} value={form.purposes} disabled={!canEdit} onChange={(e) => setForm({ ...form, purposes: e.target.value })} />
      </Field>
      {canEdit && (
        <Button className="self-start" disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save"}
        </Button>
      )}
    </div>
  );
}
