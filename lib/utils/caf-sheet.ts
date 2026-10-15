// NCH billing (0098): nights from the House Sheet's daily tabs, for days before the app was used.
// A child on a day's tab stayed that night. Pure; relative imports for node --test.

export interface SheetDay {
  date: string;
  names: string[];
}

/**
 * Each matched child's days on the tabs, and the names no child on file matched.
 * `resolve` turns a sheet name into a patient id (or null).
 */
export function sheetNights(days: readonly SheetDay[], resolve: (name: string) => string | null): { nights: Map<string, string[]>; unmatched: string[] } {
  const nights = new Map<string, Set<string>>();
  const unmatched = new Set<string>();
  for (const day of days) {
    for (const name of day.names) {
      const id = resolve(name);
      if (!id) {
        unmatched.add(name);
        continue;
      }
      (nights.get(id) ?? nights.set(id, new Set()).get(id)!).add(day.date);
    }
  }
  return { nights: new Map([...nights].map(([id, set]) => [id, [...set].sort()])), unmatched: [...unmatched].sort() };
}

/** The bill's nights plus the sheet's, once each, in order; and which were new. */
export function mergeNights(existing: readonly string[], fromSheet: readonly string[]): { all: string[]; added: string[] } {
  const have = new Set(existing);
  const added = [...new Set(fromSheet)].filter((d) => !have.has(d)).sort();
  return { all: [...new Set([...existing, ...added])].sort(), added };
}
