"use client";

import * as React from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import { updateHouseSheetSync } from "@/app/(app)/settings/actions";

/** The switch for reading the house's Occupancy Tracker into the patients module (0046). */
export function HouseSheetSyncToggle() {
  const { houseSheetSyncEnabled, loading, refetch } = useAppSettings();
  const [saving, setSaving] = React.useState(false);

  async function handleChange(next: boolean) {
    setSaving(true);
    const result = await updateHouseSheetSync(next);
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error ?? "Couldn't update this setting.");
      return;
    }
    toast.success(next ? "The house sheet is read again every half hour." : "Reading stopped — the house sheet page keeps what it has.");
    await refetch();
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">Read the house Occupancy Tracker</span>
        <span className="text-xs text-muted-foreground">
          Every half hour the newest day&apos;s tab is read and each name is matched to a patient record. Names the rules cannot settle are
          sent to OpenAI with a shortlist of similar records (patient and carer names, birth year, province — nothing clinical) and come back
          as a suggestion for a social worker to confirm. OpenAI does not train on API data.
        </span>
      </div>
      <Switch checked={houseSheetSyncEnabled} onCheckedChange={handleChange} disabled={loading || saving} />
    </div>
  );
}
