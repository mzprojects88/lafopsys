import type { OrientationTopic, Stay, StayOrientationCheck } from "../types/patient";

/**
 * The arrival-day topics this stay needs and how many are ticked (0054).
 * A family's first stay takes the whole list; a returning family takes the
 * shorter one. Pure, so it runs under `node --test`.
 */
export function orientationProgress(
  stay: Stay,
  patientStays: readonly Stay[],
  topics: readonly OrientationTopic[],
  checks: readonly StayOrientationCheck[]
): { done: number; total: number; firstStay: boolean } {
  const firstStay = isFirstStay(stay, patientStays);
  const needed = firstStay ? topics : topics.filter((t) => t.returneeToo);
  const ticked = new Set(checks.filter((c) => c.stayId === stay.id).map((c) => c.topicId));
  return { done: needed.filter((t) => ticked.has(t.id)).length, total: needed.length, firstStay };
}

/** Their first time at LAF House: no earlier stay than this one. */
export function isFirstStay(stay: Stay, patientStays: readonly Stay[]): boolean {
  return !patientStays.some((s) => s.patientId === stay.patientId && s.id !== stay.id && s.checkInAt < stay.checkInAt);
}
