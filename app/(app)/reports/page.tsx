"use client";

import Link from "next/link";
import { BedDouble, Bus, CalendarClock, ClipboardCheck, FileSpreadsheet, FileText, FolderOpen, MoonStar, Printer, Receipt, type LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { ModuleSubNav, type ModuleSubNavItem } from "@/components/patterns/module-subnav";
import { SectionCard } from "@/components/patterns/section-card";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import { holdsPower, type ModuleKey } from "@/lib/rbac/roles";
import type { Power } from "@/lib/rbac/who";
import { useRole } from "@/context/role-provider";

const SUB_NAV: ModuleSubNavItem[] = [{ href: "/reports/documents", label: "Documents", icon: FolderOpen }];

interface ReportLink {
  href: string;
  label: string;
  what: string;
  out: string;
  icon: LucideIcon;
  /** The module whose view access opens it. */
  module: ModuleKey;
  /** Opened by a power instead of the module (NCH billing, 0098). */
  power?: Power;
}

/**
 * Every report the system produces today, in one place (go-live, 2026-10-13). Each lives
 * inside its own module, so a social worker reaches the bed-night and stay reports from
 * Patients and a driver the transport report from Transport; this page is the catalogue.
 */
const REPORTS: ReportLink[] = [
  { href: "/patients/bed-nights", label: "Bed Nights", what: "Every night a child slept in the house, by night and room and by child, for a month.", out: "Screen · CSV", icon: MoonStar, module: "patients" },
  { href: "/patients/stays", label: "Stay History", what: "Nights and visits with bed, carer, arrival and how each visit ended, for a date range.", out: "Screen · CSV", icon: BedDouble, module: "patients" },
  { href: "/patients/rides", label: "Arrival Rides", what: "Ride-app fares to pay back to families who shared a car from NCH.", out: "Screen", icon: Bus, module: "patients" },
  { href: "/transport/report", label: "Transport & Fuel", what: "Trips, kilometres, fuel and expenses for a day, week, month, quarter or year, per vehicle.", out: "Screen · CSV", icon: FileSpreadsheet, module: "transport" },
  { href: "/transport", label: "Pick-up Manifest", what: "Who was listed and who boarded a LAF HOPE pick-up, with signature lines (Print manifest on the trip).", out: "Print / PDF", icon: Printer, module: "transport" },
  { href: "/transport/fuel", label: "Fuel Monitoring", what: "Cost per km, fuel used, what needs a look and services due.", out: "Screen", icon: ClipboardCheck, module: "transport" },
  { href: "/staff/dtr", label: "Daily Time Record", what: "Hours per person for a date range; sessions and punches with site, device and photo status.", out: "Screen · CSV · CS Form 48 print", icon: CalendarClock, module: "staff" },
  { href: "/hr/timesheets", label: "Timesheets", what: "Per pay period: days, absences, late, undertime, overtime and night minutes, approved by HR.", out: "Screen · CSV", icon: FileText, module: "hr" },
  { href: "/finance/registers", label: "AR & Donee Certificate Registers", what: "Every receipt and certificate number, with gaps flagged.", out: "Screen", icon: Receipt, module: "finance" },
  { href: "/reports/caf-billing", label: "NCH Billing (Cancer Assistance Fund)", what: "The month's bill to NCH from the nights at LAF: Billing Statement, Statements of Account and Endorsement Letters.", out: "Screen · PDF", icon: Receipt, module: "reports", power: "caf_billing_view" },
  { href: "/reports/programs", label: "Programs report", what: "Housing, transportation, meals, Care Cart, LAF Center and CAF by month and year to date, from the app's records, with the sheet's figure beside each until a source is switched off.", out: "Screen · CSV", icon: FileSpreadsheet, module: "reports" },
  { href: "/compliance", label: "DSWD Annex E & G", what: "The yearly DSWD report, printed from the records.", out: "Print / PDF", icon: Printer, module: "compliance" },
];

export default function ReportsPage() {
  const { canView } = useModuleAccess();
  const { roles } = useRole();
  const opens = (r: ReportLink) => (r.power ? holdsPower(roles, r.power) : canView(r.module));
  const open = REPORTS.filter(opens);
  const closed = REPORTS.filter((r) => !opens(r));
  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Reports" description="What the system can report today, and where. Each report opens inside its module." action={<ModuleSubNav items={SUB_NAV} />} />
      <SectionCard title={`Reports you can open (${open.length})`} flush bodyClassName="divide-y divide-border">
        {open.map((r) => (
          <Link key={r.href} href={r.href} className="flex items-start gap-3 px-5 py-3 hover:bg-muted/60">
            <r.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
            <span className="flex min-w-0 flex-col">
              <span className="text-theme-sm font-medium">{r.label} <span className="font-normal text-muted-foreground">· {r.out}</span></span>
              <span className="text-theme-xs text-muted-foreground">{r.what}</span>
            </span>
          </Link>
        ))}
        {open.length === 0 ? <p className="px-5 py-3 text-theme-xs text-muted-foreground">None of the modules with reports are open to your role.</p> : null}
      </SectionCard>
      {closed.length ? (
        <SectionCard title={`Other reports (${closed.length}) — ask an admin for access`} flush bodyClassName="divide-y divide-border">
          {closed.map((r) => (
            <div key={r.href} className="flex items-start gap-3 px-5 py-3 text-muted-foreground">
              <r.icon className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
              <span className="flex min-w-0 flex-col">
                <span className="text-theme-sm">{r.label} · {r.out}</span>
                <span className="text-theme-xs">{r.what}</span>
              </span>
            </div>
          ))}
        </SectionCard>
      ) : null}
    </div>
  );
}
