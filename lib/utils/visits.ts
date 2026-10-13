import type { Stay } from "@/lib/types/patient";

/**
 * A stay is one night (0089): the nights of one visit share a visit id. These group them
 * back into visits for the pages that count arrivals, departures and lengths of stay.
 */
export interface Visit {
  id: string;
  patientId: string;
  /** Nights, first first. */
  stays: Stay[];
  firstNight: string;
  /** The last night's check-in date (the visit's last night in the house). */
  lastNight: string;
  /** True while the latest night is still open. */
  active: boolean;
}

const active = (s: Stay) => s.status === "in_house" || s.status === "overdue";

/** Groups stays into visits. Stays from before 0089 (no visit id) are a visit each. */
export function visitsOf(stays: readonly Stay[]): Visit[] {
  const groups = new Map<string, Stay[]>();
  for (const s of stays) {
    const key = s.visitId ?? s.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }
  return [...groups].map(([id, nights]) => {
    const sorted = [...nights].sort((a, b) => a.checkInAt.localeCompare(b.checkInAt));
    const last = sorted[sorted.length - 1]!;
    return { id, patientId: last.patientId, stays: sorted, firstNight: sorted[0]!.checkInAt, lastNight: last.checkInAt, active: sorted.some(active) };
  });
}

/** Nights in the house, counting tonight once the latest night is open. */
export function visitNights(v: Visit): number {
  return v.stays.length;
}

/** The visit a stay belongs to. */
export function visitOfStay(stay: Stay, stays: readonly Stay[]): Visit {
  return visitsOf(stays.filter((s) => (s.visitId ?? s.id) === (stay.visitId ?? stay.id)))[0]!;
}

/** Visits that started today (first night = today). */
export const arrivalsOn = (visits: readonly Visit[], day: string) => visits.filter((v) => v.firstNight === day);

/** Visits that ended: the last night was the day before and nothing is open now. */
export const departuresOn = (visits: readonly Visit[], day: string) => visits.filter((v) => !v.active && v.stays[v.stays.length - 1]!.checkOutAt === day && v.stays[v.stays.length - 1]!.checkOutReason !== "daily_reset");
