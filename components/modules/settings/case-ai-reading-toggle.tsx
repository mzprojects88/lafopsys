"use client";

import * as React from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import { updateCaseAiReading } from "@/app/(app)/settings/actions";

/** Case files (0124): reading uploaded case documents with the AI. Off until LAF's consent covers it. */
export function CaseAiReadingToggle() {
  const { caseAiReading, loading, refetch } = useAppSettings();
  const [saving, setSaving] = React.useState(false);

  async function handleChange(next: boolean) {
    setSaving(true);
    const result = await updateCaseAiReading(next);
    setSaving(false);
    if (!result.ok) return void toast.error(result.error ?? "Couldn't update this setting.");
    toast.success(next ? "Uploaded case documents are read by the AI and drafted for the social worker." : "AI reading is off: uploads are kept as they are.");
    await refetch();
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">Read uploaded case documents with AI</span>
        <span className="text-xs text-muted-foreground">
          Each scan or photo the social worker uploads is sent to OpenAI, which names the paper, summarizes it and drafts the matching record
          (intake, casework, counseling, home visit, monitoring) for the social worker to check and approve. The papers hold the child&apos;s
          and family&apos;s personal, medical and protection details. LAF&apos;s intake consent says the data is not shared with third parties
          without the family&apos;s explicit consent: turn this on only once the consent form covers it. OpenAI does not train on API data.
        </span>
      </div>
      <Switch checked={caseAiReading} onCheckedChange={handleChange} disabled={loading || saving} />
    </div>
  );
}
