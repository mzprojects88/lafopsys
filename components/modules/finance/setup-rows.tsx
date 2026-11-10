"use client";

import * as React from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCheck, Plus, Search } from "lucide-react";
import { SectionCard } from "@/components/patterns/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { keyOf, removeSetupRow, saveSetupRow, settleAll, type SetupRow, type SetupTable } from "@/lib/hooks/use-finance-setup";
import { cn } from "@/lib/utils";

export interface SetupField {
  key: string;
  label: string;
  kind: "text" | "number" | "date" | "switch" | "select" | "textarea" | "list";
  options?: { value: string; label: string }[];
  /** A select that may be left empty (saved as nothing). */
  optional?: boolean;
  hint?: string;
  upper?: boolean;
}
export interface SetupColumn {
  label: string;
  render: (row: SetupRow) => React.ReactNode;
  className?: string;
}

const NONE = "__none";

/** What the form shows for a stored value, and what the database gets back. */
function toDraft(field: SetupField, value: unknown): string | boolean {
  if (field.kind === "switch") return Boolean(value);
  if (field.kind === "list") return Array.isArray(value) ? value.join(", ") : "";
  return value == null ? "" : String(value);
}
function fromDraft(field: SetupField, value: string | boolean): unknown {
  if (field.kind === "switch") return Boolean(value);
  const s = String(value).trim();
  if (field.kind === "list") return s ? s.split(",").map((x) => x.trim()).filter(Boolean) : [];
  if (!s || s === NONE) return null;
  if (field.kind === "number") return Number(s);
  return field.upper ? s.toUpperCase() : s;
}

/**
 * One Financial Settings list: a table, a "Needs attention" filter for imported rows that carry a review
 * note, and a dialog to add, change, settle or remove a row. The database checks every value and who may
 * write; this only shapes the form.
 */
export function SetupRows({ table, title, description, rows, columns, fields, blank, fixed, search, addLabel = "Add", canAdd = true, canDelete = true }: {
  table: SetupTable;
  title: string;
  description?: string;
  rows: SetupRow[];
  columns: SetupColumn[];
  fields: SetupField[];
  blank: SetupRow;
  /** Values every new row gets that the form does not ask for (a code's tier). */
  fixed?: SetupRow;
  /** The text a row is found by in the search box. */
  search?: (row: SetupRow) => string;
  addLabel?: string;
  canAdd?: boolean;
  canDelete?: boolean;
}) {
  const [onlyNotes, setOnlyNotes] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [editing, setEditing] = React.useState<{ key: string | null; note: string | null; draft: Record<string, string | boolean>; settled: boolean } | null>(null);
  const [busy, setBusy] = React.useState(false);

  const notes = rows.filter((r) => r.review_note).length;
  const q = query.trim().toLowerCase();
  const shown = rows.filter((r) => (!onlyNotes || r.review_note) && (!q || !search || search(r).toLowerCase().includes(q)));

  const open = (row: SetupRow | null) => {
    const src = row ?? blank;
    setEditing({ key: row ? keyOf(table, row) : null, note: (row?.review_note as string | null) ?? null, settled: false, draft: Object.fromEntries(fields.map((f) => [f.key, toDraft(f, src[f.key])])) });
  };
  const set = (k: string, v: string | boolean) => setEditing((e) => (e ? { ...e, draft: { ...e.draft, [k]: v } } : e));

  async function save() {
    if (!editing) return;
    setBusy(true);
    const values: SetupRow = { ...(editing.key ? {} : fixed), ...Object.fromEntries(fields.map((f) => [f.key, fromDraft(f, editing.draft[f.key])])) };
    if (editing.note && editing.settled) values.review_note = null;
    const r = await saveSetupRow(table, editing.key, values);
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success(editing.key ? "Saved" : "Added");
    setEditing(null);
  }

  async function remove() {
    if (!editing?.key || !confirm("Remove this row? The change log keeps a copy.")) return;
    setBusy(true);
    const r = await removeSetupRow(table, editing.key);
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success("Removed");
    setEditing(null);
  }

  async function settleEverything() {
    if (!confirm(`Mark all ${notes} notes in ${title} as settled? Do this only once each one has been checked.`)) return;
    const r = await settleAll(table, rows.filter((x) => x.review_note).map((x) => keyOf(table, x)));
    toast[r.ok ? "success" : "error"](r.ok ? "All settled" : r.error);
  }

  return (
    <SectionCard
      flush
      title={title}
      description={description}
      actions={
        <>
          {notes > 0 ? (
            <Button size="sm" variant={onlyNotes ? "default" : "outline"} onClick={() => setOnlyNotes((v) => !v)}>
              <AlertTriangle /> Needs attention ({notes})
            </Button>
          ) : null}
          {notes > 0 ? (
            <Button size="sm" variant="ghost" onClick={() => void settleEverything()}>
              <CheckCheck /> Settle all
            </Button>
          ) : null}
          {canAdd ? (
            <Button size="sm" onClick={() => open(null)}>
              <Plus /> {addLabel}
            </Button>
          ) : null}
        </>
      }
    >
      {search ? (
        <div className="relative border-b border-border px-5 py-3">
          <Search className="pointer-events-none absolute left-8 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label={`Search ${title}`} />
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-theme-sm">
          <thead>
            <tr className="border-b border-border text-left text-theme-xs text-muted-foreground">
              {columns.map((c) => (
                <th key={c.label} className={cn("h-10 px-4 font-medium", c.className)}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={keyOf(table, row)} className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/40" onClick={() => open(row)}>
                {columns.map((c, i) => (
                  <td key={c.label} className={cn("px-4 py-2.5 align-top", c.className)}>
                    {c.render(row)}
                    {i === 0 && row.review_note ? <p className="mt-1 max-w-xl text-theme-xs text-warning-foreground">{String(row.review_note)}</p> : null}
                  </td>
                ))}
              </tr>
            ))}
            {shown.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-6 text-center text-muted-foreground">{onlyNotes || q ? "Nothing matches." : "Nothing here yet."}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing?.key ? `Edit · ${title}` : `${addLabel} · ${title}`}</DialogTitle>
          </DialogHeader>
          {editing ? (
            <div className="flex flex-col gap-3">
              {editing.note ? (
                <div className="flex flex-col gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3">
                  <p className="text-theme-sm">{editing.note}</p>
                  <label className="flex items-center gap-2 text-theme-sm font-medium">
                    <Switch checked={editing.settled} onCheckedChange={(v) => setEditing((e) => (e ? { ...e, settled: v } : e))} />
                    Settled: I have checked this
                  </label>
                </div>
              ) : null}
              {fields.map((f) => (
                <Field key={f.key}>
                  {f.kind === "switch" ? (
                    <label className="flex items-center gap-2 text-theme-sm font-medium">
                      <Switch checked={Boolean(editing.draft[f.key])} onCheckedChange={(v) => set(f.key, v)} />
                      {f.label}
                    </label>
                  ) : (
                    <FieldLabel htmlFor={`setup-${f.key}`}>{f.label}</FieldLabel>
                  )}
                  {f.kind === "select" ? (
                    <Select value={String(editing.draft[f.key]) || NONE} onValueChange={(v) => set(f.key, v)}>
                      <SelectTrigger id={`setup-${f.key}`} className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {f.optional ? <SelectItem value={NONE}>None</SelectItem> : null}
                        {(f.options ?? []).map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : f.kind === "textarea" ? (
                    <Textarea id={`setup-${f.key}`} value={String(editing.draft[f.key])} onChange={(e) => set(f.key, e.target.value)} rows={3} />
                  ) : f.kind !== "switch" ? (
                    <Input
                      id={`setup-${f.key}`}
                      type={f.kind === "number" ? "number" : f.kind === "date" ? "date" : "text"}
                      inputMode={f.kind === "number" ? "decimal" : undefined}
                      value={String(editing.draft[f.key])}
                      onChange={(e) => set(f.key, e.target.value)}
                    />
                  ) : null}
                  {f.hint ? <FieldDescription>{f.hint}</FieldDescription> : null}
                </Field>
              ))}
            </div>
          ) : null}
          <DialogFooter className="gap-2">
            {editing?.key && canDelete ? (
              <Button variant="ghost" className="mr-auto text-destructive" disabled={busy} onClick={() => void remove()}>Remove</Button>
            ) : null}
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}
