"use client";

import * as React from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import { updateCalendarSheetSync } from "@/app/(app)/settings/actions";

/** The switch that ends the Google Sheet era for the master calendar (0034). */
export function CalendarSheetSyncToggle() {
  const { calendarSheetSyncEnabled, loading, refetch } = useAppSettings();
  const [saving, setSaving] = React.useState(false);

  async function handleChange(next: boolean) {
    setSaving(true);
    const result = await updateCalendarSheetSync(next);
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error ?? "Couldn't update this setting.");
      return;
    }
    toast.success(next ? "The calendar follows the Google Sheet again." : "Sync stopped — every event is now edited in the app.");
    await refetch();
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">Keep syncing from the Google Sheet</span>
        <span className="text-xs text-muted-foreground">
          Every two hours the calendar is refreshed from the sheet, and events that came from it are read-only here. Turn this off
          once the sheet is retired: syncing stops and every event becomes editable in the app.
        </span>
      </div>
      <Switch checked={calendarSheetSyncEnabled} onCheckedChange={handleChange} disabled={loading || saving} />
    </div>
  );
}
