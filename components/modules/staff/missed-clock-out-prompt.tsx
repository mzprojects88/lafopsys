"use client";

import * as React from "react";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useClockStatus } from "@/lib/hooks/use-clock-status";
import { useCollection } from "@/lib/data/collection-store";
import { timeEntriesStore } from "@/lib/hooks/use-time-entries-collection";
import { useCorrectionRequests } from "@/lib/hooks/use-correction-requests";
import { forgottenDays, instantOn, type EntryLike } from "@/lib/utils/dtr-prompts";
import { addDays } from "@/lib/utils/dtr";
import { todayIso } from "@/lib/utils/date";

const DISMISSED_KEY = "laf.missedClockOut.dismissed";

function readDismissed(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(DISMISSED_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

/**
 * "You didn't clock out" (DTR plan phase 1). Lists each day clocked into and
 * never out of; the person says when they left and why, which becomes a
 * request for admins and HR to approve (0061) and stops the day blocking
 * today's clock-in. Yesterday may be a night or 24-hour shift still running,
 * so it asks first. "Later" hides it until the next time the app is opened.
 */
export function MissedClockOutPrompt() {
  const { me } = useClockStatus();
  const { data: entries } = useCollection(timeEntriesStore);
  const { requests, reportMissedClockOut } = useCorrectionRequests();
  const [dismissed, setDismissed] = React.useState<string[]>(() => (typeof window === "undefined" ? [] : readDismissed()));

  const dismiss = (ids: string[]) => {
    const next = [...new Set([...dismissed, ...ids])];
    setDismissed(next);
    try {
      sessionStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch {
      // Private mode: it asks again on the next page.
    }
  };

  if (!me) return null;
  const days = forgottenDays(me.id, entries, requests, todayIso()).filter((d) => !dismissed.includes(d.entry.id));
  if (days.length === 0) return null;

  return (
    <Dialog open onOpenChange={(o) => !o && dismiss(days.map((d) => d.entry.id))}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{days.length === 1 ? "You didn't clock out" : `${days.length} days without a clock-out`}</DialogTitle>
          <DialogDescription>
            Say when you left. Admins and HR check it before it goes on your time record; until then the day shows a missed clock-out.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {days.map(({ entry, mayStillBeOnDuty }) => (
            <ForgottenDay
              key={entry.id}
              entry={entry}
              mayStillBeOnDuty={mayStillBeOnDuty}
              onStillOnDuty={() => dismiss([entry.id])}
              onReport={async (leftAt, reason) => {
                const r = await reportMissedClockOut(entry.id, leftAt, reason);
                if (!r.ok) toast.error(r.error);
                else toast.success("Sent to admins and HR.");
                return r.ok;
              }}
            />
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => dismiss(days.map((d) => d.entry.id))}>
            Later
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ForgottenDay({
  entry,
  mayStillBeOnDuty,
  onStillOnDuty,
  onReport,
}: {
  entry: EntryLike;
  mayStillBeOnDuty: boolean;
  onStillOnDuty: () => void;
  onReport: (leftAt: Date, reason: string) => Promise<boolean>;
}) {
  const [asking, setAsking] = React.useState(mayStillBeOnDuty);
  const [day, setDay] = React.useState(entry.date);
  const [time, setTime] = React.useState("");
  const [reason, setReason] = React.useState("Forgot to clock out.");
  const [saving, setSaving] = React.useState(false);
  const label = format(parseISO(entry.date), "EEE, MMM d");

  if (asking) {
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-border p-3 text-theme-sm">
        <span>
          <b>{label}</b>: you clocked in at {entry.clockIn} and are still clocked in. Are you still on duty?
        </span>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={onStillOnDuty}>
            Yes, still on duty
          </Button>
          <Button size="sm" onClick={() => setAsking(false)}>
            No, I forgot to clock out
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-2 rounded-xl border border-border p-3 text-theme-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!time) return;
        setSaving(true);
        await onReport(instantOn(day, time), reason.trim());
        setSaving(false);
      }}
    >
      <span>
        <b>{label}</b>: clocked in at {entry.clockIn}. When did you leave?
      </span>
      <div className="grid grid-cols-2 gap-2">
        <Input type="date" aria-label="Day you left" value={day} min={entry.date} max={addDays(entry.date, 1)} onChange={(e) => setDay(e.target.value)} required />
        <Input type="time" aria-label="Time you left" value={time} onChange={(e) => setTime(e.target.value)} required />
      </div>
      <Input aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} maxLength={500} required />
      <Button type="submit" size="sm" className="w-fit" disabled={saving || !time}>
        {saving ? "Sending…" : "Send to admin and HR"}
      </Button>
    </form>
  );
}
