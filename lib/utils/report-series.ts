// Analytics (2026-10-15): every chart is rows counted into day / week / month buckets over a date
// range, and every patient chart honours one set of filters. Pure; relative imports so tests/ can
// run it under node --test.
import { addDays, weekKey } from "./dtr.ts";

export type Grain = "day" | "week" | "month";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Day for up to a month, week for up to four months, else month. */
export function autoGrain(from: string, to: string): Grain {
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  return days <= 31 ? "day" : days <= 120 ? "week" : "month";
}

/** The bucket a day falls in: the day, its Monday, or the month's first day. */
export function bucketOf(day: string, grain: Grain): string {
  if (grain === "day") return day;
  if (grain === "week") return weekKey(day);
  return `${day.slice(0, 7)}-01`;
}

/** Every bucket from `from` to `to`, so empty days still show as zero. */
export function bucketsBetween(from: string, to: string, grain: Grain): string[] {
  const out: string[] = [];
  let key = bucketOf(from, grain);
  while (key <= to) {
    out.push(key);
    if (grain === "day") key = addDays(key, 1);
    else if (grain === "week") key = addDays(key, 7);
    else {
      const y = Number(key.slice(0, 4));
      const m = Number(key.slice(5, 7));
      key = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
    }
  }
  return out;
}

export function bucketLabel(key: string, grain: Grain): string {
  const m = MONTHS[Number(key.slice(5, 7)) - 1];
  if (grain === "month") return `${m} ${key.slice(0, 4)}`;
  const d = `${m} ${Number(key.slice(8, 10))}`;
  return grain === "week" ? `Wk ${d}` : d;
}

/** Rows summed per bucket for each series; a row outside the range is left out. */
export function series<T>(
  rows: readonly T[],
  dayOf: (row: T) => string | null | undefined,
  range: { from: string; to: string; grain: Grain },
  values: Record<string, (row: T) => number>
): ({ key: string; label: string } & Record<string, number | string>)[] {
  const keys = bucketsBetween(range.from, range.to, range.grain);
  const at = new Map(keys.map((k) => [k, Object.fromEntries(Object.keys(values).map((s) => [s, 0])) as Record<string, number>]));
  for (const row of rows) {
    const day = dayOf(row);
    if (!day || day < range.from || day > range.to) continue;
    const bucket = at.get(bucketOf(day, range.grain));
    if (!bucket) continue;
    for (const [name, value] of Object.entries(values)) bucket[name] = Math.round((bucket[name]! + value(row)) * 100) / 100;
  }
  return keys.map((key) => ({ key, label: bucketLabel(key, range.grain), ...at.get(key)! }));
}

/** How many of each value, largest first, with "Not recorded" for blanks; the rest past `top` as "Other". */
export function breakdown<T>(rows: readonly T[], valueOf: (row: T) => string | null | undefined, top = 8): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const v = valueOf(row) || "Not recorded";
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const head = sorted.slice(0, top).map(([name, count]) => ({ name, count }));
  const rest = sorted.slice(top).reduce((s, [, n]) => s + n, 0);
  return rest ? [...head, { name: "Other", count: rest }] : head;
}

export interface PatientFilter {
  priority?: string;
  illnessCode?: string;
  diagnosisCategory?: string;
  diagnosisId?: string;
  status?: string;
  sex?: string;
  ageGroup?: string;
  provinceId?: string;
  hospitalId?: string;
}

export interface FilterablePatient {
  priority?: string;
  illnessCode?: string;
  diagnosisIds: string[];
  status?: string;
  sex?: string;
  birthDate?: string;
  provinceId?: string;
  referringHospitalId?: string;
}

/** Age group as LAF reports it (0-1, 2-5, 6-9, 10-12, 13-15, 16-18+). */
export function ageGroupOn(birthDate: string | undefined, day: string): string | undefined {
  if (!birthDate) return undefined;
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [y, m, d] = day.split("-").map(Number);
  const age = y! - by! - (m! < bm! || (m === bm && d! < bd!) ? 1 : 0);
  return age <= 1 ? "0–1" : age <= 5 ? "2–5" : age <= 9 ? "6–9" : age <= 12 ? "10–12" : age <= 15 ? "13–15" : "16–18";
}

/** Does the patient pass every filter set? (An empty filter passes everyone.) */
export function matchesPatient(p: FilterablePatient, f: PatientFilter, ctx: { categoryOf: (diagnosisId: string) => string | undefined; today: string }): boolean {
  if (f.priority && p.priority !== f.priority) return false;
  if (f.illnessCode && p.illnessCode !== f.illnessCode) return false;
  if (f.diagnosisId && !p.diagnosisIds.includes(f.diagnosisId)) return false;
  if (f.diagnosisCategory && !p.diagnosisIds.some((id) => ctx.categoryOf(id) === f.diagnosisCategory)) return false;
  if (f.status && p.status !== f.status) return false;
  if (f.sex && p.sex !== f.sex) return false;
  if (f.ageGroup && ageGroupOn(p.birthDate, ctx.today) !== f.ageGroup) return false;
  if (f.provinceId && p.provinceId !== f.provinceId) return false;
  if (f.hospitalId && p.referringHospitalId !== f.hospitalId) return false;
  return true;
}
