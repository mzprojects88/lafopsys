import type { Role } from "@/lib/types/common";
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

export const NAV_ITEMS: NavItem[] = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard, allowedRoles: "all" },
  { title: "Staff & Time", href: "/staff", icon: Clock, allowedRoles: "all" },
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
    allowedRoles: ["admin", "house_staff", "finance"],
  },
  {
    title: "Financial",
    href: "/finance",
    icon: Wallet,
    allowedRoles: ["admin", "finance", "board"],
  },
  { title: "Analytics", href: "/analytics", icon: BarChart3, allowedRoles: "all" },
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
