import type { Role } from "@/lib/types/common";

/**
 * A person's roles (0073), as pure helpers: no icons, so `node --test` can load
 * them (lib/rbac/roles.ts carries the Lucide icons and re-exports these).
 */

/** One person's roles (0073): just the main role, or the main role and any
 * additional ones. What a person may do is everything any of their roles
 * allows; the main role (always first) gives the default home page. */
export type Who = Role | readonly Role[];
export const rolesIn = (who: Who): readonly Role[] => (typeof who === "string" ? [who] : who);
export const hasAnyRole = (who: Who, ...roles: Role[]) => rolesIn(who).some((r) => roles.includes(r));

/** A staff row as a server action reads it: `select("role, extra_roles, is_hr")`. */
export interface StaffRolesRow {
  role: string;
  extra_roles?: string[] | null;
  is_hr?: boolean | null;
}
export const rolesOfRow = (row: StaffRolesRow): Role[] => [row.role, ...(row.extra_roles ?? [])] as Role[];

/** Runs HR: the Super Admin, the Office Admin (2026-10-02) and anyone flagged
 * is_hr -- the same people as hr.is_hr_staff(), 0073. */
export function runsHr(row: StaffRolesRow): boolean {
  return hasAnyRole(rolesOfRow(row), "admin", "office_admin") || Boolean(row.is_hr);
}

/** Finance work (bank imports, month notes, payroll totals, everyone's DTR): Finance
 * Staff, the Office Admin (Donors & Finance, 2026-10-02) and the Super Admin. */
export function doesFinance(who: Who): boolean {
  return hasAnyRole(who, "admin", "finance", "office_admin");
}

/** The title a person is shown under: CEO or Office Admin when they hold it,
 * whatever their main role (the CEO's main role stays Super Admin, the Office
 * Admin's stays Inventory Lead, so every server check keeps working). Display
 * only -- nothing may gate on it. */
export function titleRole(who: Who): Role {
  const roles = rolesIn(who);
  return roles.includes("ceo") ? "ceo" : roles.includes("office_admin") ? "office_admin" : roles[0]!;
}
