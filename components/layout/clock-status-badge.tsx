"use client";

import * as React from "react";
import { LogIn, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { useClockStatus } from "@/lib/hooks/use-clock-status";
import { useNow } from "@/lib/hooks/use-now";
import { formatMinutes } from "@/lib/utils/dtr";
import { instantOn } from "@/lib/utils/dtr-prompts";
import { PunchCameraDialog } from "@/components/modules/staff/punch-camera-dialog";

/**
 * Clock in / out from the top bar on every page, phones included (DTR plan
 * phase 1): 16 of 17 punches were clock-ins because Clock Out lived only on
 * /staff and this badge was hidden on phones. Opens the camera dialog (0060).
 */
export function ClockStatusBadge() {
  const { me, clockedIn, hasClockedInToday, clockInRequired, openEntry } = useClockStatus();
  const now = useNow();
  const [camera, setCamera] = React.useState<"clock_in" | "clock_out" | null>(null);

  if (!me) return null;
  // Someone who does not have to clock in gets no nagging button, unless they punched today.
  if (!clockInRequired && !hasClockedInToday) return null;

  const since = clockedIn && openEntry?.clockIn ? instantOn(openEntry.date, openEntry.clockIn) : null;
  const elapsed = since ? Math.max(0, Math.floor((now.getTime() - since.getTime()) / 60_000)) : 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setCamera(clockedIn ? "clock_out" : "clock_in")}
        className={cn(
          "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1.5 text-xs font-medium transition-colors sm:px-3",
          clockedIn
            ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-400"
            : "bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-500/15 dark:text-amber-400"
        )}
        title={clockedIn ? `Clocked in at ${openEntry?.clockIn}. Tap to clock out.` : "Tap to clock in."}
      >
        {clockedIn ? <LogOut className="size-3.5" /> : <LogIn className="size-3.5" />}
        {clockedIn ? (
          <>
            <span>Clock out</span>
            <span className="hidden tabular-nums opacity-75 sm:inline">· {formatMinutes(elapsed)}</span>
          </>
        ) : (
          <span>Clock in</span>
        )}
      </button>
      {camera ? <PunchCameraDialog punchType={camera} open onOpenChange={(o) => !o && setCamera(null)} /> : null}
    </>
  );
}
