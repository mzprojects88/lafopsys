"use client";

import { cn } from "@/lib/utils";
import { useClockStatus } from "@/lib/hooks/use-clock-status";

export function ClockStatusBadge() {
  const { me, clockedIn, hasClockedInToday } = useClockStatus();

  if (!me) return null;

  const label = clockedIn ? "Clocked In" : hasClockedInToday ? "Clocked Out" : "Not Clocked In";
  const tone = clockedIn
    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
    : hasClockedInToday
      ? "bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-400"
      : "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400";
  const dot = clockedIn ? "bg-emerald-500" : hasClockedInToday ? "bg-slate-400" : "bg-amber-500";

  return (
    <span className={cn("hidden items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium sm:flex", tone)}>
      <span className={cn("size-1.5 rounded-full", dot)} />
      {label}
    </span>
  );
}
