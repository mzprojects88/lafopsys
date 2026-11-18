"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import { updateMealsBackDays } from "@/app/(app)/settings/actions";

/** How far back staff may record a meal, by tick or ID card scan (0166, owner 19 Nov 2026: 60 days). */
export function MealsBackDays() {
  const { mealsBackDays, loading, refetch } = useAppSettings();
  const [typed, setTyped] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  async function save() {
    setSaving(true);
    const result = await updateMealsBackDays(Number(typed));
    setSaving(false);
    if (!result.ok) return void toast.error(result.error ?? "Couldn't save.");
    toast.success("Saved.");
    setTyped(null);
    await refetch();
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <span className="text-xs text-muted-foreground">
        Meals may be recorded (ticked or scanned) for today and up to this many days back. Admins can always fix an older day.
      </span>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        Up to
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          max={365}
          aria-label="Days back a meal may be recorded"
          className="w-20"
          value={typed ?? String(mealsBackDays)}
          disabled={loading}
          onChange={(e) => setTyped(e.target.value)}
        />
        days back
        <Button size="sm" onClick={() => void save()} disabled={saving || typed === null || typed.trim() === ""}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
