"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import { formatTime12 } from "@/lib/utils/time12";
import { updateAdmissionTimes } from "@/app/(app)/settings/actions";

/** The daily admission reset (0089): a stay is one night. */
export function AdmissionTimes() {
  const { admissions, loading, refetch } = useAppSettings();
  const [resetAt, setResetAt] = React.useState<string | null>(null);
  const [finalizeBy, setFinalizeBy] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  async function save() {
    setSaving(true);
    const result = await updateAdmissionTimes({ resetAt: resetAt ?? admissions.resetAt, finalizeBy: finalizeBy ?? admissions.finalizeBy });
    setSaving(false);
    if (!result.ok) return void toast.error(result.error ?? "Couldn't save the times.");
    toast.success("Admission times saved.");
    setResetAt(null);
    setFinalizeBy(null);
    await refetch();
  }

  return (
    <div className="flex flex-col gap-3">
      <span className="text-xs text-muted-foreground">
        Every morning at the reset time every child in the house is checked out. Each name on NCH&apos;s sheet for the day is then given tonight&apos;s bed on House Today, to be finished by the finalize time (Manila).
      </span>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        Reset at
        <Input type="time" aria-label="Reset at" className="w-32" value={resetAt ?? admissions.resetAt} onChange={(e) => setResetAt(e.target.value)} disabled={loading} />
        finalize beds by
        <Input type="time" aria-label="Finalize beds by" className="w-32" value={finalizeBy ?? admissions.finalizeBy} onChange={(e) => setFinalizeBy(e.target.value)} disabled={loading} />
        <Button size="sm" onClick={() => void save()} disabled={saving || (resetAt === null && finalizeBy === null)}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
      <span className="text-xs text-muted-foreground">
        Today: reset at {formatTime12(resetAt ?? admissions.resetAt)}, beds finalized by {formatTime12(finalizeBy ?? admissions.finalizeBy)}.
      </span>
    </div>
  );
}
