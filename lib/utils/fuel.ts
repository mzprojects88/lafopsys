/**
 * Fuel Monitoring's arithmetic (phase D, 0079): km per litre measured between
 * full tanks, the tank's estimated level, period ranges in Manila calendar
 * days, the period's totals, the checks, and when a service is due. Pure, so
 * tests/fuel.test.mjs runs it under node --test.
 */

export interface FuelFill {
  date: string;
  odometer: number | null;
  litres: number;
  fullTank: boolean;
}

export interface KmPerLitreInterval {
  /** The day of the full fill that closed the interval. */
  to: string;
  km: number;
  litres: number;
  kmPerLitre: number;
}

/**
 * Full-to-full: between two full tanks, the km on the odometer over every litre put in after
 * the first (the second fill included). The figure is the last `upTo` intervals together.
 * Fills without an odometer (an untracked vehicle) can't be placed and are left out.
 */
export function measuredKmPerLitre(fills: readonly FuelFill[], upTo = 3): { kmPerLitre: number | null; intervals: KmPerLitreInterval[] } {
  const placed = fills.filter((f) => f.odometer != null).sort((a, b) => a.odometer! - b.odometer!);
  const intervals: KmPerLitreInterval[] = [];
  let from: FuelFill | null = null;
  let litres = 0;
  for (const f of placed) {
    if (from) litres += f.litres;
    if (!f.fullTank) continue;
    if (from && f.odometer! > from.odometer! && litres > 0) {
      const km = f.odometer! - from.odometer!;
      intervals.push({ to: f.date, km, litres, kmPerLitre: round2(km / litres) });
    }
    from = f;
    litres = 0;
  }
  const recent = intervals.slice(-upTo);
  const km = recent.reduce((s, i) => s + i.km, 0);
  const l = recent.reduce((s, i) => s + i.litres, 0);
  return { kmPerLitre: l > 0 ? round2(km / l) : null, intervals };
}

export interface LevelCheck {
  /** 0, 0.25, 0.5, 0.75 or 1, as the driver read the gauge. */
  level: number;
  odometer: number | null;
}

/**
 * The tank's estimated level (0..1): from the later of the last full fill or the driver's
 * gauge reading, plus litres put in since, less km driven since over km per litre.
 * Null without a tank size, km per litre, a current reading or a starting point.
 */
export function estimateFuelLevel(args: {
  tankLitres: number | null;
  kmPerLitre: number | null;
  currentOdometer: number | null;
  fills: readonly FuelFill[];
  checks: readonly LevelCheck[];
}): number | null {
  const { tankLitres, kmPerLitre, currentOdometer } = args;
  if (!tankLitres || !kmPerLitre || currentOdometer == null) return null;
  const lastFull = args.fills.filter((f) => f.fullTank && f.odometer != null).sort((a, b) => b.odometer! - a.odometer!)[0];
  const lastCheck = args.checks.filter((c) => c.odometer != null).sort((a, b) => b.odometer! - a.odometer!)[0];
  const anchor =
    lastCheck && (!lastFull || lastCheck.odometer! >= lastFull.odometer!)
      ? { odometer: lastCheck.odometer!, litres: lastCheck.level * tankLitres }
      : lastFull
        ? { odometer: lastFull.odometer!, litres: tankLitres }
        : null;
  if (!anchor) return null;
  const added = args.fills.filter((f) => f.odometer != null && f.odometer > anchor.odometer).reduce((s, f) => s + f.litres, 0);
  const used = Math.max(0, currentOdometer - anchor.odometer) / kmPerLitre;
  return Math.min(1, Math.max(0, (anchor.litres + added - used) / tankLitres));
}

/** The gauge's colour: plenty, getting low (under half), refuel soon (under a quarter). */
export function gaugeTone(level: number): "success" | "warning" | "destructive" {
  return level < 0.25 ? "destructive" : level < 0.5 ? "warning" : "success";
}

// ---- periods (Manila calendar days, `yyyy-MM-dd`) ----

export type PeriodKind = "day" | "week" | "month" | "quarter" | "year";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = MONTHS.map((m) => m.slice(0, 3));
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const toDate = (day: string) => new Date(`${day}T00:00:00Z`);
const toDay = (d: Date) => d.toISOString().slice(0, 10);
const shortDay = (d: Date) => `${SHORT[d.getUTCMonth()]} ${d.getUTCDate()}`;

/** The days a period covers (from/to inclusive) and its name, for the period holding `anchor`. */
export function periodRange(kind: PeriodKind, anchor: string): { from: string; to: string; label: string } {
  const d = toDate(anchor);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  switch (kind) {
    case "day":
      return { from: anchor, to: anchor, label: `${DAYS[d.getUTCDay()]}, ${shortDay(d)}, ${y}` };
    case "week": {
      const monday = new Date(d);
      monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      const sunday = new Date(monday);
      sunday.setUTCDate(monday.getUTCDate() + 6);
      return { from: toDay(monday), to: toDay(sunday), label: `${shortDay(monday)} – ${shortDay(sunday)}, ${sunday.getUTCFullYear()}` };
    }
    case "month":
      return { from: toDay(new Date(Date.UTC(y, m, 1))), to: toDay(new Date(Date.UTC(y, m + 1, 0))), label: `${MONTHS[m]} ${y}` };
    case "quarter": {
      const q = Math.floor(m / 3);
      return { from: toDay(new Date(Date.UTC(y, q * 3, 1))), to: toDay(new Date(Date.UTC(y, q * 3 + 3, 0))), label: `Q${q + 1} ${y} (${SHORT[q * 3]}–${SHORT[q * 3 + 2]})` };
    }
    case "year":
      return { from: `${y}-01-01`, to: `${y}-12-31`, label: String(y) };
  }
}

/** The anchor `n` periods later (or earlier, for negative n). */
export function shiftPeriod(kind: PeriodKind, anchor: string, n: number): string {
  const d = toDate(anchor);
  if (kind === "day") d.setUTCDate(d.getUTCDate() + n);
  else if (kind === "week") d.setUTCDate(d.getUTCDate() + 7 * n);
  else {
    const months = kind === "month" ? n : kind === "quarter" ? 3 * n : 12 * n;
    d.setUTCDate(1); // the 31st plus a month must not spill into the month after
    d.setUTCMonth(d.getUTCMonth() + months);
  }
  return toDay(d);
}

// ---- the period's figures ----

export interface TripForTotals {
  date: string;
  status: "scheduled" | "in_progress" | "completed";
  odometerStart: number | null;
  odometerEnd: number | null;
}

export interface ExpenseForTotals {
  date: string;
  kind: string;
  amount: number;
  litres: number | null;
  paidBy: "laf" | "driver";
}

export interface PeriodTotals {
  trips: number;
  km: number;
  litresBought: number;
  fuelCost: number;
  otherCost: number;
  totalCost: number;
  /** km over km per litre: fuel burned, as opposed to bought. */
  estLitresUsed: number | null;
  costPerKm: number | null;
  paidByDrivers: number;
  byKind: Record<string, number>;
}

/** Trips and (unvoided) expenses dated inside the period; the caller filters to it. */
export function periodTotals(trips: readonly TripForTotals[], expenses: readonly ExpenseForTotals[], kmPerLitre: number | null): PeriodTotals {
  const done = trips.filter((t) => t.status === "completed");
  const km = done.reduce((s, t) => s + (t.odometerStart != null && t.odometerEnd != null ? t.odometerEnd - t.odometerStart : 0), 0);
  const fuel = expenses.filter((e) => e.kind === "fuel");
  const fuelCost = round2(fuel.reduce((s, e) => s + e.amount, 0));
  const totalCost = round2(expenses.reduce((s, e) => s + e.amount, 0));
  const byKind: Record<string, number> = {};
  for (const e of expenses) byKind[e.kind] = round2((byKind[e.kind] ?? 0) + e.amount);
  return {
    trips: done.length,
    km,
    litresBought: round2(fuel.reduce((s, e) => s + (e.litres ?? 0), 0)),
    fuelCost,
    otherCost: round2(totalCost - fuelCost),
    totalCost,
    estLitresUsed: kmPerLitre ? round2(km / kmPerLitre) : null,
    costPerKm: km > 0 ? round2(totalCost / km) : null,
    paidByDrivers: round2(expenses.filter((e) => e.paidBy === "driver").reduce((s, e) => s + e.amount, 0)),
    byKind,
  };
}

// ---- the checks ----

export interface TripForChecks {
  id: string;
  date: string;
  departedAt: string | null;
  odometerStart: number | null;
  odometerEnd: number | null;
}

// ponytail: 2 km of slack for moving the vehicle in the yard; a setting if it proves too tight.
const GAP_SLACK_KM = 2;

/** Km on the odometer between one trip's arrival and the next one's departure: driving with no trip logged. */
export function untrackedGaps(trips: readonly TripForChecks[]): { afterTripId: string; date: string; km: number }[] {
  const read = trips
    .filter((t) => t.odometerStart != null && t.odometerEnd != null)
    .sort((a, b) => a.odometerStart! - b.odometerStart! || (a.departedAt ?? "").localeCompare(b.departedAt ?? ""));
  const gaps: { afterTripId: string; date: string; km: number }[] = [];
  for (let i = 1; i < read.length; i++) {
    const km = read[i].odometerStart! - read[i - 1].odometerEnd!;
    if (km > GAP_SLACK_KM) gaps.push({ afterTripId: read[i - 1].id, date: read[i].date, km });
  }
  return gaps;
}

/** The latest full-to-full km per litre fell more than `pct`% below the average of the (up to) three before it. */
export function efficiencyDropped(intervals: readonly KmPerLitreInterval[], pct: number): boolean {
  if (intervals.length < 3) return false;
  const last = intervals[intervals.length - 1];
  const before = intervals.slice(-4, -1);
  const km = before.reduce((s, i) => s + i.km, 0);
  const litres = before.reduce((s, i) => s + i.litres, 0);
  return litres > 0 && last.kmPerLitre < (km / litres) * (1 - pct / 100);
}

// ---- services ----

export interface ServiceRule {
  everyKm: number | null;
  everyMonths: number | null;
}

export interface ServiceDue {
  status: "ok" | "soon" | "overdue" | "unknown";
  kmLeft: number | null;
  daysLeft: number | null;
}

// ponytail: "soon" is fixed (the last 500 km or a tenth of the interval, or two weeks); Settings if LAF wants it earlier.
/** Is a service due? From the last time it was done (date and odometer), by km or by months, whichever comes first. */
export function serviceDue(rule: ServiceRule, last: { date: string; odometer: number | null } | null, now: { day: string; odometer: number | null }): ServiceDue {
  if (!last) return { status: "unknown", kmLeft: null, daysLeft: null };
  const kmLeft = rule.everyKm != null && last.odometer != null && now.odometer != null ? last.odometer + rule.everyKm - now.odometer : null;
  let daysLeft: number | null = null;
  if (rule.everyMonths != null) {
    // The same day of the month, or the month's last day (31 Jan + 1 month = 28/29 Feb).
    const due = toDate(shiftPeriod("month", last.date, rule.everyMonths));
    const daysInMonth = new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth() + 1, 0)).getUTCDate();
    due.setUTCDate(Math.min(Number(last.date.slice(8)), daysInMonth));
    daysLeft = Math.round((due.getTime() - toDate(now.day).getTime()) / 86_400_000);
  }
  if ((kmLeft != null && kmLeft < 0) || (daysLeft != null && daysLeft < 0)) return { status: "overdue", kmLeft, daysLeft };
  const soonKm = rule.everyKm != null ? Math.max(500, rule.everyKm / 10) : 0;
  if ((kmLeft != null && kmLeft <= soonKm) || (daysLeft != null && daysLeft <= 14)) return { status: "soon", kmLeft, daysLeft };
  return { status: "ok", kmLeft, daysLeft };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
