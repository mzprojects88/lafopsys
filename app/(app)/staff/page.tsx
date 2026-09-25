"use client";

import { CalendarDays, FileText, Fingerprint, Users2 } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { ModuleSubNav, type ModuleSubNavItem } from "@/components/patterns/module-subnav";
import { ClockWidget } from "@/components/modules/staff/clock-widget";
import { ClockInRequiredDialog } from "@/components/modules/staff/clock-in-required-dialog";
import { TodayBoard } from "@/components/modules/staff/today-board";

const SUB_NAV: ModuleSubNavItem[] = [
  { href: "/staff/dtr", label: "Daily Time Record", icon: Fingerprint },
  { href: "/staff/roster", label: "Roster", icon: CalendarDays },
  { href: "/staff/timesheets", label: "Timesheets", icon: FileText },
  { href: "/staff/volunteers", label: "Volunteers", icon: Users2 },
];

export default function StaffPage() {
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

        <TodayBoard />
      </div>
    </div>
  );
}
