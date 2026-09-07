"use client";

import * as React from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/patterns/status-badge";
import { useHolidays, holidaysStore } from "@/lib/hooks/use-hr-reference-collections";
import { useNow } from "@/lib/hooks/use-now";
import { dayKey } from "@/lib/utils/dtr";
import { formatDate } from "@/lib/utils/date";
import { deleteHoliday, saveHoliday, type HolidayInput } from "@/app/(app)/hr/actions";
import { HOLIDAY_KINDS, type Holiday, type HolidayKind } from "@/lib/types/hr";

const KIND_LABEL = Object.fromEntries(HOLIDAY_KINDS.map((k) => [k.value, k.label]));
const KIND_TONE: Record<HolidayKind, string> = { regular: "regular", special_non_working: "special", special_working: "working" };

/** The holiday list by year: the proclamation's dates plus any local ones. */
export function HolidaysEditor() {
  const { holidays, loading } = useHolidays();
  const today = dayKey(useNow());
  const [year, setYear] = React.useState(today.slice(0, 4));
  const [editing, setEditing] = React.useState<{ holiday: Holiday | null } | null>(null);
  const years = Array.from(new Set([today.slice(0, 4), String(Number(today.slice(0, 4)) + 1), ...holidays.map((h) => h.date.slice(0, 4))])).sort();
  const rows = holidays.filter((h) => h.date.startsWith(year));

  async function remove(h: Holiday) {
    const result = await deleteHoliday(h.id);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    await holidaysStore.refetch();
    toast.success(`${h.name} removed.`);
  }

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Holidays</CardTitle>
        <div className="flex items-center gap-2">
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger className="w-28" aria-label="Year">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={y}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setEditing({ holiday: null })}>
            <Plus className="size-3.5" />
            Add holiday
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        <p className="text-xs text-muted-foreground">
          Regular holidays are paid even when unworked and 200% when worked; special non-working days are no-work-no-pay and 130% when worked (Labor Code Art. 94, Proclamation 1006 s.2025). Local
          holidays apply where the person works.
        </p>
        {loading && holidays.length === 0 ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No holidays listed for {year} yet — add the year&apos;s proclamation.</p>
        ) : (
          rows.map((h) => (
            <div key={h.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm">
              <div className="flex min-w-0 flex-col">
                <span className="font-medium">
                  {h.name}
                  {h.scopeCity ? <span className="text-xs text-muted-foreground"> · {h.scopeCity} only</span> : null}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatDate(h.date, "EEE, MMM d, yyyy")}
                  {h.source ? ` · ${h.source}` : ""}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <StatusBadge domain="holiday" status={KIND_TONE[h.kind]} label={KIND_LABEL[h.kind]} />
                <Button variant="ghost" size="icon-sm" aria-label={`Edit ${h.name}`} onClick={() => setEditing({ holiday: h })}>
                  <Pencil className="size-3.5" />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label={`Remove ${h.name}`} onClick={() => remove(h)}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>
      {editing ? <HolidayDialog key={editing.holiday?.id ?? "new"} holiday={editing.holiday} defaultYear={year} close={() => setEditing(null)} /> : null}
    </Card>
  );
}

function HolidayDialog({ holiday, defaultYear, close }: { holiday: Holiday | null; defaultYear: string; close: () => void }) {
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState<HolidayInput>({
    date: holiday?.date ?? `${defaultYear}-01-01`,
    name: holiday?.name ?? "",
    kind: holiday?.kind ?? "regular",
    scopeCity: holiday?.scopeCity ?? "",
    source: holiday?.source ?? "",
  });

  async function handleSave() {
    setSaving(true);
    const result = await saveHoliday(holiday?.id ?? null, form);
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    await holidaysStore.refetch();
    toast.success(`${form.name} saved.`);
    close();
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{holiday ? "Edit holiday" : "Add holiday"}</DialogTitle>
          <DialogDescription>Say which proclamation or ordinance declared it, so the payroll can be defended later.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="hol-date">Date</FieldLabel>
            <Input id="hol-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </Field>
          <Field>
            <FieldLabel htmlFor="hol-kind">Kind</FieldLabel>
            <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v as HolidayKind })}>
              <SelectTrigger id="hol-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HOLIDAY_KINDS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{HOLIDAY_KINDS.find((k) => k.value === form.kind)?.hint}</p>
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="hol-name">Name</FieldLabel>
            <Input id="hol-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field>
            <FieldLabel htmlFor="hol-city">Local to (city)</FieldLabel>
            <Input id="hol-city" value={form.scopeCity ?? ""} onChange={(e) => setForm({ ...form, scopeCity: e.target.value })} placeholder="Blank = nationwide" />
          </Field>
          <Field>
            <FieldLabel htmlFor="hol-source">Source</FieldLabel>
            <Input id="hol-source" value={form.source ?? ""} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="Proclamation No. …" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
