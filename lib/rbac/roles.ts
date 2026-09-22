import type { Role } from "@/lib/types/common";
import type { FileModule } from "@/lib/utils/file-paths";
import { isHiddenPath } from "@/lib/rbac/hidden";
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

/** One row per main menu entry in Settings -> Roles & Access (0050's
 * shared.module_access.module). The SQL check constraint lists the same keys. */
export type ModuleKey =
  | "executive"
  | "dashboard"
  | "calendar"
  | "staff"
  | "hr"
  | "patients"
  | "house_ops"
  | "donors"
  | "inventory"
  | "finance"
  | "compliance"
  | "analytics"
  | "reports"
  | "settings";

export type AccessLevel = "none" | "view" | "edit";

export interface ModuleAccessRow {
  role: Role;
  module: ModuleKey;
  level: AccessLevel;
}

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  module: ModuleKey;
  /** Nothing to change on these pages: the grid offers None / View only. */
  viewOnly?: boolean;
  /** Not configurable in the grid; admins only (Settings holds users and this grid). */
  adminOnly?: boolean;
  /** Shown under the module's name in the grid. */
  note?: string;
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
  // The CEO's landing page (0031 seeds landing_path = /executive), first
  // because it is first in his day.
  { title: "Executive", href: "/executive", icon: Briefcase, module: "executive", viewOnly: true, note: "Figures from the modules the person can open." },
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard, module: "dashboard", viewOnly: true, note: "Figures from the modules the person can open." },
  { title: "Calendar", href: "/calendar", icon: CalendarDays, module: "calendar" },
  { title: "Staff & Time", href: "/staff", icon: Clock, module: "staff", note: "Everyone keeps their own clock; Edit adds volunteers." },
  { title: "HR", href: "/hr", icon: UserCog, module: "hr", viewOnly: true, note: "Own leave and payslips. Running HR follows the HR flag in Users." },
  { title: "Patients & Admissions", href: "/patients", icon: Users, module: "patients", note: "Includes the floor plan and the house sheet." },
  { title: "House Operations", href: "/house-ops", icon: Home, module: "house_ops", note: "Also reads resident names, for trips and meals." },
  { title: "Donors & Donations", href: "/donors", icon: HandCoins, module: "donors" },
  { title: "Inventory", href: "/inventory", icon: Boxes, module: "inventory", viewOnly: true, note: "Stock is changed in the LAF Inventory app." },
  { title: "Financial", href: "/finance", icon: Wallet, module: "finance" },
  // Every government deadline the foundation carries (0043/0044); HR-flagged
  // people reach the same page through the HR sub-menu.
  { title: "Compliances", href: "/compliance", icon: ShieldCheck, module: "compliance" },
  { title: "Analytics", href: "/analytics", icon: BarChart3, module: "analytics", viewOnly: true, note: "Figures from the modules the person can open." },
  { title: "Reports", href: "/reports", icon: FileText, module: "reports" },
  { title: "Settings", href: "/settings", icon: Settings, module: "settings", adminOnly: true, note: "Users, roles and this grid: admins only." },
];

/** A role's level for a module: admins always edit (0050 refuses anything
 * else); no row means none. The rows come from shared.module_access. */
export function levelFor(rows: readonly ModuleAccessRow[], role: Role, module: ModuleKey): AccessLevel {
  if (role === "admin") return "edit";
  if (NAV_ITEMS.find((i) => i.module === module)?.adminOnly) return "none";
  return rows.find((r) => r.role === role && r.module === module)?.level ?? "none";
}

export function isNavItemVisible(item: NavItem, role: Role, rows: readonly ModuleAccessRow[]) {
  return !isHiddenPath(item.href) && levelFor(rows, role, item.module) !== "none";
}

/** The module a path belongs to (longest matching menu href), or null for
 * pages outside the menu (login, change PIN, print). */
export function moduleForPath(path: string): ModuleKey | null {
  let best: NavItem | null = null;
  for (const item of NAV_ITEMS) {
    if ((path === item.href || path.startsWith(`${item.href}/`)) && (!best || item.href.length > best.href.length)) best = item;
  }
  return best?.module ?? null;
}

/** The nav as landing.ts wants it: shown items with the roles that can open them. */
function landingNav(rows: readonly ModuleAccessRow[]) {
  return NAV_ITEMS.filter((item) => !isHiddenPath(item.href)).map((item) => ({
    href: item.href,
    allowedRoles: ORG_ROLES.filter((role) => levelFor(rows, role, item.module) !== "none"),
  }));
}

/** Whether THIS event may be edited: the person must have Calendar edit, and
 * while the Google Sheet sync is on (0034) a sheet-sourced event is the
 * sheet's to change, not the app's. */
export function canEditCalendarEvent(canEditCalendar: boolean, event: { source: "app" | "sheet" }, sheetSyncEnabled: boolean) {
  return canEditCalendar && (event.source !== "sheet" || !sheetSyncEnabled);
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

/** Who draws the floor plan (place, rotate, add, retire beds; 0047). The
 * guard trigger on ops.units is the rule; this only decides whether the
 * edit tools render. */
export function canEditFloorPlan(role: Role) {
  return role === "admin";
}

/** Finance and Board never see clinical detail — enforced at the component level using this flag. */
export function canSeeClinicalDetail(role: Role) {
  return role !== "finance" && role !== "board";
}

/** Post-login destination for this person, against the real navigation.
 * See lib/rbac/landing.ts for the precedence rules. */
export function resolveLandingPath(
  input: { role: Role; landingPath: string | null | undefined; next: string | null | undefined },
  rows: readonly ModuleAccessRow[]
) {
  return resolveLandingPathIn(input, landingNav(rows));
}

export function isAllowedLandingPath(role: Role, path: string, rows: readonly ModuleAccessRow[]) {
  return isAllowedLandingPathIn(role, path, landingNav(rows));
}

/** Every nav href a role can be sent to -- what the landing-page picker offers. */
export function landingChoicesFor(role: Role, rows: readonly ModuleAccessRow[]): { href: string; title: string }[] {
  return NAV_ITEMS.filter((item) => isNavItemVisible(item, role, rows)).map((item) => ({ href: item.href, title: item.title }));
}
