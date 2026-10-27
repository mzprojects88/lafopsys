/** Scheduled report delivery (0118): pure date rules, tested in tests/notify-schedule.test.mjs. */

export interface ScheduleLike {
  frequency: "monthly" | "weekly";
  /** monthly: day of the month 1-28; weekly: 1 = Monday ... 7 = Sunday */
  day: number;
  active: boolean;
  recipients: readonly string[];
  last_sent_on: string | null;
}

/** ISO weekday of a yyyy-mm-dd date: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(day: string): number {
  const d = new Date(`${day}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Due today: on, has someone to send to, the right day, and not already sent today. */
export function isDue(s: ScheduleLike, today: string): boolean {
  if (!s.active || s.recipients.length === 0 || s.last_sent_on === today) return false;
  return s.frequency === "monthly" ? Number(today.slice(8, 10)) === s.day : isoWeekday(today) === s.day;
}

/** The month a report covers when sent on `today`: the previous calendar month, yyyy-MM. */
export function reportMonth(today: string): string {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** Text made safe for an HTML email. */
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
