import { addDays, weekKey } from "./dtr.ts";
import { periodLabel, periodWindow, type DayWindow } from "./period.ts";

/**
 * The quick periods every page with figures offers (Nov 2026): Today, Yesterday, This week, Last week,
 * This month, Last month, a custom range, and on pages with a long history, All time. Weeks start on
 * Monday (period.ts). Pure day-key arithmetic, so it runs the same on the server and in Manila, and
 * loads under `node --test` (imports only ./period and ./dtr).
 */
export type PresetKey = "today" | "yesterday" | "this_week" | "last_week" | "this_month" | "last_month" | "this_year" | "last_year" | "custom" | "all";

export const PRESETS: { key: PresetKey; label: string; code: string }[] = [
  { key: "today", label: "Today", code: "+0D" },
  { key: "yesterday", label: "Yesterday", code: "-1D" },
  { key: "this_week", label: "This week", code: "+0Wk" },
  { key: "last_week", label: "Last week", code: "-1Wk" },
  { key: "this_month", label: "This month", code: "+0M" },
  { key: "last_month", label: "Last month", code: "-1M" },
  // Offered only where the page asks for years (Payment Requests, Nov 2026).
  { key: "this_year", label: "This year", code: "+0Y" },
  { key: "last_year", label: "Last year", code: "-1Y" },
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
    case "this_year":
      return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
    case "last_year": {
      const y = Number(today.slice(0, 4)) - 1;
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    }
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
  const range = state.key === "this_year" || state.key === "last_year" ? window.from.slice(0, 4) : periodLabel(kind, window);
  const name = PRESETS.find((p) => p.key === state.key)?.label;
  return state.key === "custom" ? range : `${name} · ${range}`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const dayParts = (key: string) => key.split("-").map(Number) as [number, number, number];
const weekday = (key: string) => {
  const [y, m, d] = dayParts(key);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
};
const monthDay = (key: string) => `${MONTHS[dayParts(key)[1] - 1]} ${dayParts(key)[2]}`;
const fullDate = (key: string) => `${monthDay(key)}, ${dayParts(key)[0]}`;

/** "5:55 AM" in Manila (12-hour clock, as every time in the apps). */
export function manilaTime(now: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit", hour12: true }).format(now);
}

/** "October 3 to 15, 2026", "October 3 to November 2, 2026", "December 20, 2026 to January 5, 2027". */
function span(from: string, to: string): string {
  const [fy, fm] = dayParts(from);
  const [ty, tm, td] = dayParts(to);
  if (fy !== ty) return `${fullDate(from)} to ${fullDate(to)}`;
  if (fm === tm) return `${monthDay(from)} to ${td}, ${ty}`;
  return `${monthDay(from)} to ${fullDate(to)}`;
}

/**
 * What the bar says under the chips: the chosen period in words, with the time the figures are as of when the
 * period runs up to today (Manila). `now` is null until the page is in the browser: the time is then left out.
 *   Today: figures as of today, November 10, 2026, 5:55 AM
 *   Last week: figures from Monday, November 2 to Sunday, November 8, 2026
 */
export function presetDescription(state: PresetState, today: string, now: Date | null): string {
  const asOf = now ? `, ${manilaTime(now)}` : "";
  const w = presetWindow(state, today);
  const name = PRESETS.find((p) => p.key === state.key)?.label ?? "";
  if (!w) return `${name}: every figure on record, as of ${fullDate(today)}${asOf}`;
  if (state.key === "today") return `${name}: figures as of today, ${fullDate(today)}${asOf}`;
  if (w.from === w.to) return `${name}: figures for ${weekday(w.from)}, ${fullDate(w.from)}`;
  // A period that runs past today stops at today: nothing later exists yet.
  if (w.to >= today && w.from <= today) {
    const start = state.key === "this_week" ? `${weekday(w.from)}, ${monthDay(w.from)}` : monthDay(w.from);
    return w.from === today ? `${name}: figures as of today, ${fullDate(today)}${asOf}` : `${name}: figures from ${start} to today, ${fullDate(today)}${asOf}`;
  }
  if (state.key === "last_week") return `${name}: figures from ${weekday(w.from)}, ${monthDay(w.from)} to ${weekday(w.to)}, ${fullDate(w.to)}`;
  return `${name}: figures from ${span(w.from, w.to)}`;
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
