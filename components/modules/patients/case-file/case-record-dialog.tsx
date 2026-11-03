"use client";

import * as React from "react";
import { toast } from "sonner";
import { CheckCircle2, FileDown, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FORMS, prefillData, type Field as FormField, type FormData, type FormId } from "@/lib/case-files/forms";
import type { CaseRecord, SaveInput } from "@/lib/hooks/use-case-files";
import type { Patient } from "@/lib/types/patient";
import { formatDate, todayIso } from "@/lib/utils/date";
import { plainError } from "@/lib/utils/plain-error";

type Result = { ok: true } | { ok: false; error: string };

/** "2026-11-03T14:30:00+08:00" from a Manila day and time; and back. */
export const manilaAt = (day: string, time: string) => `${day}T${time || "09:00"}:00+08:00`;
const manilaParts = (iso: string | null) => {
  if (!iso) return { day: todayIso(), time: "09:00" };
  const local = new Date(new Date(iso).getTime() + 8 * 3600_000).toISOString();
  return { day: local.slice(0, 10), time: local.slice(11, 16) };
};

export interface CaseRecordDraft {
  form: FormId;
  record?: CaseRecord;
  /** Opening a booking (a scheduled session) rather than a write-up. */
  book?: boolean;
  bookOn?: string;
}

/**
 * One case form (0124), new or existing, drawn from lib/case-files/forms.ts. A session form can be
 * booked ahead (date, time, venue) or written up once held; the social worker saves a draft or
 * approves. An approved record opens read-only with Reopen, the PDF and the CEO's signing date.
 */
export function CaseRecordDialog({
  draft,
  patient,
  onClose,
  onSave,
  onApprove,
  onReopen,
  onRemove,
  onCeoSigned,
  onBookNext,
}: {
  draft: CaseRecordDraft;
  patient: Patient;
  onClose: () => void;
  onSave: (input: SaveInput) => Promise<Result & { id?: string }>;
  onApprove: (id: string) => Promise<Result>;
  onReopen: (id: string) => Promise<Result>;
  onRemove: (id: string) => Promise<Result>;
  onCeoSigned: (id: string, on: string | null) => Promise<Result>;
  onBookNext: (form: FormId, on: string) => void;
}) {
  const def = FORMS[draft.form];
  const rec = draft.record;
  const approved = rec?.status === "approved";
  const booking = draft.book || rec?.status === "scheduled";
  const when = manilaParts(rec?.scheduledAt ?? (draft.bookOn ? manilaAt(draft.bookOn, "09:00") : null));
  const [data, setData] = React.useState<FormData>(() => rec?.data ?? prefillData(draft.form, patient as unknown as Record<string, unknown>));
  const [heldOn, setHeldOn] = React.useState(rec?.heldOn ?? (booking ? "" : todayIso()));
  const [day, setDay] = React.useState(when.day);
  const [time, setTime] = React.useState(when.time);
  const [venue, setVenue] = React.useState(rec?.venue ?? (def.session ? "Little Ark Foundation Inc." : ""));
  const [held, setHeld] = React.useState(!booking);
  const [signedOn, setSignedOn] = React.useState(rec?.ceoSignedOn ?? "");
  const [pdfOriginal, setPdfOriginal] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const set = (key: string, value: unknown) => setData((d) => ({ ...d, [key]: value }));

  async function run(fn: () => Promise<Result>, ok: string, close = true) {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (!r.ok) return void toast.error(plainError(r.error));
    toast.success(ok);
    if (close) onClose();
  }

  const input = (status: "scheduled" | "draft"): SaveInput => ({
    id: rec?.id,
    form: draft.form,
    status,
    scheduledAt: def.session ? (status === "scheduled" || rec?.scheduledAt ? manilaAt(day, time) : null) : null,
    venue: def.session ? venue : null,
    heldOn: status === "scheduled" ? null : heldOn || null,
    data,
    sourceDocumentId: rec?.sourceDocumentId ?? null,
  });

  async function saveAndApprove() {
    if (!heldOn) return void toast.error("Set the day it took place first.");
    setBusy(true);
    const saved = await onSave(input("draft"));
    if (!saved.ok || !saved.id) {
      setBusy(false);
      return void toast.error(plainError(saved.ok ? "Not saved." : saved.error));
    }
    const r = await onApprove(saved.id);
    setBusy(false);
    if (!r.ok) return void toast.error(plainError(r.error));
    toast.success(`${def.title} approved. The CEO is told it waits for a signature.`);
    onClose();
  }

  async function downloadPdf() {
    if (!rec) return;
    setBusy(true);
    const res = await fetch("/api/case-files/pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recordId: rec.id, original: pdfOriginal }) });
    setBusy(false);
    if (!res.ok) return void toast.error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "The PDF couldn't be made.");
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement("a"), { href: url, download: `${def.title} - ${rec.heldOn ?? "draft"}.pdf` });
    a.click();
    URL.revokeObjectURL(url);
  }

  const nextOn = def.nextSessionKey ? (data[def.nextSessionKey] as string | undefined) : undefined;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{def.title}</DialogTitle>
          <DialogDescription>
            {patient.firstName} {patient.lastName} · {patient.patientNumber}
            {approved ? ` · approved ${formatDate(rec!.approvedAt)}` : rec ? " · draft" : ""}
            {rec?.reopenedTimes ? ` · reopened ${rec.reopenedTimes}×` : ""}
          </DialogDescription>
        </DialogHeader>

        {def.session ? (
          <div className="flex flex-col gap-3 rounded-xl border border-border p-3">
            {!approved && booking ? (
              <div className="flex gap-2">
                <Button type="button" size="sm" variant={held ? "outline" : "default"} onClick={() => setHeld(false)}>
                  Booked
                </Button>
                <Button type="button" size="sm" variant={held ? "default" : "outline"} onClick={() => { setHeld(true); setHeldOn(heldOn || day); }}>
                  It took place
                </Button>
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {held ? (
                <Field>
                  <FieldLabel htmlFor="caseHeld">Date of session</FieldLabel>
                  <Input id="caseHeld" type="date" value={heldOn} max={todayIso()} disabled={approved} onChange={(e) => setHeldOn(e.target.value)} />
                </Field>
              ) : (
                <>
                  <Field>
                    <FieldLabel htmlFor="caseDay">Day</FieldLabel>
                    <Input id="caseDay" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="caseTime">Time</FieldLabel>
                    <Input id="caseTime" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                  </Field>
                </>
              )}
              <Field className={held ? "sm:col-span-2" : ""}>
                <FieldLabel htmlFor="caseVenue">Venue</FieldLabel>
                <Input id="caseVenue" value={venue} maxLength={200} disabled={approved} onChange={(e) => setVenue(e.target.value)} />
              </Field>
            </div>
          </div>
        ) : (
          <Field className="max-w-xs">
            <FieldLabel htmlFor="caseHeld">Date</FieldLabel>
            <Input id="caseHeld" type="date" value={heldOn} max={todayIso()} disabled={approved} onChange={(e) => setHeldOn(e.target.value)} />
          </Field>
        )}

        {held ? (
          <div className="flex flex-col gap-4">
            {def.fields.map((f) => (
              <FieldView key={f.key} field={f} value={data[f.key]} disabled={approved} onChange={(v) => set(f.key, v)} />
            ))}
          </div>
        ) : (
          <p className="text-theme-sm text-muted-foreground">Book the session now; write it up here once it has taken place.</p>
        )}

        {approved ? (
          <div className="flex flex-col gap-3 rounded-xl border border-border p-3">
            <div className="flex flex-wrap items-end gap-3">
              <Field className="w-44">
                <FieldLabel htmlFor="ceoSigned">The CEO signed the PDF on</FieldLabel>
                <Input id="ceoSigned" type="date" value={signedOn} max={todayIso()} onChange={(e) => setSignedOn(e.target.value)} />
              </Field>
              <Button type="button" size="sm" variant="outline" disabled={busy || (signedOn || null) === rec!.ceoSignedOn} onClick={() => run(() => onCeoSigned(rec!.id, signedOn || null), "Signing date saved.", false)}>
                Save signing date
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-theme-xs text-muted-foreground">Case number on the PDF:</span>
              <Button type="button" size="sm" variant={pdfOriginal ? "outline" : "default"} onClick={() => setPdfOriginal(false)}>
                {patient.patientNumber}
              </Button>
              <Button type="button" size="sm" variant={pdfOriginal ? "default" : "outline"} disabled={!patient.legacyCode} onClick={() => setPdfOriginal(true)}>
                {patient.legacyCode ?? "No original number"}
              </Button>
            </div>
          </div>
        ) : null}

        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <div className="flex gap-2">
            {rec && !approved ? (
              <Button type="button" variant="ghost" className="text-destructive" disabled={busy} onClick={() => run(() => onRemove(rec.id), "Removed.")}>
                <Trash2 /> Remove
              </Button>
            ) : null}
            {approved && nextOn ? (
              <Button type="button" variant="outline" onClick={() => onBookNext(draft.form, nextOn)}>
                <Plus /> Book the next session ({formatDate(nextOn)})
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {approved ? (
              <>
                <Button type="button" variant="outline" disabled={busy} onClick={() => run(() => onReopen(rec!.id), "Reopened: the approved version is kept in its history.")}>
                  <RotateCcw /> Reopen
                </Button>
                <Button type="button" disabled={busy} onClick={downloadPdf}>
                  <FileDown /> PDF
                </Button>
              </>
            ) : !held ? (
              <Button type="button" disabled={busy || !day} onClick={() => run(() => onSave(input("scheduled")), `Session booked for ${formatDate(day)}.`)}>
                Book session
              </Button>
            ) : (
              <>
                <Button type="button" variant="outline" disabled={busy} onClick={() => run(() => onSave(input("draft")), "Draft saved.")}>
                  Save draft
                </Button>
                <Button type="button" disabled={busy} onClick={saveAndApprove}>
                  <CheckCircle2 /> Save and approve
                </Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const chip = (on: boolean) =>
  `rounded-full border px-2.5 py-1 text-left text-theme-xs transition-colors ${on ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted"}`;

/** One field of a case form, editable or read-only. */
function FieldView({ field: f, value, disabled, onChange }: { field: FormField; value: unknown; disabled: boolean; onChange: (v: unknown) => void }) {
  const id = `case-${f.key}`;
  if (f.type === "section") return <h4 className="border-b border-border pb-1 pt-2 text-theme-sm font-semibold">{f.label}</h4>;
  if (f.type === "choice" || f.type === "checks") {
    const picked = f.type === "checks" ? (Array.isArray(value) ? (value as string[]) : []) : typeof value === "string" ? [value] : [];
    const toggle = (o: string) =>
      f.type === "checks" ? onChange(picked.includes(o) ? picked.filter((p) => p !== o) : [...picked, o]) : onChange(picked.includes(o) ? undefined : o);
    return (
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-theme-sm font-medium">{f.label}</legend>
        <div className="flex flex-wrap gap-1.5">
          {f.options.map((o) => (
            <button key={o} type="button" role={f.type === "checks" ? "checkbox" : "radio"} aria-checked={picked.includes(o)} disabled={disabled} className={chip(picked.includes(o))} onClick={() => toggle(o)}>
              {o}
            </button>
          ))}
        </div>
      </fieldset>
    );
  }
  if (f.type === "ratings") {
    const v = (value as Record<string, string>) ?? {};
    return (
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-theme-sm font-medium">{f.label}</legend>
        {f.rows.map((r) => (
          <div key={r} className="flex flex-wrap items-center gap-1.5">
            <span className="w-48 text-theme-xs">{r}</span>
            {f.options.map((o) => (
              <button key={o} type="button" role="radio" aria-checked={v[r] === o} disabled={disabled} className={chip(v[r] === o)} onClick={() => onChange({ ...v, [r]: v[r] === o ? undefined : o })}>
                {o}
              </button>
            ))}
          </div>
        ))}
      </fieldset>
    );
  }
  if (f.type === "table") {
    const rows = Array.isArray(value) && value.length ? (value as Record<string, string>[]) : (f.rows ?? []).map((r) => ({ [f.columns[0].key]: r }));
    const setCell = (i: number, key: string, v: string) => onChange(rows.map((r, j) => (j === i ? { ...r, [key]: v } : r)));
    return (
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-theme-sm font-medium">{f.label}</legend>
        {rows.map((r, i) => (
          <div key={i} className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${f.columns.length}, minmax(0, 1fr)) auto` }}>
            {f.columns.map((c) => (
              <Input key={c.key} aria-label={c.label} placeholder={c.label} value={r[c.key] ?? ""} maxLength={300} disabled={disabled} onChange={(e) => setCell(i, c.key, e.target.value)} />
            ))}
            {!disabled ? (
              <Button type="button" size="icon-sm" variant="ghost" aria-label="Remove row" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                <X />
              </Button>
            ) : null}
          </div>
        ))}
        {!disabled ? (
          <Button type="button" size="sm" variant="outline" className="w-fit" onClick={() => onChange([...rows, {}])}>
            <Plus /> Add a row
          </Button>
        ) : null}
      </fieldset>
    );
  }
  const str = typeof value === "string" ? value : "";
  return (
    <Field>
      <FieldLabel htmlFor={id}>{f.label}</FieldLabel>
      {f.type === "textarea" ? (
        <Textarea id={id} rows={3} value={str} maxLength={5000} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Input id={id} type={f.type === "number" ? "number" : f.type} value={str} maxLength={300} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      )}
    </Field>
  );
}
