// Relative imports with extensions: `node --test` loads this file without the @/ alias.
import { levelFor, type AccessLevel, type ModuleAccessRow, type ModuleKey, type Overrides } from "./access.ts";
import { holdsPower, rolesIn, type Power, type RolePowerRow, type Who } from "./who.ts";

export type { Power, RolePowerRow };

/**
 * Every page a role can be given, by menu (0093). A role has a level per page; the menu's level
 * is the highest of its pages, kept by the database, and that menu level is what the database
 * enforces. Detail pages (/patients/<id>) count as the page their path starts with. Settings is
 * not here: it stays with the Super Admin. HR management follows the "Runs HR" power, not a level.
 * The keys are seeded in supabase/migrations/0093_roles_pages_powers.sql (tests/pages.test.mjs
 * keeps the two lists equal).
 */
export interface PageDef {
  key: string;
  module: ModuleKey;
  path: string;
  title: string;
  /** Opened by a power rather than a level (the page checks it itself). */
  power?: Power;
}

export const POWERS: { key: Power; title: string; note: string }[] = [
  { key: "runs_hr", title: "Runs HR", note: "Employees, salaries, leave, payroll and compliance (everything under HR)." },
  { key: "finance_work", title: "Finance work", note: "Bank imports, the monthly summary, everyone's time records, donor portal accounts." },
  { key: "bed_exception", title: "May allow a bed-rule exception", note: "With a written reason, logged." },
  { key: "floor_plan_layout", title: "Edits the floor-plan layout", note: "Add, move and retire beds; draw rooms and labels." },
  { key: "driver", title: "Is a driver", note: "Offered as the driver of trips and errands." },
  { key: "clinical_detail", title: "Sees clinical detail", note: "Diagnosis and treatment notes on patient records." },
  { key: "caf_billing", title: "Prepares NCH billing", note: "The monthly Cancer Assistance Fund bill: nights, final, sent, paid." },
  { key: "caf_billing_view", title: "Sees NCH billing", note: "Reads the monthly bills and downloads them." },
];

const p = (module: ModuleKey, key: string, path: string, title: string, power?: Power): PageDef => ({ key: `${module}.${key}`, module, path, title, power });

export const PAGES: PageDef[] = [
  p("dashboard", "home", "/dashboard", "Dashboard"),
  p("calendar", "calendar", "/calendar", "Calendar"),
  p("calendar", "sync_log", "/calendar/sync-log", "Calendar sync log"),
  p("patients", "all", "/patients", "All Patients"),
  p("patients", "house_sheet", "/patients/house-sheet", "House Sheet"),
  p("patients", "today", "/patients/today", "Today Board"),
  p("patients", "floor_plan", "/patients/floor-plan", "Floor Plan"),
  p("patients", "appointments", "/patients/appointments", "Appointments"),
  p("patients", "manifest", "/patients/manifest", "Manifest"),
  p("patients", "rides", "/patients/rides", "Rides"),
  p("patients", "stays", "/patients/stays", "Stay History"),
  p("patients", "bed_nights", "/patients/bed-nights", "Bed Nights"),
  p("patients", "waitlist", "/patients/waitlist", "Waitlist"),
  p("patients", "referrals", "/patients/referrals", "Referrals"),
  p("patients", "admit", "/patients/admit", "Admit a child"),
  p("transport", "trips", "/transport", "Trips"),
  p("transport", "fuel", "/transport/fuel", "Fuel Monitoring"),
  p("transport", "report", "/transport/report", "Transport report"),
  p("staff", "home", "/staff", "Staff & Time"),
  p("staff", "dtr", "/staff/dtr", "Daily Time Record"),
  p("staff", "roster", "/staff/roster", "Roster"),
  p("staff", "timesheets", "/staff/timesheets", "Timesheets"),
  p("staff", "volunteers", "/staff/volunteers", "Volunteers"),
  p("inventory", "overview", "/inventory", "Inventory"),
  p("inventory", "assets", "/inventory/assets", "Fixed Assets"),
  p("inventory", "locations", "/inventory/locations", "Storage Locations"),
  p("inventory", "expiry", "/inventory/expiry", "Expiry Alerts"),
  p("inventory", "waste", "/inventory/waste", "Waste Log"),
  p("inventory", "scan", "/inventory/scan", "Find an Item"),
  p("hr", "management", "/hr", "HR management", "runs_hr"),
  p("hr", "my_leave", "/hr/leave", "My Leave"),
  p("hr", "my_payslips", "/hr/payslips", "My Payslips"),
  p("compliance", "tracker", "/compliance", "Compliances"),
  p("house_ops", "overview", "/house-ops", "House Operations"),
  p("house_ops", "meals", "/house-ops/meals", "Meals"),
  p("house_ops", "care_cart", "/house-ops/care-cart", "Care Cart"),
  p("house_ops", "activity_center", "/house-ops/activity-center", "Activity Center"),
  p("house_ops", "stocks", "/house-ops/stocks", "House Operations Stocks"),
  p("donors", "list", "/donors", "Donors"),
  p("donors", "receipts", "/donors/receipts", "Acknowledgment Receipts"),
  p("donors", "donee_certs", "/donors/donee-certs", "Donee Certificates"),
  p("donors", "campaigns", "/donors/campaigns", "Campaigns"),
  p("donors", "cleanup", "/donors/cleanup", "Donor clean-up"),
  p("donors", "cash", "/donors/cash", "Cash gifts"),
  p("donors", "intake", "/donors/intake", "New cash gift"),
  p("donors", "totals", "/donors/totals", "Donation totals"),
  p("finance", "overview", "/finance", "Financial Tracking"),
  p("finance", "monthly_summary", "/finance/monthly-summary", "Monthly Summary"),
  p("finance", "bank_import", "/finance/bank-import", "Bank Import"),
  p("finance", "accounts", "/finance/accounts", "Accounts"),
  p("finance", "approvals", "/finance/approvals", "Approvals"),
  p("finance", "allocation", "/finance/allocation", "Program Allocation"),
  p("finance", "cost_per_outcome", "/finance/cost-per-outcome", "Cost per Outcome"),
  p("finance", "budget", "/finance/budget", "Budget vs Actual"),
  p("finance", "close", "/finance/close", "Monthly Close"),
  p("finance", "registers", "/finance/registers", "AR / Donee Cert Registers"),
  p("finance", "vehicle_costs", "/finance/vehicle-costs", "Vehicle costs"),
  p("finance", "entry", "/finance/entry", "New Cash Entry"),
  p("analytics", "dashboard", "/analytics", "Analytics"),
  p("reports", "catalogue", "/reports", "Reports"),
  p("reports", "documents", "/reports/documents", "Documents"),
  p("reports", "builder", "/reports/builder", "Report Builder"),
  p("reports", "schedule", "/reports/schedule", "Scheduled Delivery"),
  p("reports", "caf_billing", "/reports/caf-billing", "NCH billing", "caf_billing_view"),
  p("executive", "overview", "/executive", "Executive Overview"),
];

/** Menus whose pages are looked at, never changed, here (the Dashboard, Inventory, HR's own pages, Analytics, Executive). */
export const VIEW_ONLY_MODULES: readonly ModuleKey[] = ["dashboard", "inventory", "hr", "analytics", "executive"];

/** One page-level row as shared.role_page_access holds it. */
export interface RolePageRow {
  role: string;
  page: string;
  level: AccessLevel;
}

/** The page a path belongs to: the longest catalogue path it starts with; null outside the catalogue. */
export function pageForPath(path: string): PageDef | null {
  let best: PageDef | null = null;
  for (const page of PAGES) {
    if ((path === page.path || path.startsWith(`${page.path}/`)) && (!best || page.path.length > best.path.length)) best = page;
  }
  return best;
}

/**
 * A person's level on a page: the Super Admin edits everything; a page opened by a power is
 * Edit with it and None without; a menu the person has an override for (0091) is that level on
 * every page of it; otherwise the highest level any of their roles has on the page. Without page
 * rows yet (before 0093) the menu level decides, as it did.
 */
export function pageLevel(
  page: PageDef,
  who: Who,
  input: { pageRows: readonly RolePageRow[]; moduleRows: readonly ModuleAccessRow[]; powers: readonly RolePowerRow[]; overrides?: Overrides; isHr?: boolean }
): AccessLevel {
  const roles = rolesIn(who);
  if (roles.includes("admin")) return "edit";
  if (page.power) return holdsPower(who, page.power, input.powers) || (page.power === "runs_hr" && input.isHr) ? "edit" : "none";
  const own = input.overrides?.[page.module];
  if (own) return own;
  if (input.pageRows.length === 0) return levelFor(input.moduleRows, who, page.module);
  const levels = input.pageRows.filter((r) => r.page === page.key && roles.includes(r.role)).map((r) => r.level);
  return levels.includes("edit") ? "edit" : levels.includes("view") ? "view" : "none";
}
