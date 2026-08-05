"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

const SEGMENT_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  staff: "Staff & Time",
  roster: "Roster",
  timesheets: "Timesheets",
  "payroll-export": "Payroll Export",
  volunteers: "Volunteers",
  patients: "Patients & Admissions",
  referrals: "Referrals",
  new: "New",
  waitlist: "Waitlist",
  today: "Today Board",
  appointments: "Appointments",
  manifest: "Transport Manifest",
  "house-ops": "House Operations",
  "floor-plan": "Floor Plan",
  meals: "Meals",
  trips: "Trips",
  "care-cart": "Care Cart",
  "activity-center": "Activity Center",
  donors: "Donors & Donations",
  intake: "Donation Intake",
  receipts: "Acknowledgment Receipts",
  "donee-certs": "Donee Certificates",
  campaigns: "Campaigns",
  inventory: "Inventory",
  scan: "Scan",
  locations: "Storage Locations",
  expiry: "Expiry Alerts",
  waste: "Waste Log",
  finance: "Financial",
  entry: "New Entry",
  accounts: "Accounts",
  approvals: "Approvals",
  allocation: "Program Allocation",
  "cost-per-outcome": "Cost per Outcome",
  budget: "Budget vs Actual",
  close: "Monthly Close",
  registers: "AR / Donee Cert Registers",
  analytics: "Analytics",
  reports: "Reports",
  builder: "Report Builder",
  schedule: "Scheduled Delivery",
  documents: "Documents",
  settings: "Settings",
  "reference-data": "Reference Data",
  users: "Users",
  notifications: "Notifications",
  impact: "Public Impact Feed",
};

function labelFor(segment: string) {
  if (SEGMENT_LABELS[segment]) return SEGMENT_LABELS[segment];
  // dynamic segments like [patientId] show as a generic "Detail" crumb
  return "Detail";
}

export function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length === 0) return null;

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {segments.map((segment, i) => {
          const href = "/" + segments.slice(0, i + 1).join("/");
          const isLast = i === segments.length - 1;
          return (
            <span key={href} className="contents">
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage>{labelFor(segment)}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link href={href}>{labelFor(segment)}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!isLast && <BreadcrumbSeparator />}
            </span>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
