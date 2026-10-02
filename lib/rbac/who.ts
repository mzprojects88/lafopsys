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
/** The roles LAF assigns (2026-10-02): Super Admin, Office Admin, Finance Staff, Inventory
 * Lead, Inventory Staff, Social Worker, Driver, Chef & Kitchen Staff -- plus CEO, which is only
 * ever an additional role beside Super Admin (the CEO sees and edits everything). House staff,
 * board, volunteer and nutritionist still exist and keep working for anyone holding them, but
 * are no longer offered. */
export const ASSIGNABLE_ROLES: readonly Role[] = ["admin", "office_admin", "finance", "inventory_lead", "inventory_staff", "social_worker", "driver", "chef"];

/** Main roles a picker offers: the assignable ones (never CEO), plus the one held now. */
export function mainRoleChoices(current: Role): Role[] {
  return ASSIGNABLE_ROLES.includes(current) ? [...ASSIGNABLE_ROLES] : [...ASSIGNABLE_ROLES, current];
}

/** Additional roles a picker offers for a main role: never Super Admin (0074), never the main
 * role, CEO only beside Super Admin; plus any held now, so saving never drops one silently. */
export function extraRoleChoices(main: Role, held: readonly Role[] = []): Role[] {
  const offered = [...ASSIGNABLE_ROLES, "ceo" as Role].filter((r) => r !== "admin" && r !== main && (r !== "ceo" || main === "admin"));
  return [...offered, ...held.filter((r) => !offered.includes(r) && r !== main && r !== "admin")];
}

/** Why a main role + additional roles can't be saved, or null. The server action applies it. */
export function rolesProblem(main: Role, extras: readonly Role[]): string | null {
  if (main === "ceo") return "CEO is an additional role beside Super Admin, not a main role.";
  if (extras.includes("admin")) return "Super Admin can only be a main role.";
  if (extras.includes(main)) return "An additional role can't repeat the main role.";
  if (extras.length > 3) return "At most three additional roles.";
  if (extras.includes("ceo") && main !== "admin") return "CEO goes only beside Super Admin.";
  return null;
}

export function titleRole(who: Who): Role {
  const roles = rolesIn(who);
  return roles.includes("ceo") ? "ceo" : roles.includes("office_admin") ? "office_admin" : roles[0]!;
}
