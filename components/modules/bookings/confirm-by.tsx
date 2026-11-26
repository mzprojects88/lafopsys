"use client";

import { formatDate, todayIso } from "@/lib/utils/date";
import { STATUS_TONE_CLASSES } from "@/lib/utils/status-colors";

/** A pending request's confirm-by date (0184): red on the day and after (it closes the next morning). */
export function ConfirmBy({ day }: { day: string }) {
  const today = todayIso();
  const late = today > day;
  const due = today === day;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-theme-xs font-medium ${STATUS_TONE_CLASSES[late || due ? "negative" : "neutral"]}`}>
      {late ? `Late: was due ${formatDate(day)}` : due ? "Confirm today" : `Confirm by ${formatDate(day)}`}
    </span>
  );
}
