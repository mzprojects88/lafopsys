"use client";

import * as React from "react";
import { toast } from "sonner";
import { CheckCircle2, Circle, Upload, Plus, X, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { usePatientDocuments, DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS } from "@/lib/hooks/use-patient-documents";
import { useOrientationTopics } from "@/lib/hooks/use-orientation-topics";
import { formatDate } from "@/lib/utils/date";
import { Switch } from "@/components/ui/switch";
import type { Stay } from "@/lib/types/patient";

/**
 * The social worker's admission tasks. Documents belong to the patient (an ID
 * is collected once); the orientation belongs to the STAY (0054) -- the whole
 * list the first time, the shorter one when a family comes back.
 * `canEdit` is Patients edit (0050); view-only access sees it and opens files.
 */
export function AdmissionChecklist({ patientId, canEdit, stay, firstStay }: { patientId: string; canEdit: boolean; stay: Stay | null; firstStay: boolean }) {
  const { documents, markCollected, uploadFile, getSignedUrl } = usePatientDocuments(patientId);
  const { topics, checks, addTopic, removeTopic, setReturneeToo, toggleCheck } = useOrientationTopics(stay?.id, firstStay);
  const covered = topics.filter((t) => checks.some((c) => c.topicId === t.id)).length;
  const [newTopic, setNewTopic] = React.useState("");
  const [newTopicEn, setNewTopicEn] = React.useState("");
  const fileInputs = React.useRef<Record<string, HTMLInputElement | null>>({});

  async function handleFileChange(documentType: (typeof DOCUMENT_TYPES)[number], file: File | undefined) {
    if (!file) return;
    const result = await uploadFile(documentType, file);
    if (!result.ok) {
      toast.error(`Couldn't upload: ${result.error}`);
      return;
    }
    toast.success(`${DOCUMENT_TYPE_LABELS[documentType]} uploaded`);
  }

  async function handleMarkCollected(documentType: (typeof DOCUMENT_TYPES)[number]) {
    const result = await markCollected(documentType);
    if (!result.ok) {
      toast.error(`Couldn't mark as collected: ${result.error}`);
      return;
    }
    toast.success(`${DOCUMENT_TYPE_LABELS[documentType]} marked collected`);
  }

  async function handleView(storagePath: string) {
    const url = await getSignedUrl(storagePath);
    if (!url) {
      toast.error("Couldn't generate a link to this document");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function handleAddTopic() {
    if (!newTopic.trim()) return;
    const result = await addTopic(newTopic.trim(), newTopicEn);
    if (!result.ok) {
      toast.error(`Couldn't add topic: ${result.error}`);
      return;
    }
    setNewTopic("");
    setNewTopicEn("");
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h4 className="mb-2 text-base font-medium">
          Admission Documents <span className="text-theme-sm font-normal text-muted-foreground">(non-blocking — doesn&apos;t gate admission)</span>
        </h4>
        <div className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-card">
          {DOCUMENT_TYPES.map((type) => {
            const doc = documents.find((d) => d.documentType === type);
            const collected = !!doc?.collectedAt;
            return (
              <div key={type} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <div className="flex items-center gap-2.5">
                  {collected ? (
                    <CheckCircle2 className="size-4 shrink-0 text-success-foreground dark:text-success" />
                  ) : (
                    <Circle className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <div className="flex flex-col">
                    <span className="text-theme-sm font-medium">{DOCUMENT_TYPE_LABELS[type]}</span>
                    {collected && (
                      <span className="text-theme-xs text-muted-foreground">Collected {formatDate(doc.collectedAt!)}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {doc?.storagePath && (
                    <Button size="sm" variant="ghost" onClick={() => handleView(doc.storagePath!)}>
                      <FileText />
                      View
                    </Button>
                  )}
                  {canEdit && (
                    <>
                      <input
                        ref={(el) => {
                          fileInputs.current[type] = el;
                        }}
                        type="file"
                        className="hidden"
                        onChange={(e) => handleFileChange(type, e.target.files?.[0])}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => fileInputs.current[type]?.click()}
                      >
                        <Upload />
                        Upload
                      </Button>
                      {!collected && (
                        <Button size="sm" variant="ghost" onClick={() => handleMarkCollected(type)}>
                          Mark collected
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <h4 className="mb-1 text-base font-medium">
          House rules orientation{" "}
          <span className="text-theme-sm font-normal text-muted-foreground">
            {stay
              ? `(${firstStay ? "first stay: the full list" : "returning family: the short list"} — ${covered} of ${topics.length} covered)`
              : "(ticks start when the family is checked in)"}
          </span>
        </h4>
        <p className="mb-2 text-theme-xs text-muted-foreground">
          The list is the house&apos;s own &ldquo;Mga Paalala&rdquo; —{" "}
          <a href="/house-rules/mga-paalala.jpg" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            the printed sheet
          </a>{" "}
          as it hangs in the house.
        </p>
        {topics.length === 0 ? (
          <p className="text-theme-xs italic text-muted-foreground">
            No orientation topics defined yet. Add the real topics your team covers with families on arrival day below.
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-card">
            {topics.map((t) => {
              const isCovered = checks.some((c) => c.topicId === t.id);
              return (
                <div key={t.id} className="flex flex-wrap items-center gap-2 px-5 py-3 text-theme-sm">
                  <label className="flex flex-1 items-start gap-2">
                    <Checkbox className="mt-0.5" checked={isCovered} disabled={!canEdit || !stay} onCheckedChange={(v) => toggleCheck(t.id, !!v)} />
                    <span className="flex flex-col">
                      <span>{t.topic}</span>
                      {t.topicEn && <span className="text-theme-xs text-muted-foreground">{t.topicEn}</span>}
                    </span>
                  </label>
                  {canEdit && (
                    <label className="flex items-center gap-1.5 text-theme-xs text-muted-foreground">
                      <Switch checked={t.returneeToo} onCheckedChange={(v) => setReturneeToo(t.id, v)} aria-label={`Cover "${t.topic}" with returning families too`} />
                      Returnees too
                    </label>
                  )}
                  {canEdit && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-6 text-muted-foreground hover:text-destructive"
                      onClick={() => removeTopic(t.id)}
                      aria-label={`Remove ${t.topic}`}
                    >
                      <X className="size-3.5" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {canEdit && (
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder="Add a rule, as the house says it…"
              value={newTopic}
              onChange={(e) => setNewTopic(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddTopic()}
            />
            <Input
              placeholder="In English (optional)"
              value={newTopicEn}
              onChange={(e) => setNewTopicEn(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddTopic()}
            />
            <Button variant="outline" onClick={handleAddTopic}>
              <Plus className="size-4" />
              Add
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
