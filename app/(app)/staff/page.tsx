"use client";

import { CalendarDays, FileText, Fingerprint, Users2 } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { StatusBadge } from "@/components/patterns/status-badge";
import { PersonAvatar } from "@/components/patterns/person-avatar";
import { ModuleSubNav, type ModuleSubNavItem } from "@/components/patterns/module-subnav";
import { ClockWidget } from "@/components/modules/staff/clock-widget";
import { ClockInRequiredDialog } from "@/components/modules/staff/clock-in-required-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useRoster } from "@/lib/hooks/use-roster";
import { useTimeEntriesData } from "@/lib/hooks/use-time-entries-collection";
import { useNow } from "@/lib/hooks/use-now";
import { dayKey } from "@/lib/utils/dtr";
import { formatDate } from "@/lib/utils/date";

const SUB_NAV: ModuleSubNavItem[] = [
  { href: "/staff/dtr", label: "Daily Time Record", icon: Fingerprint, color: "cyan" },
  { href: "/staff/roster", label: "Roster", icon: CalendarDays, color: "blue" },
  { href: "/staff/timesheets", label: "Timesheets", icon: FileText, color: "purple" },
  { href: "/staff/volunteers", label: "Volunteers", icon: Users2, color: "green" },
];

export default function StaffPage() {
  const { onDay, loading } = useRoster();
  const { entries: timeEntries } = useTimeEntriesData();
  // The live Manila day: who the schedules (HR) put on duty today, and
  // whether each has clocked in.
  const today = dayKey(useNow());
  const todayRoster = onDay(today);
  const todayEntries = timeEntries.filter((t) => t.date === today);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <ClockInRequiredDialog />
      <PageHeader
        title="Staff & Timekeeping"
        description="Clock in/out, today's roster, and shift schedule."
        action={<ModuleSubNav items={SUB_NAV} />}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
        <ClockWidget />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Today&apos;s Roster — {formatDate(today, "EEE, MMM d")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {todayRoster.length === 0 && <p className="text-sm text-muted-foreground">{loading ? "Loading…" : "Nobody is scheduled today."}</p>}
            {todayRoster.map((e) => {
              const entry = e.person.staffId ? todayEntries.find((t) => t.staffId === e.person.staffId) : undefined;
              const name = `${e.person.firstName} ${e.person.lastName}`;
              return (
                <div key={e.person.employeeId} className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm">
                  <div className="flex items-center gap-3">
                    <PersonAvatar name={name} size="sm" />
                    <div className="flex flex-col">
                      <span className="font-medium">{name}</span>
                      <span className="text-xs text-muted-foreground">
                        {e.person.position} · {e.shift!.start}–{e.shift!.end}
                        {e.overridden ? " · changed for today" : ""}
                      </span>
                    </div>
                  </div>
                  {entry?.clockIn ? (
                    <StatusBadge dot domain="timesheet" status={entry.clockOut ? "approved" : "pending"} label={entry.clockOut ? `Out ${entry.clockOut}` : `In ${entry.clockIn}`} />
                  ) : (
                    <StatusBadge dot domain="timesheet" status="flagged" label="Not clocked in" />
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
