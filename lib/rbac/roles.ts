import type { Role } from "@/lib/types/common";
import { isAllowedLandingPath as isAllowedLandingPathIn, resolveLandingPath as resolveLandingPathIn } from "@/lib/rbac/landing";
import {
  LayoutDashboard,
  Clock,
  Users,
  Home,
  HandCoins,
  Boxes,
  Wallet,
  BarChart3,
  FileText,
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
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard, allowedRoles: ALL_ROLES },
  { title: "Staff & Time", href: "/staff", icon: Clock, allowedRoles: [...ALL_ROLES, ...INVENTORY_ROLES] },
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
