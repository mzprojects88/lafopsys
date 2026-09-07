"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCalendarSyncRuns, type CalendarSyncRun } from "@/lib/hooks/use-calendar-sync-runs-collection";
import { useCalendarRemovedEvents, calendarRemovedEventsStore } from "@/lib/hooks/use-calendar-removed-events";
import { calendarEventsStore } from "@/lib/hooks/use-calendar-events-collection";
import { useNow } from "@/lib/hooks/use-now";
import { useRole } from "@/lib/rbac/use-role";
import { dayKey } from "@/lib/utils/dtr";
import { formatDate } from "@/lib/utils/date";
import { VenueBadge } from "@/components/modules/calendar/calendar-list";
import { restoreSheetEvent } from "../actions";

const STATUS_LABEL: Record<CalendarSyncRun["status"], string> = {
  running: "Running",
  success: "Changed",
  unchanged: "No change",
  failed: "Failed",
};

/**
 * Every check of the Google Sheet, and every upcoming event the sheet has
 * dropped since -- the one place a hidden event can be seen and, for an
 * accident, put back.
 */
export default function CalendarSyncLogPage() {
  const { runs, loading } = useCalendarSyncRuns();
  const { removed, loading: removedLoading } = useCalendarRemovedEvents();
  const { role } = useRole();
  const today = dayKey(useNow());
  const [restoring, setRestoring] = React.useState<string | null>(null);

  const upcomingRemoved = removed.filter((e) => e.date >= today);

  async function restore(id: string, title: string) {
    setRestoring(id);
    const result = await restoreSheetEvent(id);
    setRestoring(null);
    if (!result.ok) {
      toast.error(result.error ?? "Couldn't restore that event.");
      return;
    }
    await Promise.all([calendarRemovedEventsStore.refetch(), calendarEventsStore.refetch()]);
    toast.success(`"${title}" is back on the calendar.`);
  }

  const columns: ColumnDef<CalendarSyncRun>[] = [
    { id: "started", header: "Started", accessorFn: (r) => r.startedAt, cell: ({ row }) => formatDate(row.original.startedAt, "MMM d, HH:mm") },
    { id: "trigger", header: "By", accessorFn: (r) => r.trigger, cell: ({ row }) => (row.original.trigger === "cron" ? "Schedule" : "Sync now") },
    {
      id: "status",
      header: "Result",
      accessorFn: (r) => r.status,
      cell: ({ row }) => <StatusBadge dot domain="calendarSync" status={row.original.status} label={STATUS_LABEL[row.original.status]} />,
    },
    { id: "seen", header: "Rows", accessorFn: (r) => r.rowsSeen, cell: ({ row }) => <span className="tabular-nums">{row.original.rowsSeen || "—"}</span> },
    {
      id: "changes",
      header: "Added · Updated · Hidden · Restored",
      accessorFn: (r) => r.inserted + r.updated + r.removed + r.restored,
      cell: ({ row }) => {
        const r = row.original;
        if (r.status !== "success") return <span className="text-muted-foreground">—</span>;
        return (
          <span className="tabular-nums">
            {r.inserted} · {r.updated} · {r.removed} · {r.restored}
            {r.collisions > 0 ? <span className="text-muted-foreground"> · {r.collisions} kept as the app&apos;s</span> : null}
            {r.duplicates > 0 ? <span className="text-muted-foreground"> · {r.duplicates} duplicate rows in the sheet</span> : null}
          </span>
        );
      },
    },
    {
      id: "error",
      header: "Notes",
      accessorFn: (r) => r.error ?? "",
      cell: ({ row }) =>
        row.original.error ? (
          <span className="block max-w-[40ch] truncate text-rose-700 dark:text-rose-400" title={row.original.error}>
            {row.original.error}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Calendar sync log"
        description="Every check of the Google Sheet, and what each one changed."
        action={
          <Button asChild variant="outline">
            <Link href="/calendar">
              <ArrowLeft />
              Back to calendar
            </Link>
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Hidden upcoming events</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            Upcoming events that were on the sheet and no longer are. They are kept here rather than deleted. Restore one only if it
            was removed by accident — the next check hides it again unless it is back in the sheet.
          </p>
          {removedLoading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : upcomingRemoved.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing hidden.</p>
          ) : (
            upcomingRemoved.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">{e.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(e.date, "EEE, MMM d, yyyy")}
                    {e.time ? ` · ${e.time}` : ""} · hidden {formatDate(e.sheetRemovedAt, "MMM d, HH:mm")}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <VenueBadge venue={e.venue} />
                  {role === "admin" ? (
                    <Button size="sm" variant="outline" className="gap-1.5" disabled={restoring === e.id} onClick={() => restore(e.id, e.title)}>
                      <RotateCcw className="size-3.5" />
                      {restoring === e.id ? "Restoring…" : "Restore"}
                    </Button>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Checks</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} data={runs} searchPlaceholder="Search…" emptyMessage={loading ? "Loading…" : "The sheet has not been checked yet."} pageSize={20} />
        </CardContent>
      </Card>
    </div>
  );
}
