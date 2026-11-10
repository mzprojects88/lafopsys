/** The "no filter" value every filter starts at (Nov 2026). */
export const ALL = "all";

export interface FilterOption {
  value: string;
  label: string;
}

/** "lost_to_follow_up" -> "Lost to follow up": a readable label for a stored code. */
export const words = (code: string) => {
  const s = code.replace(/_/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/**
 * The distinct values the rows hold, as filter options sorted by label: a filter only offers what is there,
 * so a code nobody uses never shows and a new one appears without a code change. Empty values are left out.
 */
export function optionsOf<T>(rows: readonly T[], pick: (row: T) => string | null | undefined, label: (value: string) => string = words): FilterOption[] {
  const seen = new Set<string>();
  for (const r of rows) {
    const v = pick(r);
    if (v) seen.add(v);
  }
  return [...seen].map((value) => ({ value, label: label(value) })).sort((a, b) => a.label.localeCompare(b.label));
}

/** Whether a row's value passes a filter set to `chosen` (ALL passes everything). */
export const passes = (chosen: string, value: string | null | undefined) => chosen === ALL || chosen === (value ?? "");
