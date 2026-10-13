/** "18:00" (as the database and time inputs hold it) shown as "6:00 PM" (user's rule 2026-10-13: never military time). */
export function formatTime12(hhmm: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? "");
  if (!m) return "—";
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}
