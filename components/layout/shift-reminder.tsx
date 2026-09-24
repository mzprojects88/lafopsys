"use client";

import * as React from "react";
import { AlarmClock, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useClockStatus } from "@/lib/hooks/use-clock-status";
import { useRoster } from "@/lib/hooks/use-roster";
import { useNow } from "@/lib/hooks/use-now";
import { clockOutDueAt } from "@/lib/utils/dtr-prompts";
import { PunchCameraDialog } from "@/components/modules/staff/punch-camera-dialog";

/** "Still working" hides the bar for this long; then it asks again. */
const SNOOZE_MS = 60 * 60_000;
const snoozeKey = (entryId: string) => `laf.shiftReminder.snoozedUntil.${entryId}`;

function snoozedUntil(entryId: string): number {
  try {
    return Number(sessionStorage.getItem(snoozeKey(entryId)) ?? 0);
  } catch {
    return 0;
  }
}

/**
 * A bar across every page once the shift is over and the person is still
 * clocked in (DTR plan phase 1): at the scheduled end, or 9 hours after
 * clocking in when there is no schedule. Clock out from it, or say you are
 * still working and it asks again in an hour.
 */
export function ShiftReminder() {
  const { me, clockedIn, openEntry } = useClockStatus();
  const { people, entryFor } = useRoster();
  const now = useNow();
  const [camera, setCamera] = React.useState(false);
  const [, rerender] = React.useReducer((n: number) => n + 1, 0);

  if (!me || !clockedIn || !openEntry?.clockIn) return null;
  const person = people.find((p) => p.staffId === me.id);
  const shift = person ? entryFor(person, openEntry.date).shift : null;
  const due = clockOutDueAt(openEntry.date, openEntry.clockIn, shift);
  if (now < due || now.getTime() < snoozedUntil(openEntry.id)) return null;

  const dueLabel = due.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" });
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-500/10 dark:text-amber-200">
      <AlarmClock className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        {shift ? `Your shift ended at ${dueLabel}.` : `You have been clocked in since ${openEntry.clockIn}.`} Still working? Remember to clock out.
      </span>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="ghost"
          className="h-8"
          onClick={() => {
            try {
              sessionStorage.setItem(snoozeKey(openEntry.id), String(Date.now() + SNOOZE_MS));
            } catch {
              // Private mode: the bar simply stays.
            }
            rerender();
          }}
        >
          Still working
        </Button>
        <Button size="sm" className="h-8 gap-1.5" onClick={() => setCamera(true)}>
          <LogOut className="size-3.5" />
          Clock out
        </Button>
      </div>
      {camera ? <PunchCameraDialog punchType="clock_out" open onOpenChange={(o) => !o && setCamera(false)} /> : null}
    </div>
  );
}
