import { CalendarDays, FileText, Users2 } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { StatusBadge } from "@/components/patterns/status-badge";
import { PersonAvatar } from "@/components/patterns/person-avatar";
import { ModuleSubNav, type ModuleSubNavItem } from "@/components/patterns/module-subnav";
import { ClockWidget } from "@/components/modules/staff/clock-widget";
import { ClockInRequiredDialog } from "@/components/modules/staff/clock-in-required-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { staff, shifts, timeEntries } from "@/lib/mock-data";
import { TODAY_ISO } from "@/lib/utils/seeded-random";

const SUB_NAV: ModuleSubNavItem[] = [
  { href: "/staff/roster", label: "Roster", icon: CalendarDays, color: "blue" },
  { href: "/staff/timesheets", label: "Timesheets", icon: FileText, color: "purple" },
  { href: "/staff/volunteers", label: "Volunteers", icon: Users2, color: "green" },
];

export default function StaffPage() {
  const todayShifts = shifts.filter((s) => s.date === TODAY_ISO);
  const todayEntries = timeEntries.filter((t) => t.date === TODAY_ISO);

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
            <CardTitle className="text-base">Today&apos;s Roster — {TODAY_ISO}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {todayShifts.length === 0 && (
              <p className="text-sm text-muted-foreground">No shifts scheduled today.</p>
            )}
            {todayShifts.map((shift) => {
              const person = staff.find((s) => s.id === shift.staffId);
              const entry = todayEntries.find((t) => t.staffId === shift.staffId);
              const name = `${person?.firstName} ${person?.lastName}`;
              return (
                <div
                  key={shift.id}
                  className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm"
                >
                  <div className="flex items-center gap-3">
                    <PersonAvatar name={name} size="sm" />
                    <div className="flex flex-col">
                      <span className="font-medium">{name}</span>
                      <span className="text-xs text-muted-foreground">{person?.position} · {shift.label} shift ({shift.startTime}–{shift.endTime})</span>
                    </div>
                  </div>
                  {entry ? (
                    <StatusBadge dot domain="timesheet" status={entry.flag === "on_time" ? "approved" : "flagged"} label={entry.flag.replace("_", " ")} />
                  ) : (
                    <StatusBadge dot domain="timesheet" status="pending" label="Not clocked in" />
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
