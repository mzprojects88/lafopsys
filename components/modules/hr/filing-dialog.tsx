"use client";

import * as React from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { complianceFilingsStore } from "@/lib/hooks/use-compliance-collections";
import { deleteComplianceFiling, saveComplianceFiling, type FilingInput } from "@/app/(app)/compliance/actions";
import { formatDate } from "@/lib/utils/date";
import type { CalendarEntry } from "@/lib/utils/compliance";
import type { ComplianceFiling, ComplianceFilingStatus, ComplianceItem } from "@/lib/types/hr";

/** Records one obligation for one period: in progress, filed (with the reference and amount), or not applicable. */
export function FilingDialog({ entry, close, canDelete = true }: { entry: CalendarEntry<ComplianceFiling, ComplianceItem>; close: () => void; canDelete?: boolean }) {
  const f = entry.filing;
  const [form, setForm] = React.useState<FilingInput>({
    itemId: entry.itemId,
    periodKey: entry.periodKey,
    dueOn: entry.dueOn,
    status: f?.status === "filed" || f?.status === "late" ? "filed" : f?.status === "na" ? "na" : "in_progress",
    filedOn: f?.filedOn ?? null,
    referenceNo: f?.referenceNo ?? "",
    amount: f?.amount ?? null,
    attachmentUrl: f?.attachmentUrl ?? "",
    notes: f?.notes ?? "",
  });
  const [saving, setSaving] = React.useState(false);
  const id = f?.id ?? null;

  async function handleSave() {
    setSaving(true);
    const r = await saveComplianceFiling(form);
    setSaving(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    await complianceFilingsStore.refetch();
    toast.success("Recorded.");
    close();
  }

  async function handleDelete() {
    if (!id) return;
    setSaving(true);
    const r = await deleteComplianceFiling(id);
    setSaving(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    await complianceFilingsStore.refetch();
    toast.success("Record removed.");
    close();
  }

  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {entry.item.agency} · {entry.item.name}
          </DialogTitle>
          <DialogDescription>
            {entry.periodLabel} · submit by {formatDate(entry.targetOn)} · {entry.item.agency} deadline {formatDate(entry.dueOn)}
            {entry.item.form ? ` · ${entry.item.form}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="fl-status">Status</FieldLabel>
            <Select value={form.status} onValueChange={(v) => setForm((s) => ({ ...s, status: v as ComplianceFilingStatus }))}>
              <SelectTrigger id="fl-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="in_progress">In progress</SelectItem>
                <SelectItem value="filed">Filed / paid</SelectItem>
                <SelectItem value="na">Not applicable this period</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {form.status === "filed" ? (
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="fl-date">Filed on</FieldLabel>
                <Input id="fl-date" type="date" value={form.filedOn ?? ""} onChange={(e) => setForm((s) => ({ ...s, filedOn: e.target.value || null }))} />
              </Field>
              <Field>
                <FieldLabel htmlFor="fl-amount">Amount paid (₱, optional)</FieldLabel>
                <Input id="fl-amount" type="number" min={0} step="0.01" value={form.amount ?? ""} onChange={(e) => setForm((s) => ({ ...s, amount: e.target.value === "" ? null : Number(e.target.value) }))} />
              </Field>
            </div>
          ) : null}
          <Field>
            <FieldLabel htmlFor="fl-ref">Reference number</FieldLabel>
            <Input id="fl-ref" value={form.referenceNo} onChange={(e) => setForm((s) => ({ ...s, referenceNo: e.target.value }))} placeholder="PRN, eFPS confirmation, OR number" />
          </Field>
          <Field>
            <FieldLabel htmlFor="fl-url">Attachment link</FieldLabel>
            <Input id="fl-url" value={form.attachmentUrl} onChange={(e) => setForm((s) => ({ ...s, attachmentUrl: e.target.value }))} placeholder="Drive link to the filed form" />
          </Field>
          <Field>
            <FieldLabel htmlFor="fl-notes">Notes</FieldLabel>
            <Input id="fl-notes" value={form.notes} onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))} />
          </Field>
        </div>
        <DialogFooter className="sm:justify-between">
          {id && canDelete ? (
            <Button variant="ghost" className="gap-1.5 text-rose-700" onClick={handleDelete} disabled={saving}>
              <Trash2 className="size-3.5" />
              Remove
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={close} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
