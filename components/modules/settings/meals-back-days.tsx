"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import { updateHistoryNoteDays, updateMealsBackDays } from "@/app/(app)/settings/actions";

/**
 * How far back staff may record a past day: meals by tick or ID card scan (0166, owner 19 Nov 2026: 60 days),
 * and nights, beds, meals and rides in Patients > History (0167, the same figure).
 */
export function MealsBackDays() {
  const { mealsBackDays, loading } = useAppSettings();
  return (
    <DaysSetting
      help="Past days may be recorded up to this many days back: meal ticks and ID card scans, and nights, beds, meals and rides in Patients › History. Admins can always fix an older day."
      label="Days back a past day may be recorded"
      before="Up to"
      after="days back"
      value={mealsBackDays}
      loading={loading}
      save={updateMealsBackDays}
    />
  );
}

/** Patients > History asks why a day is entered late, for days further back than this (0167). */
export function HistoryNoteDays() {
  const { historyNoteDays, loading } = useAppSettings();
  return (
    <DaysSetting
      help="In Patients › History, a note (why the day is entered now) is asked for days further back than this."
      label="Days back before a note is needed"
      before="A note for days more than"
      after="days back"
      value={historyNoteDays}
      loading={loading}
      save={updateHistoryNoteDays}
    />
  );
}

function DaysSetting({ help, label, before, after, value, loading, save }: { help: string; label: string; before: string; after: string; value: number; loading: boolean; save: (days: number) => Promise<{ ok: boolean; error?: string }> }) {
  const { refetch } = useAppSettings();
  const [typed, setTyped] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  async function onSave() {
    setSaving(true);
    const result = await save(Number(typed));
    setSaving(false);
    if (!result.ok) return void toast.error(result.error ?? "Couldn't save.");
    toast.success("Saved.");
    setTyped(null);
    await refetch();
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <span className="text-xs text-muted-foreground">{help}</span>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {before}
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          max={365}
          aria-label={label}
          className="w-20"
          value={typed ?? String(value)}
          disabled={loading}
          onChange={(e) => setTyped(e.target.value)}
        />
        {after}
        <Button size="sm" onClick={() => void onSave()} disabled={saving || typed === null || typed.trim() === ""}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
