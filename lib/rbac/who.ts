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

/** What a role may do beyond its pages (0093, shared.role_powers). The Super Admin holds all. */
export type Power = "runs_hr" | "finance_work" | "bed_exception" | "floor_plan_layout" | "driver" | "clinical_detail" | "caf_billing" | "caf_billing_view";
export interface RolePowerRow {
  role: string;
  power: Power;
}

/** The roles' powers as 0093 seeds them: today's behaviour, used until the table has loaded
 * (and on a database without 0093). Keep in step with the seed. */
export const BUILT_IN_POWERS: readonly RolePowerRow[] = [
  { role: "office_admin", power: "runs_hr" },
  { role: "finance", power: "finance_work" },
  { role: "office_admin", power: "finance_work" },
  { role: "social_worker", power: "bed_exception" },
  { role: "inventory_lead", power: "bed_exception" },
  { role: "driver", power: "driver" },
  ...["ceo", "office_admin", "social_worker", "house_staff", "driver", "volunteer", "chef", "inventory_staff", "inventory_lead", "nutritionist"].map(
    (role) => ({ role, power: "clinical_detail" as Power })
  ),
  // NCH billing (0098).
  { role: "social_worker", power: "caf_billing" },
  { role: "office_admin", power: "caf_billing" },
  ...["social_worker", "office_admin", "ceo"].map((role) => ({ role, power: "caf_billing_view" as Power })),
];

// ponytail: one module-level copy of shared.role_powers, set by the client store; server code asks
// the database instead (lib/rbac/server-powers.ts). Role powers are org-wide, not per person.
let livePowers: readonly RolePowerRow[] | null = null;
export function setRolePowers(rows: readonly RolePowerRow[] | null) {
  livePowers = rows;
}

/** Does any of these roles hold the power? */
export function holdsPower(who: Who, power: Power, rows: readonly RolePowerRow[] = livePowers ?? BUILT_IN_POWERS): boolean {
  const roles = rolesIn(who);
  return roles.includes("admin") || rows.some((r) => r.power === power && roles.includes(r.role as Role));
}

/** Runs HR: the Super Admin, the Office Admin (2026-10-02) and anyone flagged
 * is_hr -- the same people as hr.is_hr_staff(), 0073. */
export function runsHr(row: StaffRolesRow): boolean {
  return holdsPower(rolesOfRow(row), "runs_hr") || Boolean(row.is_hr);
}

/** Finance work (bank imports, month notes, payroll totals, everyone's DTR): Finance
 * Staff, the Office Admin (Donors & Finance, 2026-10-02) and the Super Admin. */
export function doesFinance(who: Who): boolean {
  return holdsPower(who, "finance_work");
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

/** Outside accounts (0090): a partner's representative, not LAF staff. The database answers a
 * partner role as "no staff role", so it opens nothing here and is never asked to clock in; it
 * signs in to the Inventory app only, to the areas Settings > Roles & Access gives it. Created
 * like any account, but never an additional role and never mixed with one. */
export const PARTNER_ROLES: readonly Role[] = ["partner_viewer"];
export const isPartnerRole = (role: Role | string): boolean => (PARTNER_ROLES as readonly string[]).includes(role);
/** The roles the Create Staff Account form offers. */
export const CREATABLE_ROLES: readonly Role[] = [...ASSIGNABLE_ROLES, ...PARTNER_ROLES];

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
  if (isPartnerRole(main) || extras.some(isPartnerRole)) return "An outside account is its own kind of account: it can't be mixed with staff roles.";
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
