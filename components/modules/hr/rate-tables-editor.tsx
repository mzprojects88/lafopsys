"use client";

import * as React from "react";
import { toast } from "sonner";
import { Plus, Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/patterns/status-badge";
import { useRateTables, rateTablesStore } from "@/lib/hooks/use-hr-reference-collections";
import { formatDate } from "@/lib/utils/date";
import { parseRateTable } from "@/lib/utils/statutory";
import { saveRateTable, type RateTableInput } from "@/app/(app)/hr/actions";
import { RATE_TABLE_KINDS, type RateTable, type RateTableKind, type RateTableStatus } from "@/lib/types/hr";

const KIND_LABEL = Object.fromEntries(RATE_TABLE_KINDS.map((k) => [k.value, k.label]));
const STATUS_LABEL: Record<RateTableStatus, string> = { in_force: "In force", enjoined: "Enjoined", draft: "Draft", superseded: "Superseded" };

const SHAPE_HINT: Record<RateTableKind, string> = {
  sss: 'rows: [{"from":0,"to":5250,"msc":5000,"ee":250,"er":500,"ec":10,"mpfEe":0,"mpfEr":0}, …] — joined ranges, last "to" null',
  philhealth: 'params: {"rate":0.05,"floor":10000,"ceiling":100000}',
  pagibig: 'params: {"eeRateLow":0.01,"lowThreshold":1500,"eeRate":0.02,"erRate":0.02,"maxFundSalary":10000}',
  tax_semi_monthly: 'rows: [{"over":0,"base":0,"rate":0},{"over":10417,"base":0,"rate":0.15}, …] — tax = base + rate × (taxable − over)',
  tax_monthly: 'rows: [{"over":0,"base":0,"rate":0},{"over":20833,"base":0,"rate":0.15}, …]',
  tax_annual: 'rows: [{"over":0,"base":0,"rate":0},{"over":250000,"base":0,"rate":0.15}, …]',
  minimum_wage: 'rows: [{"region":"NCR","sector":"non_agri","rate":695,"wageOrder":"NCR-26"}, …]',
};

/**
 * The government tables, one card per kind, newest version first. A new
 * circular is a new version from its effective date; the old one keeps its
 * history (and the payslips it priced keep their snapshot). "Enjoined" is
 * for an order stayed by a court, like NCR-27: listed, never applied.
 */
export function RateTablesEditor() {
  const { rateTables, loading } = useRateTables();
  const [editing, setEditing] = React.useState<{ table: RateTable | null; kind: RateTableKind } | null>(null);

  return (
    <div className="flex flex-col gap-4">
      {loading && rateTables.length === 0 ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {RATE_TABLE_KINDS.map((k) => {
        const versions = rateTables.filter((t) => t.kind === k.value);
        return (
          <Card key={k.value}>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">{k.label}</CardTitle>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setEditing({ table: null, kind: k.value })}>
                <Plus className="size-3.5" />
                New version
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5">
              {versions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No version on file — payroll cannot compute without one.</p>
              ) : (
                versions.map((t) => (
                  <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm">
                    <div className="flex min-w-0 flex-col">
                      <span className="font-medium">{t.source}</span>
                      <span className="text-xs text-muted-foreground">
                        From {formatDate(t.effectiveFrom)}
                        {t.effectiveTo ? ` to ${formatDate(t.effectiveTo)}` : ""}
                        {t.notes ? ` — ${t.notes}` : ""}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <StatusBadge domain="rateTable" status={t.status} label={STATUS_LABEL[t.status]} />
                      <Button variant="ghost" size="icon-sm" aria-label={`Edit ${t.source}`} onClick={() => setEditing({ table: t, kind: t.kind })}>
                        <Pencil className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        );
      })}
      {editing ? <RateTableDialog key={editing.table?.id ?? `new-${editing.kind}`} table={editing.table} kind={editing.kind} latest={rateTables.find((t) => t.kind === editing.kind) ?? null} close={() => setEditing(null)} /> : null}
    </div>
  );
}

function RateTableDialog({ table, kind, latest, close }: { table: RateTable | null; kind: RateTableKind; latest: RateTable | null; close: () => void }) {
  const [saving, setSaving] = React.useState(false);
  const seed = table ?? latest;
  const [form, setForm] = React.useState({
    effectiveFrom: table?.effectiveFrom ?? "",
    effectiveTo: table?.effectiveTo ?? "",
    status: (table?.status ?? "in_force") as RateTableStatus,
    source: table?.source ?? "",
    notes: table?.notes ?? "",
    params: JSON.stringify(seed?.params ?? {}, null, 2),
    rows: JSON.stringify(seed?.rows ?? [], null, kind === "sss" ? 0 : 2),
  });

  // Validated on every keystroke with the same parser the engine trusts.
  const parsed = React.useMemo(() => {
    try {
      const params = JSON.parse(form.params || "{}");
      const rows = JSON.parse(form.rows || "[]");
      parseRateTable({ kind, params, rows, effectiveFrom: form.effectiveFrom || "2000-01-01", status: form.status });
      return { ok: true as const, params, rows };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Invalid" };
    }
  }, [form.params, form.rows, form.effectiveFrom, form.status, kind]);

  async function handleSave() {
    if (!parsed.ok) return;
    setSaving(true);
    const input: RateTableInput = {
      kind,
      effectiveFrom: form.effectiveFrom,
      effectiveTo: form.effectiveTo || null,
      status: form.status,
      source: form.source,
      params: parsed.params,
      rows: parsed.rows,
      notes: form.notes,
    };
    const result = await saveRateTable(table?.id ?? null, input);
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    await rateTablesStore.refetch();
    toast.success(`${KIND_LABEL[kind]} saved.`);
    close();
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {table ? "Edit" : "New version of"} {KIND_LABEL[kind].toLowerCase()}
          </DialogTitle>
          <DialogDescription>
            {table
              ? "Editing changes what future payslips use. Payslips already computed keep the version they used."
              : "Pre-filled from the current version; change what the new circular changes and set its effective date."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="rt-from">Effective from</FieldLabel>
            <Input id="rt-from" type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} />
          </Field>
          <Field>
            <FieldLabel htmlFor="rt-to">Effective to (optional)</FieldLabel>
            <Input id="rt-to" type="date" value={form.effectiveTo} onChange={(e) => setForm({ ...form, effectiveTo: e.target.value })} />
          </Field>
          <Field>
            <FieldLabel htmlFor="rt-status">Status</FieldLabel>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as RateTableStatus })}>
              <SelectTrigger id="rt-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(STATUS_LABEL) as RateTableStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Only &quot;In force&quot; versions price a payslip.</p>
          </Field>
          <Field>
            <FieldLabel htmlFor="rt-source">Source</FieldLabel>
            <Input id="rt-source" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="SSS Circular …, Wage Order …, RR …" />
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="rt-params">Parameters (JSON)</FieldLabel>
            <Textarea id="rt-params" rows={3} className="font-mono text-xs" value={form.params} onChange={(e) => setForm({ ...form, params: e.target.value })} />
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="rt-rows">Brackets / rows (JSON)</FieldLabel>
            <Textarea id="rt-rows" rows={kind === "sss" ? 6 : 8} className="font-mono text-xs" value={form.rows} onChange={(e) => setForm({ ...form, rows: e.target.value })} />
            <p className="text-xs text-muted-foreground">{SHAPE_HINT[kind]}</p>
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="rt-notes">Notes</FieldLabel>
            <Input id="rt-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
          <p className={`text-xs sm:col-span-2 ${parsed.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>{parsed.ok ? "Table shape is valid." : parsed.error}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !parsed.ok}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
