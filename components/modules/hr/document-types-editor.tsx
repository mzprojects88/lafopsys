"use client";

import * as React from "react";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Field, FieldLabel } from "@/components/ui/field";
import { SectionCard } from "@/components/patterns/section-card";
import { LoadingState } from "@/components/patterns/loading-state";
import { StatusBadge } from "@/components/patterns/status-badge";
import { useDocumentTypes, documentTypesStore } from "@/lib/hooks/use-document-types-collection";
import { updateDocumentType } from "@/app/(app)/hr/actions";
import type { DocumentType } from "@/lib/types/hr";

/** The 201 checklist itself: which documents every file should hold, and for how long each stays valid. */
export function DocumentTypesEditor() {
  const { documentTypes, loading } = useDocumentTypes();
  const [editing, setEditing] = React.useState<DocumentType | null>(null);

  return (
    <SectionCard
      title="201 checklist"
      flush
      bodyClassName="flex flex-col divide-y divide-border"
    >
        <p className="px-5 py-3 text-theme-xs text-muted-foreground">From the masterlist&apos;s checklist sheet. A validity turns a document amber 30 days before it lapses and red after.</p>
        {loading && documentTypes.length === 0 ? (
          <div className="p-5">
            <LoadingState />
          </div>
        ) : (
          documentTypes.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-theme-sm">
              <div className="flex min-w-0 flex-col">
                <span className="font-medium">
                  {t.sort}. {t.name}
                  <span className="text-theme-xs text-muted-foreground">
                    {t.validityMonths ? ` · valid ${t.validityMonths} months` : ""}
                    {t.required ? "" : " · optional"}
                  </span>
                </span>
                {t.notes ? <span className="text-theme-xs text-muted-foreground">{t.notes}</span> : null}
              </div>
              <div className="flex items-center gap-1.5">
                <StatusBadge domain="employee" status={t.active ? "active" : "resigned"} label={t.active ? "On" : "Off"} />
                <Button variant="ghost" size="icon-sm" aria-label={`Edit ${t.name}`} onClick={() => setEditing(t)}>
                  <Pencil className="size-3.5" />
                </Button>
              </div>
            </div>
          ))
        )}
      {editing ? <DocumentTypeDialog key={editing.id} type={editing} close={() => setEditing(null)} /> : null}
    </SectionCard>
  );
}

function DocumentTypeDialog({ type, close }: { type: DocumentType; close: () => void }) {
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState({ name: type.name, required: type.required, validityMonths: type.validityMonths, active: type.active, notes: type.notes ?? "" });

  async function handleSave() {
    setSaving(true);
    const result = await updateDocumentType(type.id, form);
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    await documentTypesStore.refetch();
    toast.success(`${form.name} saved.`);
    close();
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{type.name}</DialogTitle>
          <DialogDescription>Checklist item {type.sort}.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="dt-name">Name</FieldLabel>
            <Input id="dt-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field>
            <FieldLabel htmlFor="dt-validity">Valid for (months)</FieldLabel>
            <Input id="dt-validity" type="number" min="1" value={form.validityMonths ?? ""} onChange={(e) => setForm({ ...form, validityMonths: e.target.value === "" ? null : Number(e.target.value) })} placeholder="Blank = does not expire" />
          </Field>
          <Field>
            <FieldLabel htmlFor="dt-notes">Notes</FieldLabel>
            <Input id="dt-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
          <div className="flex items-center justify-between gap-3">
            <span className="text-theme-sm font-medium">Required for every employee</span>
            <Switch checked={form.required} onCheckedChange={(v) => setForm({ ...form, required: v })} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-theme-sm font-medium">On the checklist</span>
            <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
          </div>
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
