"use client";

import * as React from "react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import { NAME_DOCUMENTS, nameFormat, type NameFormat } from "@/lib/utils/staff-name";
import { updateDocumentNames } from "@/app/(app)/settings/actions";

const LABEL: Record<NameFormat, string> = { name: "Full name", name_title: "Full name + Job title" };

/** Settings > Documents (0094): per document, the staff name alone or with the job title. */
export function DocumentNames() {
  const { documents, loading, refetch } = useAppSettings();
  const [busy, setBusy] = React.useState(false);
  const saved = documents.names;

  async function change(key: string, next: NameFormat) {
    setBusy(true);
    const result = await updateDocumentNames({ ...(saved as Record<string, NameFormat>), [key]: next });
    setBusy(false);
    if (!result.ok) return void toast.error(result.error ?? "Couldn't save.");
    toast.success(`${NAME_DOCUMENTS.find((d) => d.key === key)?.title}: ${LABEL[next]}`);
    await refetch();
  }

  return (
    <div className="flex flex-col gap-3">
      <span className="text-xs text-muted-foreground">
        How a staff member&apos;s name prints on each document. The job title is the one under Manage Users; payslips use the position on the HR record.
      </span>
      <div className="flex flex-col divide-y divide-border rounded-xl border border-border">
        {NAME_DOCUMENTS.map((d) => (
          <div key={d.key} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
            <div className="flex min-w-0 flex-col">
              <span className="text-sm text-foreground">{d.title}</span>
              <span className="text-xs text-muted-foreground">{d.who}</span>
            </div>
            <Select value={nameFormat(saved, d.key)} onValueChange={(v) => void change(d.key, v as NameFormat)} disabled={loading || busy}>
              <SelectTrigger size="sm" className="w-[200px] pl-3 pr-2" aria-label={`Name on ${d.title}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">{LABEL.name}</SelectItem>
                <SelectItem value="name_title">{LABEL.name_title}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
    </div>
  );
}
