// Relative imports with extensions: `node --test` loads this file without the @/ alias.
import type { Role } from "../types/common.ts";
import { rolesIn, type Who } from "./who.ts";

/**
 * What a person may open: the role grid (shared.module_access, 0050) and one person's own
 * overrides (shared.staff_module_access, 0091). Pure and icon-free so `node --test` can load
 * it; lib/rbac/roles.ts re-exports it beside the nav. The database computes the same thing in
 * shared.module_level().
 */
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
  | "settings"
  | "transport";

export type AccessLevel = "none" | "view" | "edit";

export interface ModuleAccessRow {
  role: Role;
  module: ModuleKey;
  level: AccessLevel;
}

/** One person's override rows, as the table holds them. */
export interface StaffOverrideRow {
  staff_id: string;
  module: ModuleKey;
  level: AccessLevel;
}

/** One person's overrides by module; a module not listed follows their roles. */
export type Overrides = Partial<Record<ModuleKey, AccessLevel>>;

/** Modules that stay with admins whatever the grid or an override says. */
export const ADMIN_ONLY_MODULES: readonly ModuleKey[] = ["settings"];

export const overridesOf = (rows: readonly StaffOverrideRow[], staffId: string | null | undefined): Overrides =>
  Object.fromEntries(rows.filter((r) => r.staff_id === staffId).map((r) => [r.module, r.level]));

/** A person's level for a module: admins always edit; an admin-only module is none for
 * everyone else; the person's own override wins; otherwise the highest level any of their
 * roles has (shared.module_level, 0073 + 0091). No row means none. */
export function levelFor(rows: readonly ModuleAccessRow[], who: Who, module: ModuleKey, overrides?: Overrides): AccessLevel {
  const roles = rolesIn(who);
  if (roles.includes("admin")) return "edit";
  if (ADMIN_ONLY_MODULES.includes(module)) return "none";
  const own = overrides?.[module];
  if (own) return own;
  const levels = rows.filter((r) => roles.includes(r.role) && r.module === module).map((r) => r.level);
  return levels.includes("edit") ? "edit" : levels.includes("view") ? "view" : "none";
}
