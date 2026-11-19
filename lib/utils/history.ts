// Patients > History (0167): the pure parts of the page, so tests/ can run them.
import { addDays } from "./dtr.ts";

export type Meal = "breakfast" | "lunch" | "dinner";
export type Direction = "to_hospital" | "from_hospital";
export const MEALS: readonly Meal[] = ["breakfast", "lunch", "dinner"];
/** The sheet's words: LAF House to NCH is "TO NCH", NCH to LAF House is "TO LAF". */
export const DIRECTION_LABEL: Record<Direction, string> = { to_hospital: "LAF → NCH", from_hospital: "NCH → LAF" };

/** One day of ops.history_month. */
export interface HistoryMonthDay {
  day: string;
  app_children: number;
  sheet_children: number;
  app_meals: number;
  sheet_meals: number;
  app_rides: number;
  sheet_rides: number;
  completed: boolean;
}

export type DayState = "complete" | "entered" | "partial" | "sheet_only" | "empty" | "future";

export const STATE_LABEL: Record<DayState, string> = {
  complete: "Complete",
  entered: "Entered, not marked complete",
  partial: "Fewer than the sheet",
  sheet_only: "On the sheet only",
  empty: "Nothing recorded",
  future: "Today or later",
};

/** How far a day is: complete; all the sheet's children entered; some; none (sheet only); nothing anywhere. */
export function dayState(d: HistoryMonthDay, today: string): DayState {
  if (d.day >= today) return "future";
  if (d.completed) return "complete";
  if (d.app_children === 0) return d.sheet_children > 0 ? "sheet_only" : d.app_meals + d.app_rides > 0 ? "partial" : "empty";
  return d.app_children < d.sheet_children ? "partial" : "entered";
}

/** The months shown: the chosen one, and the one before it when two are asked for (oldest first). */
export function monthsShown(month: string, count: 1 | 2): { months: string[]; from: string; to: string } {
  const prev = addDays(`${month}-01`, -1).slice(0, 7);
  const months = count === 2 ? [prev, month] : [month];
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
  return { months, from: `${months[0]}-01`, to: last };
}

/** A note is asked for days further back than the Settings figure (history_note_days). */
export const needsNote = (day: string, today: string, noteDays: number): boolean => day < addDays(today, -noteDays);

/** A child of one day, as ops.history_day gives it. Patients viewers get everything; Transport-only, name and rides. */
export interface DayRow {
  patientId: string;
  name: string;
  caseNumber?: string | null;
  caf?: boolean | null;
  stayed: boolean;
  nightBefore: boolean;
  night: { stayId: string; unitId: string; unitCode: string; carerId: string | null; carerName: string | null; people: number; open: boolean; fromHistory: boolean } | null;
  meals: Meal[] | null;
  rides: Partial<Record<Direction, { tripId: string; people: number }>>;
  carers: { id: string; name: string; relationship: string | null }[] | null;
}

/** A name of the day on the House Sheet or the Programs sheet. */
export interface SheetPerson {
  nameKey: string;
  name: string;
  carer: string | null;
  slept: boolean;
  patientId: string | null;
  matchStatus: string;
  meals: Meal[];
  suggestedUnitId: string | null;
  suggestedCarerId: string | null;
}

export interface DayBed {
  unitId: string;
  code: string;
  room: string | null;
  capacity: number;
  temporary: boolean;
  taken: number;
}

export interface HistoryDayData {
  day: string;
  today: string;
  backDays: number;
  noteDays: number;
  full: boolean;
  isAdmin: boolean;
  canNights: boolean;
  canRides: boolean;
  inWindow: boolean;
  cafLocked: boolean;
  completed: { at: string; by: string | null; note: string | null } | null;
  rows: DayRow[];
  sheet: SheetPerson[];
  beds: DayBed[];
  trips: { id: string; direction: Direction; time: string; vehicle: string; status: string; fromHistory: boolean; mine: boolean; driver: string | null; riders: number }[];
  edits: { at: string; by: string | null; action: string; patient: string | null; detail: Record<string, unknown>; note: string | null }[];
}

/** One night to save: who, which bed, which carer, how many with the child, and the meals to tick after. */
export interface PlannedNight {
  patientId: string;
  name: string;
  unitId: string | null;
  carerId: string | null;
  people: number | null;
  meals: Meal[];
  /** The child already has the night: only the meals are added. */
  mealsOnly: boolean;
}

/**
 * "Fill from the sheet": the sheet's matched children who have no night in the app that day, with the bed
 * they had the night before or after (when free) and the carer the sheet names. Names not matched to a
 * patient are listed apart: they are matched on the House Sheet page first.
 */
export function fillPlan(data: Pick<HistoryDayData, "sheet" | "rows">): { nights: PlannedNight[]; unmatched: SheetPerson[] } {
  const stayed = new Set(data.rows.filter((r) => r.stayed).map((r) => r.patientId));
  const seen = new Set<string>();
  const nights: PlannedNight[] = [];
  for (const p of data.sheet) {
    if (!p.patientId || !p.slept || stayed.has(p.patientId) || seen.has(p.patientId)) continue;
    seen.add(p.patientId);
    nights.push({ patientId: p.patientId, name: p.name, unitId: p.suggestedUnitId, carerId: p.suggestedCarerId, people: null, meals: p.meals, mealsOnly: false });
  }
  // Meals for children already in the app that day (or eating before leaving): only the meals still missing.
  for (const p of data.sheet) {
    if (!p.patientId || seen.has(p.patientId) || p.meals.length === 0) continue;
    const row = data.rows.find((r) => r.patientId === p.patientId);
    if (!row || !(row.stayed || row.nightBefore)) continue;
    const missing = p.meals.filter((m) => !(row.meals ?? []).includes(m));
    if (missing.length === 0) continue;
    seen.add(p.patientId);
    nights.push({ patientId: p.patientId, name: p.name, unitId: row.night?.unitId ?? null, carerId: row.night?.carerId ?? null, people: null, meals: missing, mealsOnly: true });
  }
  return { nights, unmatched: data.sheet.filter((p) => !p.patientId && p.matchStatus !== "dismissed") };
}

/** "Copy the day before": the children of the night before who have no night here, in the same bed, carer and people. */
export function copyPlan(before: Pick<HistoryDayData, "rows">, data: Pick<HistoryDayData, "rows">): PlannedNight[] {
  const here = new Set(data.rows.filter((r) => r.stayed).map((r) => r.patientId));
  return before.rows
    .filter((r) => r.night && !here.has(r.patientId))
    .map((r) => ({ patientId: r.patientId, name: r.name, unitId: r.night!.unitId, carerId: r.night!.carerId, people: r.night!.people, meals: [], mealsOnly: false }));
}

/** The month as a CSV: one line per day, the app's and the sheets' figures side by side. */
export function monthCsv(days: readonly HistoryMonthDay[], today: string): { header: string[]; rows: string[][] } {
  return {
    header: ["Day", "Children (app)", "Children (House Sheet)", "Meals (app)", "Meals (Programs sheet)", "Riders (app)", "Riders (sheet)", "Status"],
    rows: days.map((d) => [d.day, String(d.app_children), String(d.sheet_children), String(d.app_meals), String(d.sheet_meals), String(d.app_rides), String(d.sheet_rides), STATE_LABEL[dayState(d, today)]]),
  };
}
