"use client";

import * as React from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import { updateHouseSheetSync, updateSheetIsNightlyRecord } from "@/app/(app)/settings/actions";
import { formatDate } from "@/lib/utils/date";

/** The switch for reading the house's Occupancy Tracker into the patients module (0046), and
 * whether it is the record of who stayed each night (0100). */
export function HouseSheetSyncToggle() {
  const { houseSheetSyncEnabled, nightsFromAppSince, loading, refetch } = useAppSettings();
  const [saving, setSaving] = React.useState(false);
  const sheetIsRecord = nightsFromAppSince === null;

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

  async function handleRecord(next: boolean) {
    setSaving(true);
    const result = await updateSheetIsNightlyRecord(next);
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error ?? "Couldn't update this setting.");
      return;
    }
    toast.success(next ? "The House Sheet is the record of who stayed each night again." : "From tonight, the app's check-ins are the record of who stayed.");
    await refetch();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">Read the house Occupancy Tracker</span>
          <span className="text-xs text-muted-foreground">
            Every half hour the newest day&apos;s tab is read and each name is matched to a patient record, and every day&apos;s list is kept as
            that night&apos;s record. Names the rules cannot settle are sent to OpenAI with a shortlist of similar records (patient and carer
            names, birth year, province — nothing clinical) and come back as a suggestion for a social worker to confirm. OpenAI does not train
            on API data.
          </span>
        </div>
        <Switch checked={houseSheetSyncEnabled} onCheckedChange={handleChange} disabled={loading || saving} />
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">The House Sheet is the record of who stayed each night</span>
          <span className="text-xs text-muted-foreground">
            {sheetIsRecord
              ? "NCH billing, Bed Nights and Analytics count the children on each day's tab; beds come from the app where it has them. Turn off when the app's check-ins are complete: they count from that night on."
              : `The app's check-ins count from ${formatDate(nightsFromAppSince!)}; nights before stay as the House Sheet listed them.`}
          </span>
          {sheetIsRecord && !houseSheetSyncEnabled && (
            <span className="text-xs text-warning">Reading the sheet is off, so new nights aren&apos;t being recorded.</span>
          )}
        </div>
        <Switch checked={sheetIsRecord} onCheckedChange={handleRecord} disabled={loading || saving} />
      </div>
    </div>
  );
}
