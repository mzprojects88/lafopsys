"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { createClient } from "@/lib/supabase/client";
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import { updateCashFromTracker } from "@/app/(app)/settings/actions";
import { formatDate } from "@/lib/utils/date";
import { formatTime12 } from "@/lib/utils/time12";
import { dayKey } from "@/lib/utils/dtr";

/**
 * Settings › Donation Tracker (0110): accounting's 2026 LAF Donation Tracker is read every half
 * hour -- cash gifts (CASH tab) until the switch is turned off, deposits and the bank statement
 * tab for as long as accounting keeps them. Shows the last read per tab and "Check now".
 */
export function DonationTrackerCard() {
  const { cashFromAppSince, loading, refetch } = useAppSettings();
  const trackerIsRecord = cashFromAppSince === null;
  const [saving, setSaving] = React.useState(false);
  const [checking, setChecking] = React.useState(false);
  const [runs, setRuns] = React.useState<{ tab: string; at: string; failed: boolean; written: number }[]>([]);
  const [version, setVersion] = React.useState(0);

  React.useEffect(() => {
    let live = true;
    void createClient()
      .schema("ops")
      .from("tracker_sync_runs")
      .select("tab, started_at, finished_at, status, written")
      .order("started_at", { ascending: false })
      .limit(30)
      .then(({ data }) => {
        if (!live) return;
        const seen = new Map<string, { tab: string; at: string; failed: boolean; written: number }>();
        for (const r of data ?? []) if (!seen.has(r.tab as string)) seen.set(r.tab as string, { tab: r.tab as string, at: (r.finished_at ?? r.started_at) as string, failed: r.status === "failed", written: Number(r.written) });
        setRuns([...seen.values()]);
      });
    return () => {
      live = false;
    };
  }, [version]);

  async function handleRecord(next: boolean) {
    setSaving(true);
    const result = await updateCashFromTracker(next);
    setSaving(false);
    if (!result.ok) return void toast.error(result.error ?? "Couldn't update this setting.");
    toast.success(next ? "The tracker's CASH tab is read again and is the record of cash gifts." : "From today, cash gifts are entered in Donors › New cash gift; the CASH tab is no longer read.");
    await refetch();
  }

  async function checkNow() {
    setChecking(true);
    const res = await fetch("/api/donors/tracker-sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trigger: "manual" }) });
    const r = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; tabs?: { tab: string; status: string }[] };
    setChecking(false);
    if (!res.ok || r.ok === false) toast.error(r.error ?? `Some tabs couldn't be read (${(r.tabs ?? []).filter((t) => t.status === "failed").map((t) => t.tab).join(", ")}).`);
    else toast.success(r.tabs?.length ? `Read ${r.tabs.length} changed tab${r.tabs.length === 1 ? "" : "s"}.` : "Nothing changed on the tracker.");
    setVersion((v) => v + 1);
  }

  const when = (iso: string) => {
    const d = new Date(iso);
    return `${formatDate(dayKey(d))}, ${formatTime12(d.toLocaleTimeString("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit" }))}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">Accounting&apos;s Donation Tracker is the record of cash gifts</span>
          <span className="text-xs text-muted-foreground">
            {trackerIsRecord
              ? "Every half hour the CASH tab is read into Donors › Cash gifts (confirmed names become gifts with their LAF-CSH receipt), deposits from BDO_CASH DONATIONS, and new rows of the Bank Statement tab into Finance › Bank Import. Turn off when accounting enters cash gifts in the app."
              : `Cash gifts are entered in the app since ${formatDate(cashFromAppSince!)}; the CASH tab is no longer read. Deposits and the bank statement tab are still read.`}
          </span>
        </div>
        <Switch checked={trackerIsRecord} onCheckedChange={handleRecord} disabled={loading || saving} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          {runs.length === 0 ? <span>Not read yet.</span> : null}
          {runs.map((r) => (
            <span key={r.tab} className={r.failed ? "text-warning" : undefined}>
              {r.tab}: last read {when(r.at)}
              {r.failed ? " — something couldn't be read" : r.written ? ` (${r.written} rows)` : ""}
            </span>
          ))}
        </div>
        <Button size="sm" variant="outline" disabled={checking} onClick={() => void checkNow()}>
          <RefreshCw className={checking ? "animate-spin" : undefined} /> Check now
        </Button>
      </div>
    </div>
  );
}
