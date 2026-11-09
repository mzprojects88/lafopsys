import { addDays, weekKey } from "./dtr.ts";
import { periodLabel, periodWindow, type DayWindow } from "./period.ts";

/**
 * The quick periods every page with figures offers (Nov 2026): Today, Yesterday, This week, Last week,
 * This month, Last month, a custom range, and on pages with a long history, All time. Weeks start on
 * Monday (period.ts). Pure day-key arithmetic, so it runs the same on the server and in Manila, and
 * loads under `node --test` (imports only ./period and ./dtr).
 */
export type PresetKey = "today" | "yesterday" | "this_week" | "last_week" | "this_month" | "last_month" | "custom" | "all";

export const PRESETS: { key: PresetKey; label: string; code: string }[] = [
  { key: "today", label: "Today", code: "+0D" },
  { key: "yesterday", label: "Yesterday", code: "-1D" },
  { key: "this_week", label: "This week", code: "+0WK" },
  { key: "last_week", label: "Last week", code: "-1WK" },
  { key: "this_month", label: "This month", code: "+0M" },
  { key: "last_month", label: "Last month", code: "-1M" },
  { key: "custom", label: "Custom", code: "CSTM" },
  { key: "all", label: "All time", code: "ALL" },
];

export interface PresetState {
  key: PresetKey;
  /** Custom range only, inclusive yyyy-MM-dd. */
  from?: string;
  to?: string;
}

const isDay = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** The days a preset covers on `today`; null for All time. A custom range that isn't valid falls back to this month. */
export function presetWindow(state: PresetState, today: string): DayWindow | null {
  switch (state.key) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const d = addDays(today, -1);
      return { from: d, to: d };
    }
    case "this_week":
      return periodWindow("week", today);
    case "last_week":
      return periodWindow("week", addDays(today, -7));
    case "this_month":
      return periodWindow("month", today);
    case "last_month":
      return periodWindow("month", addDays(periodWindow("month", today).from, -1));
    case "custom":
      return isDay(state.from) && isDay(state.to) && state.from <= state.to ? { from: state.from, to: state.to } : periodWindow("month", today);
    case "all":
      return null;
  }
}

/** Reads `?period=…&from=…&to=…`; an unknown or missing period gives `fallback` (All time only where allowed). */
export function parsePreset(get: (name: string) => string | null, fallback: PresetKey, allowAll = false): PresetState {
  const key = get("period") as PresetKey | null;
  const known = PRESETS.some((p) => p.key === key) && (key !== "all" || allowAll);
  if (!known || !key) return { key: fallback };
  return key === "custom" ? { key, from: get("from") ?? undefined, to: get("to") ?? undefined } : { key };
}

/** The query a state is written to: `period`, plus `from`/`to` for a custom range. */
export function presetQuery(state: PresetState): Record<string, string> {
  const q: Record<string, string> = { period: state.key };
  if (state.key === "custom" && isDay(state.from) && isDay(state.to)) {
    q.from = state.from;
    q.to = state.to;
  }
  return q;
}

/** What a card's caption says: "This month · Nov 2026", "Yesterday · Nov 9, 2026", "Nov 3 – Nov 9, 2026", "All time". */
export function presetLabel(state: PresetState, window: DayWindow | null): string {
  if (!window) return "All time";
  const kind = state.key === "this_month" || state.key === "last_month" ? "month" : state.key === "today" || state.key === "yesterday" ? "today" : "custom";
  const range = periodLabel(kind, window);
  const name = PRESETS.find((p) => p.key === state.key)?.label;
  return state.key === "custom" ? range : `${name} · ${range}`;
}

/** Every day of a window, oldest first (capped, so a very long custom range cannot hang a chart). */
export function daysOf(window: DayWindow, max = 1100): string[] {
  const out: string[] = [];
  for (let d = window.from; d <= window.to && out.length < max; d = addDays(d, 1)) out.push(d);
  return out;
}

/** The chart point a day falls in: itself, its Monday, or its month. */
export function bucketOf(day: string, grain: "day" | "week" | "month"): string {
  return grain === "day" ? day : grain === "week" ? weekKey(day) : day.slice(0, 7);
}
