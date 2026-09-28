"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import { updateBedMoveHours } from "@/app/(app)/settings/actions";

/** When families may be moved between beds by a bed plan (0071): like hospitals, not at night. */
export function BedMoveHours() {
  const { bedMoves, loading, refetch } = useAppSettings();
  const [from, setFrom] = React.useState<string | null>(null);
  const [until, setUntil] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  async function save() {
    setSaving(true);
    const result = await updateBedMoveHours({ from: from ?? bedMoves.from, until: until ?? bedMoves.until });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error ?? "Couldn't save the hours.");
      return;
    }
    toast.success("Bed move hours saved.");
    setFrom(null);
    setUntil(null);
    await refetch();
  }

  return (
    <div className="flex flex-col gap-3">
      <span className="text-xs text-muted-foreground">
        A suggested bed plan moves families only between these hours (Manila time). Outside them it waits for the next day, as hospitals avoid moving patients at night.
      </span>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        From
        <Input type="time" aria-label="Moves from" className="w-32" value={from ?? bedMoves.from} onChange={(e) => setFrom(e.target.value)} disabled={loading} />
        until
        <Input type="time" aria-label="Moves until" className="w-32" value={until ?? bedMoves.until} onChange={(e) => setUntil(e.target.value)} disabled={loading} />
        <Button size="sm" onClick={() => void save()} disabled={saving || (from === null && until === null)}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
