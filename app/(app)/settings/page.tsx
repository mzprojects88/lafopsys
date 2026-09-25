import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Database, Users, Bell, RotateCcw, ClipboardCheck, CalendarDays, UserCog } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { IconCircle } from "@/components/patterns/icon-circle";
import { SectionCard } from "@/components/patterns/section-card";
import { ResetDemoDataButton } from "@/components/modules/settings/reset-demo-data-button";
import { ClockInRequirementToggle } from "@/components/modules/settings/clock-in-requirement-toggle";
import { OvertimeThresholdField } from "@/components/modules/settings/overtime-threshold-field";
import { LafHouseLocationField } from "@/components/modules/settings/laf-house-location-field";
import { CalendarSheetSyncToggle } from "@/components/modules/settings/calendar-sheet-sync-toggle";
import { HouseSheetSyncToggle } from "@/components/modules/settings/house-sheet-sync-toggle";
import { HrSettingsCard } from "@/components/modules/settings/hr-settings-card";

const REFERENCE_TABLES = [
  { slug: "provinces", label: "Provinces & Cities" },
  { slug: "diagnoses", label: "Diagnoses" },
  { slug: "treatment-phases", label: "Treatment Phases" },
  { slug: "programs", label: "Programs" },
  { slug: "units-of-measure", label: "Units of Measure" },
];

export default function SettingsPage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Settings" description="Foundation & Access — auth, RBAC, reference data, and demo controls." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <SectionCard title={<CardTitleWithIcon icon={Database}>Reference Data</CardTitleWithIcon>} bodyClassName="flex flex-col gap-1.5">
          {REFERENCE_TABLES.map((t) => (
            <Link key={t.slug} href={`/settings/reference-data/${t.slug}`} className="text-theme-sm text-primary hover:underline">
              {t.label}
            </Link>
          ))}
        </SectionCard>

        <SectionCard title={<CardTitleWithIcon icon={Users}>Users & Roles</CardTitleWithIcon>} bodyClassName="flex flex-col gap-1.5">
          <Link href="/settings/users" className="text-theme-sm text-primary hover:underline">Manage users</Link>
          <Link href="/settings/access" className="text-theme-sm text-primary hover:underline">Roles &amp; access by module</Link>
        </SectionCard>

        <SectionCard title={<CardTitleWithIcon icon={Bell}>Notifications</CardTitleWithIcon>}>
          <Link href="/settings/notifications" className="text-theme-sm text-primary hover:underline">Notification preferences</Link>
        </SectionCard>

        <SectionCard title={<CardTitleWithIcon icon={ClipboardCheck}>Attendance Policy</CardTitleWithIcon>} bodyClassName="flex flex-col gap-4">
          <ClockInRequirementToggle />
          <OvertimeThresholdField />
          <LafHouseLocationField />
        </SectionCard>

        <SectionCard title={<CardTitleWithIcon icon={CalendarDays}>Master Calendar</CardTitleWithIcon>}>
          <CalendarSheetSyncToggle />
        </SectionCard>

        <SectionCard title="House Occupancy Tracker">
          <HouseSheetSyncToggle />
        </SectionCard>

        <SectionCard className="md:col-span-2" title={<CardTitleWithIcon icon={UserCog}>Pay & Leave Policy</CardTitleWithIcon>}>
          <HrSettingsCard />
        </SectionCard>

        <SectionCard title={<CardTitleWithIcon icon={RotateCcw}>Demo Data</CardTitleWithIcon>} bodyClassName="flex flex-col gap-2">
          <p className="text-theme-xs text-muted-foreground">
            This prototype persists your edits to this browser only. Reset to restore the original seed data.
          </p>
          <ResetDemoDataButton />
        </SectionCard>
      </div>
    </div>
  );
}

function CardTitleWithIcon({ icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      <IconCircle icon={icon} size="sm" />
      {children}
    </span>
  );
}
