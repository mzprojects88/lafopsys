/**
 * The dashboard's cards and quick actions (0147), and how a person's saved layout becomes what they see. Pure, so
 * tests/dashboard-catalog.test.mjs runs it under node --test.
 */
export type CardKey =
  | "housing" | "rides" | "meals" | "child_visits" | "care_cart" | "patients" | "cash" | "gifts" | "expenses"
  | "in_house" | "since_2024" | "waiting" | "funds" | "budget" | "compliance" | "volunteers" | "stock"
  | "transport_costs" | "caf_nights" | "staff_in";

/** In the order a new dashboard shows them; `main` cards are on by default, the others are switched on by the person. */
export const CARDS: { key: CardKey; title: string; main: boolean; now?: boolean }[] = [
  { key: "housing", title: "Housing · Bed nights provided", main: true },
  { key: "rides", title: "Transportation · Patient and caregiver rides", main: true },
  { key: "meals", title: "Meals served", main: true },
  { key: "child_visits", title: "Child visits supported", main: true },
  { key: "care_cart", title: "Care Cart meals served", main: true },
  { key: "cash", title: "Cash donations", main: true },
  { key: "gifts", title: "Gifts in kind", main: true },
  { key: "expenses", title: "Expenses", main: true },
  { key: "patients", title: "Unique patients admitted", main: true },
  { key: "in_house", title: "In the house now", main: false, now: true },
  { key: "since_2024", title: "Since 2024", main: false },
  { key: "waiting", title: "Waiting on me", main: false, now: true },
  { key: "funds", title: "Funds", main: false, now: true },
  { key: "budget", title: "Budget used this year", main: false },
  { key: "compliance", title: "Compliance due", main: false, now: true },
  { key: "volunteers", title: "Volunteers", main: false },
  { key: "stock", title: "Stock alerts", main: false, now: true },
  { key: "transport_costs", title: "Fuel spent", main: false },
  { key: "caf_nights", title: "NCH (CAF) nights", main: false },
  { key: "staff_in", title: "Staff clocked in", main: false, now: true },
];

export type ActionKey =
  | "admit" | "house_today" | "floor_plan" | "new_request" | "requests" | "ledger" | "funds" | "receive_donation" | "cash_gift"
  | "donors" | "new_trip" | "log_fuel" | "care_cart" | "activity_center" | "clock" | "punches" | "dtr" | "leave"
  | "generate_report" | "programs_report" | "compliance";

/** `inventory`: the path is in the LAF Inventory app (the page links there). `edit`: offered only to those who may
 * change that page (else seeing it is enough). `roles`: who starts with it. */
export const ACTIONS: { key: ActionKey; label: string; href: string; inventory?: boolean; edit?: boolean; roles: string[] }[] = [
  { key: "admit", label: "Admit a child", href: "/patients/admit", edit: true, roles: ["social_worker", "admin"] },
  { key: "house_today", label: "House Today", href: "/patients/today", edit: true, roles: ["social_worker", "house_staff"] },
  { key: "floor_plan", label: "Bed plan", href: "/patients/floor-plan", roles: ["social_worker"] },
  { key: "new_request", label: "New payment request", href: "/requests/new", roles: ["social_worker", "driver", "office_admin", "chef", "house_staff", "inventory_lead", "admin"] },
  { key: "requests", label: "Payment Requests to sign", href: "/requests", roles: ["finance", "ceo", "office_admin", "board"] },
  { key: "ledger", label: "Ledger", href: "/finance/ledger", roles: ["finance", "ceo", "board"] },
  { key: "funds", label: "Funds & Advances", href: "/finance/funds", roles: ["finance"] },
  { key: "receive_donation", label: "Receive a donation", href: "/intake", inventory: true, roles: ["inventory_lead", "inventory_staff", "admin"] },
  { key: "cash_gift", label: "New cash gift", href: "/donors/intake", edit: true, roles: ["finance"] },
  { key: "donors", label: "Donors", href: "/donors", roles: ["ceo", "board"] },
  { key: "new_trip", label: "Trips", href: "/transport", roles: ["driver"] },
  { key: "log_fuel", label: "Log fuel", href: "/transport/fuel", edit: true, roles: ["driver"] },
  { key: "care_cart", label: "Care Cart", href: "/house-ops/care-cart", edit: true, roles: ["chef"] },
  { key: "activity_center", label: "Activity Center", href: "/house-ops/activity-center", edit: true, roles: [] },
  { key: "clock", label: "Clock in / out", href: "/staff", roles: ["driver", "chef", "house_staff", "inventory_staff"] },
  { key: "punches", label: "Punches", href: "/staff/punches", roles: ["office_admin"] },
  { key: "dtr", label: "My DTR", href: "/staff/dtr", roles: [] },
  { key: "leave", label: "Leave", href: "/hr/leave", roles: [] },
  { key: "generate_report", label: "Generate report", href: "/reports/generate", roles: ["ceo", "admin", "board"] },
  { key: "programs_report", label: "Programs report", href: "/reports/programs", roles: ["ceo", "board"] },
  { key: "compliance", label: "Compliances", href: "/compliance", roles: ["office_admin", "finance"] },
];

export const MAX_ACTIONS = 8;

export interface SavedLayout {
  cards: string[];
  actions: string[];
  period: string;
}

/**
 * What a person sees: their saved cards in their order, kept only while their profile still has them (a card the
 * Super Admin takes away disappears); with nothing saved, the main cards their profile has. Their saved quick actions
 * that they may still use, else their roles' defaults (up to MAX_ACTIONS).
 */
export function resolveLayout(
  saved: SavedLayout | null,
  allowed: ReadonlySet<string>,
  roles: readonly string[],
  mayUse: (a: (typeof ACTIONS)[number]) => boolean
): { cards: CardKey[]; actions: ActionKey[]; period: string } {
  const known = new Set<string>(CARDS.map((c) => c.key));
  const cards = (saved ? saved.cards : CARDS.filter((c) => c.main).map((c) => c.key)).filter((k) => known.has(k) && allowed.has(k)) as CardKey[];
  const usable = ACTIONS.filter(mayUse);
  const byKey = new Map(usable.map((a) => [a.key as string, a.key]));
  const actions = saved
    ? saved.actions.map((k) => byKey.get(k)).filter((k): k is ActionKey => !!k)
    : usable.filter((a) => a.roles.some((r) => roles.includes(r))).map((a) => a.key);
  return { cards, actions: actions.slice(0, MAX_ACTIONS), period: saved?.period ?? "this_year" };
}

/** A card moved one place up or down in a list (unchanged at either end). */
export function move<T>(list: readonly T[], item: T, by: -1 | 1): T[] {
  const i = list.indexOf(item);
  const j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return [...list];
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
