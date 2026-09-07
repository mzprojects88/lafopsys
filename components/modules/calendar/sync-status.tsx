"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { formatDistanceToNowStrict } from "date-fns";
import { AlertTriangle, RefreshCw, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import { runChangedSomething, useCalendarSyncRuns } from "@/lib/hooks/use-calendar-sync-runs-collection";
import { calendarEventsStore } from "@/lib/hooks/use-calendar-events-collection";
import { useNow } from "@/lib/hooks/use-now";
import { useRole } from "@/lib/rbac/use-role";
import { cn } from "@/lib/utils";

/** Past this, with the sync switched on, something is wrong: the job did not
 * fire, the secret is missing, or the project is asleep. Two hours plus slack. */
const STALE_MS = 2.5 * 60 * 60_000;

/**
 * One line under the calendar's heading saying where the events come from
 * and how fresh they are, with "Sync now" for admins. Reads the run log the
 * route writes (0034), so it is a statement of fact, not a guess.
 */
export function SyncStatus() {
  const { calendarSheetSyncEnabled, loading: settingsLoading } = useAppSettings();
  const { runs, loading: runsLoading } = useCalendarSyncRuns();
  const { role } = useRole();
  const now = useNow();
  const [syncing, setSyncing] = React.useState(false);

  const latest = runs[0];
  const lastChange = runs.find(runChangedSomething);
  const running = latest?.status === "running";
  const lastCheckedAt = latest ? new Date(latest.finishedAt ?? latest.startedAt) : null;
  const stale = calendarSheetSyncEnabled && (!lastCheckedAt || now.getTime() - lastCheckedAt.getTime() > STALE_MS);

  async function syncNow() {
    setSyncing(true);
    try {
      const response = await fetch("/api/calendar/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger: "manual", force: true }),
      });
      const result = (await response.json()) as {
        ok: boolean;
        status?: string;
        skipped?: string;
        error?: string;
        counts?: { inserted: number; updated: number; removed: number; restored: number };
        problems?: string[];
      };
      if (result.skipped === "disabled") {
        toast.info("The sheet sync is switched off in Settings.");
        return;
      }
      if (!result.ok) {
        toast.error(result.error ?? result.problems?.[0] ?? "The sync failed.");
        return;
      }
      await calendarEventsStore.refetch();
      const c = result.counts;
      toast.success(
        c && c.inserted + c.updated + c.removed + c.restored > 0
          ? `Synced: ${c.inserted} added, ${c.updated} updated, ${c.removed} hidden${c.restored ? `, ${c.restored} restored` : ""}.`
          : "Checked the sheet — nothing has changed."
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  if (settingsLoading) return null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border px-3 py-2 text-xs",
        stale && !runsLoading ? "border-amber-200 bg-amber-50/60 text-amber-800 dark:border-amber-900/60 dark:bg-amber-500/10 dark:text-amber-300" : "bg-muted/30 text-muted-foreground"
      )}
    >
      {stale && !runsLoading ? <AlertTriangle className="size-3.5 shrink-0" /> : <Table2 className="size-3.5 shrink-0" />}
      {!calendarSheetSyncEnabled ? (
        <span>Sync is off — events are added and changed here.</span>
      ) : runsLoading ? (
        <span>From the Google Sheet · checking…</span>
      ) : running ? (
        <span>From the Google Sheet · syncing now…</span>
      ) : stale ? (
        <span>
          From the Google Sheet · {lastCheckedAt ? `last checked ${formatDistanceToNowStrict(lastCheckedAt)} ago` : "never checked"} — the scheduled sync may be down.
        </span>
      ) : (
        <span>
          From the Google Sheet · last checked {formatDistanceToNowStrict(lastCheckedAt!)} ago
          {lastChange ? ` · last change ${formatDistanceToNowStrict(new Date(lastChange.finishedAt ?? lastChange.startedAt))} ago` : " · no changes yet"}
          {latest?.status === "failed" ? " · last check failed" : ""}
        </span>
      )}
      <span className="ml-auto flex items-center gap-1.5">
        <Link href="/calendar/sync-log" className="underline-offset-2 hover:underline">
          View log
        </Link>
        {role === "admin" && calendarSheetSyncEnabled ? (
          <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={syncNow} disabled={syncing || running}>
            <RefreshCw className={cn("size-3.5", (syncing || running) && "animate-spin")} />
            {syncing ? "Syncing…" : "Sync now"}
          </Button>
        ) : null}
      </span>
    </div>
  );
}
