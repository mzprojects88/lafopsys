"use client";

import * as React from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import { updateClockInRequirement } from "@/app/(app)/settings/actions";

export function ClockInRequirementToggle() {
  const { requireClockInForInventoryRoles, loading, refetch } = useAppSettings();
  const [saving, setSaving] = React.useState(false);

  async function handleChange(next: boolean) {
    setSaving(true);
    const result = await updateClockInRequirement(next);
    setSaving(false);

    if (!result.ok) {
      toast.error(result.error ?? "Couldn't update this setting.");
      return;
    }

    toast.success(next ? "Clock-in is now required for inventory roles." : "Clock-in is now optional for inventory roles.");
    await refetch();
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">Require clock-in for inventory roles</span>
        <span className="text-xs text-muted-foreground">
          Chef, Inventory Staff, Inventory Lead, and Nutritionist accounts can use lafopsys without clocking in until this is on.
        </span>
      </div>
      <Switch checked={requireClockInForInventoryRoles} onCheckedChange={handleChange} disabled={loading || saving} />
    </div>
  );
}
