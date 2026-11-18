"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import { formatTime12 } from "@/lib/utils/time12";
import { updateBedRules } from "@/app/(app)/settings/actions";

/**
 * Settings › Bed rules (0163): the two admission rules an admin may switch off, and from which
 * night a long-stay family keeps its bed. One bed per person and locked beds always apply.
 * Every placement a switch or a long stay lets through is logged with the bed exceptions.
 */
export function BedRulesSettings() {
  const { bedRules, admissions, loading, refetch } = useAppSettings();
  const [saving, setSaving] = React.useState(false);
  const [night, setNight] = React.useState<string | null>(null);

  async function save(next: { fillOrder?: boolean; singleSex?: boolean; keepFromNight?: number | null }, done: string) {
    setSaving(true);
    const result = await updateBedRules({ ...bedRules, ...next });
    setSaving(false);
    if (!result.ok) return void toast.error(result.error ?? "Couldn't save the bed rules.");
    toast.success(done);
    setNight(null);
    await refetch();
  }

  const typed = night ?? (bedRules.keepFromNight === null ? "" : String(bedRules.keepFromNight));
  const keepFromNight = typed.trim() === "" ? null : Number(typed);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">Fill rooms in order</span>
          <span className="text-xs text-muted-foreground">
            Room 1 before Room 2, Room 2 before Room 3, regular beds before temporary mattresses. Off: any free bed may be given.
          </span>
        </div>
        <Switch
          aria-label="Fill rooms in order"
          checked={bedRules.fillOrder}
          disabled={loading || saving}
          onCheckedChange={(on) => void save({ fillOrder: on }, on ? "Rooms fill in order again." : "Rooms no longer have to fill in order.")}
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">Single-sex rooms</span>
          <span className="text-xs text-muted-foreground">
            A room holds women carers or men carers, not both; one family may share. Off: women and men carers who are not one family may share a
            room. Each such placement is logged.
          </span>
        </div>
        <Switch
          aria-label="Single-sex rooms"
          checked={bedRules.singleSex}
          disabled={loading || saving}
          onCheckedChange={(on) => void save({ singleSex: on }, on ? "Rooms are single-sex again." : "Single-sex rooms are off.")}
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Long stays keep their bed</span>
        <span className="text-xs text-muted-foreground">
          From this night of a stay, &quot;Same bed as last night&quot; is always allowed, and after the morning reset the family&apos;s bed is
          kept for them until {formatTime12(admissions.finalizeBy)}: nobody else is offered it. Leave it empty to switch this off.
        </span>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          From night
          <Input
            type="number"
            inputMode="numeric"
            min={2}
            max={30}
            aria-label="Keep the same bed from night"
            className="w-20"
            value={typed}
            disabled={loading}
            onChange={(e) => setNight(e.target.value)}
          />
          <Button
            size="sm"
            disabled={saving || night === null}
            onClick={() =>
              void save({ keepFromNight }, keepFromNight === null ? "Long stays no longer keep their bed." : `Families keep their bed from night ${keepFromNight}.`)
            }
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      <span className="text-xs text-muted-foreground">One person per bed and locked beds always apply. Only an admin changes these.</span>
    </div>
  );
}
