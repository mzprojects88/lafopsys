"use client";

import * as React from "react";
import { toast } from "sonner";
import { formatDistanceToNowStrict } from "date-fns";
import { AlertTriangle, RefreshCw, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import { houseSheetPeopleStore, houseSheetRunChangedSomething, useHouseSheetRuns } from "@/lib/hooks/use-house-sheet-collection";
import { useNow } from "@/lib/hooks/use-now";
import { formatDate } from "@/lib/utils/date";
import { cn } from "@/lib/utils";

/** Half-hourly checks; past this something is wrong (job down, secret missing, project asleep). */
const STALE_MS = 65 * 60_000;

/**
 * One line under the heading saying which day's tab was last read and
 * when, with "Check now" for the people who review the sheet. Reads the
 * run log the route writes (0046), so it is a statement of fact.
 */
export function HouseSheetStatus({ canRun }: { canRun: boolean }) {
  const { houseSheetSyncEnabled, loading: settingsLoading } = useAppSettings();
  const { runs, loading: runsLoading } = useHouseSheetRuns();
  const now = useNow();
  const [syncing, setSyncing] = React.useState(false);

  const latest = runs[0];
  const lastChange = runs.find(houseSheetRunChangedSomething);
  const running = latest?.status === "running";
  const lastCheckedAt = latest ? new Date(latest.finishedAt ?? latest.startedAt) : null;
  const lastTab = runs.find((r) => r.tabDate && r.status !== "failed")?.tabDate ?? null;
  const stale = houseSheetSyncEnabled && (!lastCheckedAt || now.getTime() - lastCheckedAt.getTime() > STALE_MS);

  async function checkNow() {
    setSyncing(true);
    try {
      const response = await fetch("/api/patients/house-sheet-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger: "manual", force: true }),
      });
      const result = (await response.json()) as {
        ok: boolean;
        skipped?: string;
        error?: string;
        tabs?: { tab: string; status: string; counts?: { inserted: number; updated: number; offSheet: number; returned: number; autoMatched: number; suggested: number; unmatched: number }; problems?: string[]; error?: string }[];
      };
      if (result.skipped === "disabled") {
        toast.info("Reading the house sheet is switched off in Settings.");
        return;
      }
      if (!result.ok) {
        toast.error(result.error ?? result.tabs?.find((t) => t.error)?.error ?? result.tabs?.flatMap((t) => t.problems ?? [])[0] ?? "The check failed.");
        return;
      }
      await houseSheetPeopleStore.refetch();
      const t = result.tabs?.[0];
      const c = t?.counts;
      toast.success(
        t?.status === "unchanged"
          ? `Checked ${t.tab} — nothing has changed.`
          : c
            ? `Read ${t!.tab}: ${c.inserted} new, ${c.autoMatched} matched, ${c.suggested} suggested, ${c.unmatched} to look at${c.offSheet ? `, ${c.offSheet} left the house` : ""}.`
            : "Checked the sheet."
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The check failed.");
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
      {!houseSheetSyncEnabled ? (
        <span>Reading the Occupancy Tracker is off — nothing new arrives from the sheet.</span>
      ) : runsLoading ? (
        <span>From the Occupancy Tracker · checking…</span>
      ) : running ? (
        <span>From the Occupancy Tracker · reading now…</span>
      ) : stale ? (
        <span>
          From the Occupancy Tracker · {lastCheckedAt ? `last checked ${formatDistanceToNowStrict(lastCheckedAt)} ago` : "never checked"} — the half-hourly check may be down.
        </span>
      ) : (
        <span>
          From the Occupancy Tracker{lastTab ? ` · tab ${formatDate(lastTab, "MMM d")}` : ""} · last checked {formatDistanceToNowStrict(lastCheckedAt!)} ago
          {lastChange ? ` · last change ${formatDistanceToNowStrict(new Date(lastChange.finishedAt ?? lastChange.startedAt))} ago` : " · no changes yet"}
          {latest?.status === "failed" ? " · last check failed" : ""}
        </span>
      )}
      {canRun && houseSheetSyncEnabled ? (
        <span className="ml-auto">
          <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={checkNow} disabled={syncing || running}>
            <RefreshCw className={cn("size-3.5", (syncing || running) && "animate-spin")} />
            {syncing ? "Checking…" : "Check now"}
          </Button>
        </span>
      ) : null}
    </div>
  );
}
