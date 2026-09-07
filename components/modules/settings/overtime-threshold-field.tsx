"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import { useRole } from "@/lib/rbac/use-role";
import { updateOvertimeThreshold } from "@/app/(app)/settings/actions";

/**
 * How long a normal working day is. Everything past it is overtime, on the
 * timesheets and in the payroll export -- computed from this number every time
 * it is shown, so changing it here re-splits the figures immediately rather
 * than only affecting days recorded from now on.
 *
 * Hours in the box, minutes in the column: half-hours are allowed because a
 * shift pattern that runs 8.5 hours is ordinary, and the server takes minutes
 * so it never has to round a fraction back.
 */
export function OvertimeThresholdField() {
  const { overtimeThresholdMinutes, loading, refetch } = useAppSettings();
  const { role } = useRole();
  const [hours, setHours] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  // Seeded from the setting once it has loaded, and left alone afterwards so
  // typing is never overwritten by a background refetch.
  const seeded = React.useRef(false);
  React.useEffect(() => {
    if (loading || seeded.current) return;
    seeded.current = true;
    setHours(String(overtimeThresholdMinutes / 60));
  }, [loading, overtimeThresholdMinutes]);

  const minutes = Math.round(Number(hours) * 60);
  const changed = Number.isFinite(minutes) && minutes !== overtimeThresholdMinutes;
  const canEdit = role === "admin";

  async function handleSave() {
    setSaving(true);
    const result = await updateOvertimeThreshold(minutes);
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error ?? "Couldn't update this setting.");
      return;
    }
    toast.success(`A working day is now ${hours} hours.`);
    await refetch();
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">Hours in a normal working day</span>
        <span className="text-xs text-muted-foreground">
          Anything worked beyond this in a single day counts as overtime. The Labor Code sets it at 8.
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Input
          type="number"
          min="1"
          max="24"
          step="0.5"
          className="w-20"
          value={hours}
          disabled={loading || !canEdit}
          onChange={(e) => setHours(e.target.value)}
          aria-label="Hours in a normal working day"
        />
        {canEdit ? (
          <Button size="sm" variant="outline" disabled={!changed || saving} onClick={handleSave}>
            {saving ? "Saving…" : "Save"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
