"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PersonAvatar } from "@/components/patterns/person-avatar";
import { StatusBadge } from "@/components/patterns/status-badge";
import { useRoster } from "@/lib/hooks/use-roster";
import { useTimeEntriesData } from "@/lib/hooks/use-time-entries-collection";
import { useTimePunchesData } from "@/lib/hooks/use-time-punches-collection";
import { useStaffRoster } from "@/lib/hooks/use-staff-roster";
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import { useNow } from "@/lib/hooks/use-now";
import { useRole } from "@/lib/rbac/use-role";
import { canManageHr } from "@/lib/rbac/roles";
import { dayKey } from "@/lib/utils/dtr";
import { formatDate } from "@/lib/utils/date";
import { formatDistance } from "@/lib/utils/site";
import { boardStatus, type BoardStatus } from "@/lib/utils/today-board";

const TONE = {
  good: "bg-emerald-50 text-emerald-700 hover:bg-emerald-50 dark:bg-emerald-500/15 dark:text-emerald-400",
  warn: "bg-amber-50 text-amber-700 hover:bg-amber-50 dark:bg-amber-500/15 dark:text-amber-400",
  bad: "bg-rose-50 text-rose-700 hover:bg-rose-50 dark:bg-rose-500/15 dark:text-rose-400",
  quiet: "bg-slate-100 text-slate-600 hover:bg-slate-100 dark:bg-slate-500/15 dark:text-slate-400",
};

/**
 * Today's roster. Everyone sees who is on duty and whether they are in.
 * Admins and HR also see the supervisor's board (DTR plan phase 3): late
 * past the grace period, not in yet, still in after the shift, at LAF
 * House or off-site, and anyone clocked in who is not on today's roster.
 */
export function TodayBoard() {
  const { role, isHr } = useRole();
  const manages = canManageHr(role, isHr);
  const { onDay, loading } = useRoster();
  const { entries } = useTimeEntriesData();
  const { punches } = useTimePunchesData();
  const { staff } = useStaffRoster();
  const { tardinessGraceMinutes } = useAppSettings();
  const now = useNow();
  const today = dayKey(now);
  const roster = onDay(today);
  const entryOf = (staffId: string | null) => (staffId ? entries.find((t) => t.staffId === staffId && t.date === today) : undefined);
  // The latest clock-in today says where they are (0063).
  const siteOf = (staffId: string) =>
    punches.filter((p) => p.staffId === staffId && p.punchType === "clock_in" && dayKey(p.punchedAt) === today).sort((a, b) => b.punchedAt.localeCompare(a.punchedAt))[0];
  const rostered = new Set(roster.map((e) => e.person.staffId).filter(Boolean));
  const extra = manages ? entries.filter((t) => t.date === today && t.clockIn && !rostered.has(t.staffId)) : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Today&apos;s Roster — {formatDate(today, "EEE, MMM d")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {roster.length === 0 && extra.length === 0 ? <p className="text-sm text-muted-foreground">{loading ? "Loading…" : "Nobody is scheduled today."}</p> : null}
        {roster.map((e) => {
          const entry = entryOf(e.person.staffId);
          const name = `${e.person.firstName} ${e.person.lastName}`;
          const board = boardStatus({ day: today, shift: e.shift!, clockIn: entry?.clockIn ?? null, clockOut: entry?.clockOut ?? null, graceMinutes: tardinessGraceMinutes, now });
          const punch = manages && e.person.staffId ? siteOf(e.person.staffId) : undefined;
          return (
            <div key={e.person.employeeId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm">
              <div className="flex min-w-0 items-center gap-3">
                <PersonAvatar name={name} size="sm" />
                <div className="flex min-w-0 flex-col">
                  <span className="font-medium">{name}</span>
                  <span className="text-xs text-muted-foreground">
                    {e.person.position} · {e.shift!.start}–{e.shift!.end}
                    {e.overridden ? " · changed for today" : ""}
                  </span>
                </div>
              </div>
              {manages ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusPill status={board.status} entry={entry} shiftStart={e.shift!.start} shiftEnd={e.shift!.end} />
                  {board.lateMinutes > 0 ? <Badge className={TONE.bad}>Late {board.lateMinutes} min</Badge> : null}
                  {punch?.siteStatus === "on_site" ? <Badge className={TONE.good}>LAF House</Badge> : null}
                  {punch?.siteStatus === "off_site" ? (
                    <Badge className={TONE.warn}>Off-site{punch.siteDistanceM !== undefined ? ` · ${formatDistance(punch.siteDistanceM)}` : ""}</Badge>
                  ) : null}
                </div>
              ) : entry?.clockIn ? (
                <StatusBadge dot domain="timesheet" status={entry.clockOut ? "approved" : "pending"} label={entry.clockOut ? `Out ${entry.clockOut}` : `In ${entry.clockIn}`} />
              ) : (
                <StatusBadge dot domain="timesheet" status="flagged" label="Not clocked in" />
              )}
            </div>
          );
        })}
        {extra.length > 0 ? (
          <div className="flex flex-col gap-1 rounded-xl border border-dashed px-3 py-2.5 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Clocked in, not on today&apos;s roster</span>
            {extra.map((t) => {
              const s = staff.find((x) => x.id === t.staffId);
              return (
                <span key={t.id}>
                  {s ? `${s.firstName} ${s.lastName}` : "Someone"} · {t.clockOut ? `in ${t.clockIn}, out ${t.clockOut}` : `in since ${t.clockIn}`}
                </span>
              );
            })}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function StatusPill({ status, entry, shiftStart, shiftEnd }: { status: BoardStatus; entry: { clockIn?: string | null; clockOut?: string | null } | undefined; shiftStart: string; shiftEnd: string }) {
  switch (status) {
    case "due":
      return <Badge className={TONE.quiet}>Due {shiftStart}</Badge>;
    case "missing":
      return <Badge className={TONE.bad}>Not in · due {shiftStart}</Badge>;
    case "in":
      return <Badge className={TONE.good}>In {entry?.clockIn}</Badge>;
    case "overdue":
      return <Badge className={TONE.warn}>Still in after {shiftEnd}</Badge>;
    case "out":
      return <Badge className={TONE.quiet}>Out {entry?.clockOut}</Badge>;
  }
}
