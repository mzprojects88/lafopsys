"use client";

import { CalendarDays, FileText, Fingerprint, Users2 } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { ModuleSubNav, type ModuleSubNavItem } from "@/components/patterns/module-subnav";
import { ClockWidget } from "@/components/modules/staff/clock-widget";
import { ClockInRequiredDialog } from "@/components/modules/staff/clock-in-required-dialog";
import { TodayBoard } from "@/components/modules/staff/today-board";

const SUB_NAV: ModuleSubNavItem[] = [
  { href: "/staff/dtr", label: "Daily Time Record", icon: Fingerprint, color: "cyan" },
  { href: "/staff/roster", label: "Roster", icon: CalendarDays, color: "blue" },
  { href: "/staff/timesheets", label: "Timesheets", icon: FileText, color: "purple" },
  { href: "/staff/volunteers", label: "Volunteers", icon: Users2, color: "green" },
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
