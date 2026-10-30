import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Database, Users, Bell, ClipboardCheck, CalendarDays, UserCog, Truck, MapPinned } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { IconCircle } from "@/components/patterns/icon-circle";
import { SectionCard } from "@/components/patterns/section-card";
import { ClockInRequirementToggle } from "@/components/modules/settings/clock-in-requirement-toggle";
import { OvertimeThresholdField } from "@/components/modules/settings/overtime-threshold-field";
import { LafHouseLocationField } from "@/components/modules/settings/laf-house-location-field";
import { TransportPlacesField } from "@/components/modules/settings/transport-places-field";
import { DocumentSettingsField } from "@/components/modules/settings/document-settings-field";
import { DocumentNames } from "@/components/modules/settings/document-names";
import { CafBillingSettings } from "@/components/modules/settings/caf-billing-settings";
import { ExecSummarySettings } from "@/components/modules/settings/exec-summary-settings";
import { AdmissionTimes } from "@/components/modules/settings/admission-times";
import { CalendarSheetSyncToggle } from "@/components/modules/settings/calendar-sheet-sync-toggle";
import { HouseSheetSyncToggle } from "@/components/modules/settings/house-sheet-sync-toggle";
import { ProgramsSheetCard } from "@/components/modules/settings/programs-sheet-card";
import { DonationTrackerCard } from "@/components/modules/settings/donation-tracker-card";
import { DbSyncCard } from "@/components/modules/settings/db-sync-card";
import { BedMoveHours } from "@/components/modules/settings/bed-move-hours";
import { HrSettingsCard } from "@/components/modules/settings/hr-settings-card";
import { VehiclesCard } from "@/components/modules/settings/vehicles-card";

const REFERENCE_TABLES = [
  { slug: "provinces", label: "Provinces & Cities" },
  { slug: "diagnoses", label: "Diagnoses" },
  { slug: "treatment-phases", label: "Treatment Phases" },
  { slug: "hospitals", label: "Hospitals" },
  { slug: "programs", label: "Programs" },
  { slug: "units-of-measure", label: "Units of Measure" },
  { slug: "vehicle-expense-types", label: "Vehicle Expense Types" },
];

export default function SettingsPage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Settings" description="Foundation & Access — auth, RBAC and reference data." />

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

        <SectionCard id="attendance-policy" className="scroll-mt-24" title={<CardTitleWithIcon icon={ClipboardCheck}>Attendance Policy</CardTitleWithIcon>} bodyClassName="flex flex-col gap-4">
          <ClockInRequirementToggle />
          <OvertimeThresholdField />
          <LafHouseLocationField />
        </SectionCard>

        <SectionCard id="documents" className="scroll-mt-24" title="Receipts & certificates">
          <DocumentSettingsField />
        </SectionCard>
        <SectionCard title={<CardTitleWithIcon icon={CalendarDays}>Master Calendar</CardTitleWithIcon>}>
          <CalendarSheetSyncToggle />
        </SectionCard>

        <SectionCard title="House Occupancy Tracker">
          <HouseSheetSyncToggle />
        </SectionCard>

        <SectionCard title="LAF Programs sheet">
          <ProgramsSheetCard />
        </SectionCard>

        <SectionCard title="Donation Tracker">
          <DonationTrackerCard />
        </SectionCard>

        <SectionCard title="Database sync">
          <DbSyncCard />
        </SectionCard>

        <SectionCard id="document-names" className="scroll-mt-24" title="Documents: staff names">
          <DocumentNames />
        </SectionCard>

        <SectionCard id="nch-billing" className="scroll-mt-24" title="NCH billing (Cancer Assistance Fund)">
          <CafBillingSettings canEdit />
        </SectionCard>

        <SectionCard id="executive-summary" className="scroll-mt-24" title="Executive summary">
          <ExecSummarySettings canEdit />
        </SectionCard>

        <SectionCard title="Admissions: daily reset">
          <AdmissionTimes />
        </SectionCard>
        <SectionCard title="Bed moves">
          <BedMoveHours />
        </SectionCard>

        <SectionCard id="vehicles" className="scroll-mt-24" title={<CardTitleWithIcon icon={Truck}>Vehicles</CardTitleWithIcon>}>
          <VehiclesCard />
        </SectionCard>

        <SectionCard id="transport-places" className="scroll-mt-24 md:col-span-2" title={<CardTitleWithIcon icon={MapPinned}>Transport places</CardTitleWithIcon>}>
          <TransportPlacesField />
        </SectionCard>

        <SectionCard className="md:col-span-2" title={<CardTitleWithIcon icon={UserCog}>Pay & Leave Policy</CardTitleWithIcon>}>
          <HrSettingsCard />
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
