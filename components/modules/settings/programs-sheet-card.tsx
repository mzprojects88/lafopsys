"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { createClient } from "@/lib/supabase/client";
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import { updateProgramsSheetIsRecord } from "@/app/(app)/settings/actions";
import { formatDate } from "@/lib/utils/date";
import { formatTime12 } from "@/lib/utils/time12";
import { dayKey } from "@/lib/utils/dtr";

/**
 * Settings › LAF Programs sheet (0103): whether staff's sheet is the record of meals and the Care
 * Cart (read every half hour into the app), when it was last read, and "Check now".
 */
export function ProgramsSheetCard() {
  const { programsFromAppSince, loading, refetch } = useAppSettings();
  const sheetIsRecord = programsFromAppSince === null;
  const [saving, setSaving] = React.useState(false);
  const [checking, setChecking] = React.useState(false);
  const [last, setLast] = React.useState<{ at: string; failed: boolean } | null>(null);

  const [version, setVersion] = React.useState(0);
  React.useEffect(() => {
    let live = true;
    void createClient()
      .schema("ops")
      .from("programs_sync_runs")
      .select("started_at, finished_at, status")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (live) setLast(data ? { at: (data.finished_at ?? data.started_at) as string, failed: data.status === "failed" } : null);
      });
    return () => {
      live = false;
    };
  }, [version]);

  async function handleRecord(next: boolean) {
    setSaving(true);
    const result = await updateProgramsSheetIsRecord(next);
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error ?? "Couldn't update this setting.");
      return;
    }
    toast.success(next ? "The LAF Programs sheet is read again and is the record of meals and the Care Cart." : "From today, House Today's ticks and LAF Inventory's records count.");
    await refetch();
  }

  async function checkNow() {
    setChecking(true);
    const res = await fetch("/api/programs/sheet-sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trigger: "manual" }) });
    const r = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; tabs?: { tab: string; status: string }[] };
    setChecking(false);
    if (!res.ok || r.ok === false) toast.error(r.error ?? `Some tabs couldn't be read (${(r.tabs ?? []).filter((t) => t.status === "failed").map((t) => t.tab).join(", ")}).`);
    else toast.success(r.tabs?.length ? `Read ${r.tabs.length} changed tab${r.tabs.length === 1 ? "" : "s"}.` : "Nothing changed on the sheet.");
    setVersion((v) => v + 1);
  }

  const at = last ? new Date(last.at) : null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">The LAF Programs sheet is the record of meals and the Care Cart</span>
          <span className="text-xs text-muted-foreground">
            {sheetIsRecord
              ? "Every half hour the month tabs (breakfast, lunch and dinner per patient) and the Care Cart tab are read into the app: House Today, House Ops and LAF Inventory show them. Turn off when staff record in the app: House Today's ticks and LAF Inventory's Meals and Care Cart count from that day."
              : `The app's records count from ${formatDate(programsFromAppSince!)}; the sheet is no longer read.`}
          </span>
        </div>
        <Switch checked={sheetIsRecord} onCheckedChange={handleRecord} disabled={loading || saving} />
      </div>
      {sheetIsRecord ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={last?.failed ? "text-xs text-warning" : "text-xs text-muted-foreground"}>
            {at ? `Last read ${formatDate(dayKey(at))}, ${formatTime12(at.toLocaleTimeString("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit" }))}${last?.failed ? " — something couldn't be read" : ""}` : "Not read yet."}
          </span>
          <Button size="sm" variant="outline" disabled={checking} onClick={() => void checkNow()}>
            <RefreshCw className={checking ? "animate-spin" : undefined} /> Check now
          </Button>
        </div>
      ) : null}
    </div>
  );
}
