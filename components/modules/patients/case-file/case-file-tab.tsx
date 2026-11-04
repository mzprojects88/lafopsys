"use client";

import * as React from "react";
import { toast } from "sonner";
import { CalendarPlus, Eye, FileDown, FilePlus2, Loader2, Sparkles, Trash2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { createCollectionFamily, useCollection } from "@/lib/data/collection-store";
import { DOCUMENT_KINDS, FORMS, FORM_GROUPS, SESSION_FORMS, folderStatus, type DocumentKind, type FormId } from "@/lib/case-files/forms";
import { useCaseFile, type CaseRecord } from "@/lib/hooks/use-case-files";
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import { useReferralsData } from "@/lib/hooks/use-referrals-collection";
import { useTripsData } from "@/lib/hooks/use-trips-collection";
import { arrivalLabel } from "@/lib/utils/arrival";
import { useArrivalRides } from "@/lib/hooks/use-arrival-rides-collection";
import type { Appointment, Patient, Stay } from "@/lib/types/patient";
import { formatDate } from "@/lib/utils/date";
import { formatTime12 } from "@/lib/utils/time12";
import { plainError } from "@/lib/utils/plain-error";
import { CaseRecordDialog, downloadCasePdf, type CaseRecordDraft } from "./case-record-dialog";

/** Items handed to the family from LAF Inventory (GIK distribution names the child, 0055). */
const itemsGiven = createCollectionFamily<{ date: string; quantity: number; name: string }[]>({
  key: "inventory.transactions.to_patient",
  empty: [],
  tables: () => [{ schema: "inventory", table: "transactions" }],
  fetch: async (patientId) => {
    const { data, error } = await createClient()
      .schema("inventory")
      .from("transactions")
      .select("date, quantity, items(name)")
      .eq("recipient_patient_id", patientId)
      .eq("type", "issue")
      .is("archived_at", null);
    if (error) return [];
    return (data ?? []).map((r) => ({ date: r.date as string, quantity: Number(r.quantity), name: ((r.items as { name?: string } | null)?.name ?? "Item") as string }));
  },
});

type JourneyEntry = { on: string; what: string; detail?: string; kind: "referral" | "stay" | "appointment" | "ride" | "items" | "record" | "document" };

const STATUS_LABEL: Record<CaseRecord["status"], string> = { scheduled: "Booked", draft: "Draft", approved: "Approved" };

/**
 * The social worker's case file for one child (0124): the journey through LAF, the case records
 * and the folder's papers. The social worker works it; the Super Admin and the CEO see it read-only
 * (`canEdit` false); the database keeps everyone else out.
 */
export function CaseFileTab({ patient, stays, appointments, canEdit }: { patient: Patient; stays: Stay[]; appointments: Appointment[]; canEdit: boolean }) {
  const cf = useCaseFile(patient.id, true);
  const { caseAiReading } = useAppSettings();
  const { referrals } = useReferralsData();
  const { trips } = useTripsData();
  const { rides } = useArrivalRides();
  const { data: items } = useCollection(itemsGiven.get(patient.id));
  const [draft, setDraft] = React.useState<CaseRecordDraft | null>(null);
  const [kind, setKind] = React.useState<DocumentKind>("intake_sheet");
  const [uploading, setUploading] = React.useState(false);
  const [reading, setReading] = React.useState<string | null>(null);
  const fileInput = React.useRef<HTMLInputElement | null>(null);

  const journey = React.useMemo<JourneyEntry[]>(() => {
    const out: JourneyEntry[] = [];
    for (const r of referrals.filter((r) => r.admittedPatientId === patient.id)) out.push({ on: r.date, what: "Referred", detail: `${r.referringPerson}${r.department ? ` · ${r.department}` : ""}`, kind: "referral" });
    for (const s of stays) {
      out.push({ on: s.checkInAt.slice(0, 10), what: "Checked in", detail: s.arrivalMode ? `Arrived by ${arrivalLabel(s.arrivalMode, rides.find((r) => r.id === s.arrivalRideId)?.app)}` : undefined, kind: "stay" });
      if (s.checkOutAt) out.push({ on: s.checkOutAt.slice(0, 10), what: "Checked out", kind: "stay" });
    }
    for (const a of appointments) out.push({ on: a.date, what: `Appointment${a.clinic ? ` · ${a.clinic}` : ""}`, detail: [a.purpose, a.time ? formatTime12(a.time) : ""].filter(Boolean).join(" · "), kind: "appointment" });
    for (const t of trips.filter((t) => t.passengerPatientIds.includes(patient.id))) out.push({ on: t.date, what: t.direction === "to_hospital" ? "Ride to the hospital" : t.direction === "from_hospital" ? "Ride to LAF House" : "Ride", kind: "ride" });
    const byDay = new Map<string, string[]>();
    for (const i of items) byDay.set(i.date, [...(byDay.get(i.date) ?? []), `${i.name} × ${i.quantity}`]);
    for (const [on, list] of byDay) out.push({ on, what: "Items given", detail: list.join(", "), kind: "items" });
    for (const r of cf.records) out.push({ on: r.heldOn ?? (r.scheduledAt ?? r.updatedAt).slice(0, 10), what: FORMS[r.form].title, detail: STATUS_LABEL[r.status], kind: "record" });
    for (const d of cf.documents) out.push({ on: d.uploadedAt.slice(0, 10), what: `Paper added · ${DOCUMENT_KINDS[d.kind]}`, detail: d.aiSummary ?? undefined, kind: "document" });
    return out.sort((a, b) => b.on.localeCompare(a.on));
  }, [referrals, stays, rides, appointments, trips, items, cf.records, cf.documents, patient.id]);

  // An item is in the folder as an approved app record or an uploaded paper.
  const missing = folderStatus(cf.records, cf.documents).filter((c) => c.required && !c.have);
  const [folderBusy, setFolderBusy] = React.useState(false);
  async function folderPdf(original: boolean) {
    setFolderBusy(true);
    await downloadCasePdf({ patientId: patient.id, original }, `Case folder - ${original ? patient.legacyCode : patient.patientNumber}`);
    setFolderBusy(false);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    const up = await cf.upload(kind, file);
    setUploading(false);
    if (fileInput.current) fileInput.current.value = "";
    if (!up.ok) return void toast.error(plainError(up.error));
    toast.success(`${DOCUMENT_KINDS[kind]} added to the folder.`);
    if (caseAiReading && up.id) await read(up.id);
  }

  async function read(documentId: string) {
    setReading(documentId);
    const r = await cf.readDocument(documentId);
    setReading(null);
    if (!r.ok) return void toast.error(plainError(r.error));
    toast.success(r.drafted ? `Read: ${r.drafted} draft record${r.drafted === 1 ? "" : "s"} made for you to check and approve.` : "Read: the summary is on the paper.");
  }

  async function view(doc: (typeof cf.documents)[number]) {
    const url = await cf.openDocument(doc);
    if (!url) return void toast.error("Couldn't open this paper.");
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">Case records</CardTitle>
          {canEdit ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <FilePlus2 className="size-4 text-muted-foreground" />
            <select
              aria-label="New record"
              className="h-8 rounded-md border border-input bg-background px-2 text-theme-sm"
              value=""
              onChange={(e) => {
                const form = e.target.value as FormId;
                if (!form) return;
                // The plan is reviewed, not rewritten: a new one starts from the last approved one.
                const last = FORMS[form].carryOver ? cf.records.find((r) => r.form === form && r.status === "approved") : undefined;
                setDraft({ form, startFrom: last?.data });
              }}
            >
              <option value="">New record…</option>
              {FORM_GROUPS.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.forms.map((f) => (
                    <option key={f} value={f}>
                      {FORMS[f].title}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <Button size="sm" onClick={() => setDraft({ form: "casework", book: true })}>
              <CalendarPlus /> Book a session
            </Button>
          </div>
          ) : (
            <span className="text-theme-xs text-muted-foreground">View only: the social worker writes and approves.</span>
          )}
        </CardHeader>
        <CardContent className="flex flex-col divide-y divide-border p-0">
          {cf.records.length === 0 ? <p className="px-5 py-4 text-theme-sm text-muted-foreground">No case records yet. Start with the intake sheet.</p> : null}
          {cf.records.map((r) => (
            <button key={r.id} type="button" className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-left text-theme-sm hover:bg-muted/60" onClick={() => setDraft({ form: r.form, record: r })}>
              <span className="font-medium">{FORMS[r.form].title}</span>
              <span className="text-muted-foreground">
                {r.status === "scheduled" && r.scheduledAt ? `${formatDate(r.scheduledAt, "MMM d, yyyy · h:mm a")}${r.venue ? ` · ${r.venue}` : ""}` : formatDate(r.heldOn)}
              </span>
              <Badge variant={r.status === "approved" ? "default" : "outline"} className="ml-auto">
                {STATUS_LABEL[r.status]}
              </Badge>
              {r.status === "approved" ? <span className="text-theme-xs text-muted-foreground">{r.ceoSignedOn ? `CEO signed ${formatDate(r.ceoSignedOn)}` : "Waiting for the CEO's signature"}</span> : null}
            </button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">Folder papers</CardTitle>
          {canEdit ? (
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Which paper" className="h-8 rounded-md border border-input bg-background px-2 text-theme-sm" value={kind} onChange={(e) => setKind(e.target.value as DocumentKind)}>
              {Object.entries(DOCUMENT_KINDS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
            <input ref={fileInput} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            <Button size="sm" disabled={uploading} onClick={() => fileInput.current?.click()}>
              {uploading ? <Loader2 className="animate-spin" /> : <Upload />} Upload a scan or photo
            </Button>
          </div>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-theme-xs text-muted-foreground">
            {missing.length ? `Still missing from the folder: ${missing.map((c) => c.label).join(", ")}.` : "Every required paper is in the folder."}
            {canEdit && caseAiReading ? " New uploads are read by the AI and drafted for you to check." : ""}
          </p>
          {cf.records.some((r) => r.status === "approved") && (
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="outline" disabled={folderBusy} onClick={() => folderPdf(false)}>
                {folderBusy ? <Loader2 className="animate-spin" /> : <FileDown />} Whole folder PDF
              </Button>
              {patient.legacyCode && (
                <Button size="sm" variant="ghost" disabled={folderBusy} onClick={() => folderPdf(true)}>
                  With the original number ({patient.legacyCode})
                </Button>
              )}
            </div>
          )}
          {cf.documents.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border px-3 py-2 text-theme-sm">
              <span className="font-medium">{DOCUMENT_KINDS[d.kind]}</span>
              <span className="truncate text-muted-foreground">{d.fileName}</span>
              <span className="text-theme-xs text-muted-foreground">{formatDate(d.uploadedAt)}</span>
              <div className="ml-auto flex items-center gap-1">
                {canEdit && caseAiReading && d.aiStatus !== "read" ? (
                  <Button size="sm" variant="ghost" disabled={reading === d.id} onClick={() => read(d.id)}>
                    {reading === d.id ? <Loader2 className="animate-spin" /> : <Sparkles />} {d.aiStatus === "failed" ? "Read again" : "Read with AI"}
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" onClick={() => view(d)}>
                  <Eye /> View
                </Button>
                {canEdit ? <Button size="icon-sm" variant="ghost" aria-label="Remove this paper" onClick={async () => { const r = await cf.removeDocument(d); if (!r.ok) toast.error(plainError(r.error)); }}>
                  <Trash2 />
                </Button> : null}
              </div>
              {d.aiSummary ? <p className="w-full text-theme-xs text-muted-foreground">{d.aiSummary}</p> : null}
              {d.aiStatus === "failed" && d.aiError ? <p className="w-full text-theme-xs text-destructive">{d.aiError}</p> : null}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Journey</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ol className="flex flex-col divide-y divide-border">
            {journey.length === 0 ? <li className="px-5 py-4 text-theme-sm text-muted-foreground">Nothing recorded yet.</li> : null}
            {journey.map((j, i) => (
              <li key={i} className="flex gap-4 px-5 py-2.5 text-theme-sm">
                <span className="w-24 shrink-0 tabular-nums text-muted-foreground">{formatDate(j.on)}</span>
                <span className="flex flex-col">
                  <span>{j.what}</span>
                  {j.detail ? <span className="text-theme-xs text-muted-foreground">{j.detail}</span> : null}
                </span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {draft ? (
        <CaseRecordDialog
          key={`${draft.form}-${draft.record?.id ?? "new"}-${draft.book ? "b" : ""}`}
          draft={draft}
          patient={patient}
          readOnly={!canEdit}
          onClose={() => setDraft(null)}
          onSave={cf.save}
          onApprove={cf.approve}
          onReopen={cf.reopen}
          onRemove={cf.remove}
          onCeoSigned={cf.recordCeoSigned}
          onBookNext={(form, on) => setDraft({ form: SESSION_FORMS.includes(form) ? form : "casework", book: true, bookOn: on })}
        />
      ) : null}
    </div>
  );
}

export type { FormId };
