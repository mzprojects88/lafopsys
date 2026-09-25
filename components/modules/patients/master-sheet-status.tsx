"use client";

import * as React from "react";
import { toast } from "sonner";
import { formatDistanceToNowStrict } from "date-fns";
import { AlertTriangle, RefreshCw, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import { patientsStore } from "@/lib/hooks/use-patients-collection";
import { sheetChangesStore, useSheetChanges } from "@/lib/hooks/use-sheet-changes";
import { useNow } from "@/lib/hooks/use-now";
import { cn } from "@/lib/utils";

/** Half-hourly syncs; past this something is wrong (job down, secret missing). */
const STALE_MS = 65 * 60_000;

interface Run {
  started_at: string;
  finished_at: string | null;
  status: "running" | "success" | "unchanged" | "failed";
  rows_seen: number;
  inserted: number;
  updated: number;
  changes_found: number;
  new_children_found: number;
  skipped: number;
  details: { notes?: string[]; errors?: string[] } | null;
  error: string | null;
}

/** The last ten reads of the Patients Database sheet (0057), newest first. */
const masterRunsStore = createCollection<Run[]>({
  key: "ops.master_sheet_sync_runs",
  empty: [],
  tables: [{ schema: "ops", table: "master_sheet_sync_runs" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("ops").from("master_sheet_sync_runs").select("*").order("started_at", { ascending: false }).limit(10);
    if (error) throw new Error(error.message);
    return (data ?? []) as Run[];
  },
});

/**
 * One line over the patient list: when the Patients Database sheet was last
 * read, what it changed, and what needs a person (a row the sync would not
 * guess at). "Sync now" for those who edit Patients.
 */
export function MasterSheetStatus({ canRun }: { canRun: boolean }) {
  const { data: runs, loading } = useCollection(masterRunsStore);
  const pending = useSheetChanges().pending.length;
  const now = useNow();
  const [syncing, setSyncing] = React.useState(false);

  const latest = runs[0];
  const lastRead = runs.find((r) => r.status === "success");
  const running = latest?.status === "running";
  const checkedAt = latest ? new Date(latest.finished_at ?? latest.started_at) : null;
  const stale = !checkedAt || now.getTime() - checkedAt.getTime() > STALE_MS;
  const notes = lastRead?.details?.notes ?? [];

  async function syncNow() {
    setSyncing(true);
    try {
      const response = await fetch("/api/patients/master-sheet-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      const r = (await response.json()) as { ok: boolean; status?: string; skipped?: string; error?: string; changes_found?: number; new_children_found?: number; details?: { errors?: string[] } };
      if (r.skipped === "disabled") toast.info("Reading the Patients Database is switched off in Settings.");
      else if (!r.ok) toast.error(r.error ?? r.details?.errors?.[0] ?? "The sync failed.");
      else toast.success(r.status === "unchanged" ? "The original sheet has not changed." : `Read the original sheet: ${r.new_children_found ?? 0} new children and ${r.changes_found ?? 0} changes to review.`);
      await Promise.all([patientsStore.refetch(), sheetChangesStore.refetch()]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl border px-4 py-3 text-theme-xs",
        stale && !loading ? "border-warning/30 bg-warning/10 text-warning-foreground dark:text-warning" : "border-border bg-card text-muted-foreground"
      )}
    >
      {stale && !loading ? <AlertTriangle className="size-3.5 shrink-0" /> : <Table2 className="size-3.5 shrink-0" />}
      <span>
        Original Patients Database (reference) ·{" "}
        {loading
          ? "checking…"
          : running
            ? "reading now…"
            : checkedAt
              ? `last checked ${formatDistanceToNowStrict(checkedAt)} ago${pending > 0 ? ` · ${pending} change${pending === 1 ? "" : "s"} waiting for review` : " · nothing waiting"}${latest?.status === "failed" ? " · last sync failed" : ""}`
              : "never read"}
        {stale && !loading && checkedAt ? " — the half-hourly sync may be down." : ""}
      </span>
      {canRun ? (
        <span className="ml-auto">
          <Button size="sm" variant="outline" onClick={syncNow} disabled={syncing || running}>
            <RefreshCw className={cn("size-3.5", (syncing || running) && "animate-spin")} />
            {syncing ? "Syncing…" : "Sync now"}
          </Button>
        </span>
      ) : null}
      {notes.length > 0 ? (
        <details className="basis-full">
          <summary className="cursor-pointer">{notes.length} row(s) on the sheet need a look</summary>
          <ul className="mt-1 list-disc pl-5">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
