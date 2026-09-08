"use client";

import { Users, Settings2, CalendarRange, Wallet, FileCheck2, Palmtree } from "lucide-react";
import { ModuleSubNav, type ModuleSubNavItem } from "@/components/patterns/module-subnav";
import { useRole } from "@/lib/rbac/use-role";
import { canManageHr } from "@/lib/rbac/roles";

/**
 * The HR module's sub-navigation. Everyone gets the self-service pages;
 * the management pages render only for admins and HR-flagged people
 * (canManageHr). Items for later phases are added as they ship.
 */
const EVERYONE: ModuleSubNavItem[] = [{ href: "/hr/leave", label: "My Leave", icon: Palmtree, color: "green" }];

const HR_ONLY: ModuleSubNavItem[] = [
  { href: "/hr/employees", label: "Employees", icon: Users, color: "blue" },
  { href: "/hr/periods", label: "Pay Periods", icon: CalendarRange, color: "cyan" },
  { href: "/hr/payroll", label: "Payroll", icon: Wallet, color: "purple" },
  { href: "/hr/compliance", label: "Compliance", icon: FileCheck2, color: "amber" },
  { href: "/hr/settings", label: "HR Settings", icon: Settings2, color: "slate" },
];

/** Which of the HR-only pages exist yet; the rest wait for their phase. */
const SHIPPED = new Set(["/hr/employees", "/hr/periods", "/hr/settings"]);

export function HrSubNav() {
  const { role, isHr } = useRole();
  const items = canManageHr(role, isHr) ? [...HR_ONLY.filter((i) => SHIPPED.has(i.href)), ...EVERYONE.filter((i) => SHIPPED.has(i.href))] : EVERYONE.filter((i) => SHIPPED.has(i.href));
  return <ModuleSubNav items={items} />;
}
