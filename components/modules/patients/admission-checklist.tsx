"use client";

import * as React from "react";
import { toast } from "sonner";
import { CheckCircle2, Circle, Upload, Plus, X, FileText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { usePatientDocuments, DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS } from "@/lib/hooks/use-patient-documents";
import { useOrientationTopics } from "@/lib/hooks/use-orientation-topics";
import { formatDate } from "@/lib/utils/date";

export function AdmissionChecklist({ patientId }: { patientId: string }) {
  const { documents, markCollected, uploadFile, getSignedUrl } = usePatientDocuments(patientId);
  const { topics, checks, addTopic, removeTopic, toggleCheck } = useOrientationTopics(patientId);
  const [newTopic, setNewTopic] = React.useState("");
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
    const result = await addTopic(newTopic.trim());
    if (!result.ok) {
      toast.error(`Couldn't add topic: ${result.error}`);
      return;
    }
    setNewTopic("");
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h4 className="mb-2 text-sm font-semibold text-muted-foreground">
          Admission Documents <span className="font-normal">(non-blocking — doesn&apos;t gate admission)</span>
        </h4>
        <div className="flex flex-col gap-2">
          {DOCUMENT_TYPES.map((type) => {
            const doc = documents.find((d) => d.documentType === type);
            const collected = !!doc?.collectedAt;
            return (
              <Card key={type}>
                <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <div className="flex items-center gap-2.5">
                    {collected ? (
                      <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                    ) : (
                      <Circle className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{DOCUMENT_TYPE_LABELS[type]}</span>
                      {collected && (
                        <span className="text-xs text-muted-foreground">Collected {formatDate(doc.collectedAt!)}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {doc?.storagePath && (
                      <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => handleView(doc.storagePath!)}>
                        <FileText className="size-3.5" />
                        View
                      </Button>
                    )}
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
                      className="h-7 gap-1 text-xs"
                      onClick={() => fileInputs.current[type]?.click()}
                    >
                      <Upload className="size-3.5" />
                      Upload
                    </Button>
                    {!collected && (
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handleMarkCollected(type)}>
                        Mark collected
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <div>
        <h4 className="mb-2 text-sm font-semibold text-muted-foreground">Orientation Topics Covered</h4>
        {topics.length === 0 ? (
          <p className="text-xs italic text-muted-foreground">
            No orientation topics defined yet. Add the real topics your team covers with families on arrival day below.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {topics.map((t) => {
              const covered = checks.some((c) => c.topicId === t.id);
              return (
                <label key={t.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                  <Checkbox checked={covered} onCheckedChange={(v) => toggleCheck(t.id, !!v)} />
                  <span className="flex-1">{t.topic}</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-6 text-muted-foreground hover:text-destructive"
                    onClick={() => removeTopic(t.id)}
                  >
                    <X className="size-3.5" />
                  </Button>
                </label>
              );
            })}
          </div>
        )}
        <div className="mt-2 flex gap-2">
          <Input
            placeholder="Add a topic (e.g. house rules, meal schedule)…"
            value={newTopic}
            onChange={(e) => setNewTopic(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddTopic()}
          />
          <Button variant="outline" onClick={handleAddTopic}>
            <Plus className="size-4" />
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}
