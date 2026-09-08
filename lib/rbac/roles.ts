import type { Role } from "@/lib/types/common";
import type { FileModule } from "@/lib/utils/file-paths";
import { isAllowedLandingPath as isAllowedLandingPathIn, resolveLandingPath as resolveLandingPathIn } from "@/lib/rbac/landing";
import {
  LayoutDashboard,
  Briefcase,
  CalendarDays,
  Clock,
  Users,
  UserCog,
  Home,
  HandCoins,
  Boxes,
  Wallet,
  BarChart3,
  FileText,
  ShieldCheck,
  Settings,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  allowedRoles: Role[] | "all";
}

export const ALL_ROLES: Role[] = [
  "admin",
  "social_worker",
  "house_staff",
  "driver",
  "finance",
  "board",
  "volunteer",
];

/** laf-inventory-only roles. Real accounts, created from lafopsys like any
 * other, but scoped in lafopsys's own nav to Inventory (read-only) + Staff &
 * Time (DTR) — see NAV_ITEMS below. */
export const INVENTORY_ROLES: Role[] = ["chef", "inventory_staff", "nutritionist", "inventory_lead"];

/** Every role creatable from lafopsys and visible in its login picker.
 * Deliberately a superset of ALL_ROLES — lafopsys is the single place every
 * account gets created org-wide, inventory-only roles included. */
export const ORG_ROLES: Role[] = [...ALL_ROLES, ...INVENTORY_ROLES];

export const LOGIN_VISIBLE_ROLES = ORG_ROLES;

export const NAV_ITEMS: NavItem[] = [
  // The CEO's landing page (0031 seeds landing_path = /executive). First in
  // the list because it is first in his day; board members see it too, since
  // it is the summary they are shown anyway.
  { title: "Executive", href: "/executive", icon: Briefcase, allowedRoles: ["admin", "board"] },
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard, allowedRoles: ALL_ROLES },
  // Everyone on staff reads the calendar, the kitchen included -- who is
  // coming for lunch on Thursday is not an admin secret.
  { title: "Calendar", href: "/calendar", icon: CalendarDays, allowedRoles: [...ALL_ROLES, ...INVENTORY_ROLES] },
  { title: "Staff & Time", href: "/staff", icon: Clock, allowedRoles: [...ALL_ROLES, ...INVENTORY_ROLES] },
  // Everyone has payslips and leave of their own to look at (0035+); what
  // else the page shows depends on canManageHr, not on the role alone.
  { title: "HR", href: "/hr", icon: UserCog, allowedRoles: [...ALL_ROLES, ...INVENTORY_ROLES] },
  {
    title: "Patients & Admissions",
    href: "/patients",
    icon: Users,
    allowedRoles: ["admin", "social_worker"],
  },
  {
    title: "House Operations",
    href: "/house-ops",
    icon: Home,
    allowedRoles: ["admin", "social_worker", "house_staff", "driver"],
  },
  {
    title: "Donors & Donations",
    href: "/donors",
    icon: HandCoins,
    allowedRoles: ["admin", "finance"],
  },
  {
    title: "Inventory",
    href: "/inventory",
    icon: Boxes,
    allowedRoles: ["admin", "house_staff", "finance", ...INVENTORY_ROLES],
  },
  {
    title: "Financial",
    href: "/finance",
    icon: Wallet,
    allowedRoles: ["admin", "finance", "board"],
  },
  // Every government deadline the foundation carries (0043/0044): the CEO
  // and super admin keep it, finance records what was filed. HR-flagged
  // people reach the same page through the HR sub-menu.
  { title: "Compliances", href: "/compliance", icon: ShieldCheck, allowedRoles: ["admin", "finance"] },
  { title: "Analytics", href: "/analytics", icon: BarChart3, allowedRoles: ALL_ROLES },
  {
    title: "Reports",
    href: "/reports",
    icon: FileText,
    allowedRoles: ["admin", "finance", "board"],
  },
  { title: "Settings", href: "/settings", icon: Settings, allowedRoles: ["admin"] },
];

export function isNavItemVisible(item: NavItem, role: Role) {
  return item.allowedRoles === "all" || item.allowedRoles.includes(role);
}

/** The people who actually book things on the master calendar (0032). Also
 * the RLS rule; this only decides whether the buttons render. */
export function canEditCalendar(role: Role) {
  return role === "admin" || role === "social_worker";
}

/** Whether THIS event may be edited: the role must be allowed, and while the
 * Google Sheet sync is on (0034) a sheet-sourced event is the sheet's to
 * change, not the app's. */
export function canEditCalendarEvent(role: Role, event: { source: "app" | "sheet" }, sheetSyncEnabled: boolean) {
  return canEditCalendar(role) && (event.source !== "sheet" || !sheetSyncEnabled);
}

/** Who runs HR: admins, plus anyone an admin flagged as HR (0035's
 * shared.staff.is_hr). Also the RLS rule (hr.is_hr_staff()); this only
 * decides which HR pages and buttons render. */
export function canManageHr(role: Role, isHr: boolean) {
  return role === "admin" || isHr;
}

/** Who sees the Compliances tracker: admins, finance, and anyone flagged as
 * HR. Mirrors the RLS on hr.compliance_filings (0043 + 0044). */
export function canViewCompliance(role: Role, isHr: boolean) {
  return role === "admin" || role === "finance" || isHr;
}

/** Who may record a filing (in progress, submitted, reference): the same
 * people. Adding or editing an obligation, and deleting a filing, stays
 * with canManageHr. */
export function canRecordComplianceFilings(role: Role, isHr: boolean) {
  return canViewCompliance(role, isHr);
}

/** Who may add files to a module's records (the SQL twin is shared.file_write_allowed, 0045). */
export function canUploadFiles(module: FileModule, role: Role, isHr: boolean) {
  switch (module) {
    case "hr":
      return canManageHr(role, isHr);
    case "compliance":
      return canManageHr(role, isHr) || role === "finance";
    case "patients":
      return role === "admin" || role === "social_worker";
    case "donors":
      return role === "admin" || role === "finance";
    default:
      return role === "admin" || role === "finance";
  }
}

/** Who may remove files: the same people, except compliance stays with admins and HR (shared.file_delete_allowed). */
export function canDeleteFiles(module: FileModule, role: Role, isHr: boolean) {
  return module === "compliance" ? canManageHr(role, isHr) : canUploadFiles(module, role, isHr);
}

/** Finance and Board never see clinical detail — enforced at the component level using this flag. */
export function canSeeClinicalDetail(role: Role) {
  return role !== "finance" && role !== "board";
}

/** Post-login destination for this person, against the real navigation.
 * See lib/rbac/landing.ts for the precedence rules. */
export function resolveLandingPath(input: { role: Role; landingPath: string | null | undefined; next: string | null | undefined }) {
  return resolveLandingPathIn(input, NAV_ITEMS);
}

export function isAllowedLandingPath(role: Role, path: string) {
  return isAllowedLandingPathIn(role, path, NAV_ITEMS);
}

/** Every nav href a role can be sent to -- what the landing-page picker offers. */
export function landingChoicesFor(role: Role): { href: string; title: string }[] {
  return NAV_ITEMS.filter((item) => isNavItemVisible(item, role)).map((item) => ({ href: item.href, title: item.title }));
}
