"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ExternalLink, Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/patterns/status-badge";
import { useEmployeeDocuments, employeeDocumentsFamily } from "@/lib/hooks/use-employee-detail-collections";
import { useDocumentTypes } from "@/lib/hooks/use-document-types-collection";
import { formatDate } from "@/lib/utils/date";
import { documentValidity } from "@/lib/utils/employment";
import { upsertEmployeeDocument, type EmployeeDocumentInput } from "@/app/(app)/hr/actions";
import { DOCUMENT_STATUSES, type DocumentStatus, type DocumentType, type Employee, type EmployeeDocument } from "@/lib/types/hr";

const STATUS_LABEL = Object.fromEntries(DOCUMENT_STATUSES.map((s) => [s.value, s.label]));

/**
 * The 201 checklist: one row per document type, whether it is on file,
 * where (a Drive link, as the masterlist keeps them), and until when.
 * Clearances and medical certificates go stale; the row says so before
 * DSWD's licensing visit does.
 */
export function DocumentChecklist({ employee, manages, today }: { employee: Employee; manages: boolean; today: string }) {
  const { documentTypes } = useDocumentTypes();
  const { documents, loading } = useEmployeeDocuments(employee.id);
  const [editing, setEditing] = React.useState<{ type: DocumentType; doc: EmployeeDocument | null } | null>(null);
  const byType = new Map(documents.map((d) => [d.documentTypeId, d]));
  const types = documentTypes.filter((t) => t.active);
  const missingRequired = types.filter((t) => t.required && (byType.get(t.id)?.status ?? "missing") === "missing").length;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">201 documents</CardTitle>
        <span className="text-xs text-muted-foreground">{missingRequired === 0 ? "All required documents on file" : `${missingRequired} required missing`}</span>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        {loading && types.length === 0 ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          types.map((t) => {
            const doc = byType.get(t.id) ?? null;
            const status: DocumentStatus = doc?.status ?? "missing";
            const validity = doc ? documentValidity(doc, t.validityMonths, today) : null;
            const shown = status === "complete" && validity && validity.state !== "valid" && validity.state !== "unknown" ? validity.state : status;
            return (
              <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm">
                <div className="flex min-w-0 flex-col">
                  <span className="font-medium">
                    {t.name}
                    {!t.required ? <span className="text-xs text-muted-foreground"> · optional</span> : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {validity?.expiresOn ? `Valid until ${formatDate(validity.expiresOn)}` : doc?.issuedOn ? `Issued ${formatDate(doc.issuedOn)}` : (t.notes ?? "")}
                    {doc?.notes ? ` — ${doc.notes}` : ""}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {doc?.driveUrl ? (
                    <a href={doc.driveUrl} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" aria-label={`Open ${t.name}`}>
                      <ExternalLink className="size-4" />
                    </a>
                  ) : null}
                  <StatusBadge domain="document" status={shown} label={STATUS_LABEL[shown] ?? (shown === "expiring" ? "Expiring" : shown)} />
                  {manages ? (
                    <Button variant="ghost" size="icon-sm" aria-label={`Edit ${t.name}`} onClick={() => setEditing({ type: t, doc })}>
                      <Pencil className="size-3.5" />
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </CardContent>
      {editing ? <DocumentDialog key={editing.type.id} employee={employee} type={editing.type} doc={editing.doc} close={() => setEditing(null)} /> : null}
    </Card>
  );
}

function DocumentDialog({ employee, type, doc, close }: { employee: Employee; type: DocumentType; doc: EmployeeDocument | null; close: () => void }) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState<EmployeeDocumentInput>({
    documentTypeId: type.id,
    status: doc?.status ?? "missing",
    driveUrl: doc?.driveUrl ?? "",
    issuedOn: doc?.issuedOn ?? "",
    expiresOn: doc?.expiresOn ?? "",
    notes: doc?.notes ?? "",
  });

  async function handleSave() {
    setSaving(true);
    const result = await upsertEmployeeDocument(employee.id, form);
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    await employeeDocumentsFamily.get(employee.id).refetch();
    toast.success(`${type.name} updated.`);
    close();
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{type.name}</DialogTitle>
          <DialogDescription>{type.notes ?? "Where it is, and until when it is good."}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="doc-status">Status</FieldLabel>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as DocumentStatus })}>
              <SelectTrigger id="doc-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOCUMENT_STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="doc-url">Link (Drive)</FieldLabel>
            <Input id="doc-url" value={form.driveUrl ?? ""} onChange={(e) => setForm({ ...form, driveUrl: e.target.value })} placeholder="https://drive.google.com/…" />
          </Field>
          <Field>
            <FieldLabel htmlFor="doc-issued">Issued on</FieldLabel>
            <Input id="doc-issued" type="date" value={form.issuedOn ?? ""} onChange={(e) => setForm({ ...form, issuedOn: e.target.value })} />
          </Field>
          <Field>
            <FieldLabel htmlFor="doc-expires">Expires on</FieldLabel>
            <Input id="doc-expires" type="date" value={form.expiresOn ?? ""} onChange={(e) => setForm({ ...form, expiresOn: e.target.value })} />
            {type.validityMonths ? <p className="text-xs text-muted-foreground">Left blank, {type.validityMonths} months from issue.</p> : null}
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="doc-notes">Notes</FieldLabel>
            <Textarea id="doc-notes" rows={2} value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
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
