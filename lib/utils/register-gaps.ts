/**
 * Numbers come from one series per prefix and year (0085: LAF-CSH-2026-0001, DC-2026-0001),
 * so a gap means a row was deleted: the highest number minus the rows present, per series.
 * Older clock-made numbers (AR-2026-123456) are not a series and are ignored.
 */
export function registerGaps(numbers: readonly string[]): { series: string; missing: number }[] {
  const bySeries = new Map<string, Set<number>>();
  for (const n of numbers) {
    const m = /^((?:LAF-CSH|DC)-\d{4})-(\d{4})$/.exec(n);
    if (!m) continue;
    if (!bySeries.has(m[1]!)) bySeries.set(m[1]!, new Set());
    bySeries.get(m[1]!)!.add(Number(m[2]));
  }
  return [...bySeries]
    .map(([series, set]) => ({ series, missing: Math.max(...set) - set.size }))
    .filter((g) => g.missing > 0);
}
