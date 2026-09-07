"use client";

import * as React from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { timeEntriesStore } from "@/lib/hooks/use-time-entries-collection";
import { timePunchesStore } from "@/lib/hooks/use-time-punches-collection";
import { addDays } from "@/lib/utils/dtr";

export interface OpenDay {
  timeEntryId: string;
  staffName: string;
  /** `yyyy-MM-dd`, the day the shift was clocked in. */
  date: string;
  /** `HH:mm` label of the clock-in. */
  clockIn: string;
}

/**
 * Lets an admin supply a clock-out nobody made.
 *
 * The correction is an extra punch, marked as an adjustment and signed by the
 * admin (see app/api/dtr/adjust/route.ts and migration 0029) -- the original
 * record is never edited, so the timesheet keeps showing that the punch was
 * missed and who put a time to it.
 *
 * The day defaults to the shift's own day but can be moved to the next one,
 * because a night shift's clock-out belongs to the following morning.
 */
export function CloseTimeEntryDialog({
  day,
  onOpenChange,
  onDone,
}: {
  day: OpenDay | null;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}) {
  // Mounted only while a day is selected, and keyed on it, so picking a
  // different day remounts the form with fresh state. The repo's pattern
  // everywhere a dialog is seeded from a record -- a sync effect would
  // re-render twice and fight anything already typed.
  if (!day) return null;
  return <CloseTimeEntryForm key={day.timeEntryId} day={day} onOpenChange={onOpenChange} onDone={onDone} />;
}

function CloseTimeEntryForm({
  day,
  onOpenChange,
  onDone,
}: {
  day: OpenDay;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}) {
  const [date, setDate] = React.useState(day.date);
  const [time, setTime] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  async function handleSave() {
    if (!time) {
      toast.error("Enter the time they actually clocked out.");
      return;
    }
    if (!reason.trim()) {
      toast.error("Say why the clock-out is missing.");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/dtr/adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeEntryId: day.timeEntryId, date, time, reason: reason.trim() }),
      });
      const result = (await response.json()) as { ok: boolean; error?: string; clockOut?: string };
      if (!result.ok) {
        toast.error(result.error ?? "The correction could not be saved.");
        return;
      }
      // Both collections changed: the punch was added and the day's summary
      // rewritten. Realtime will catch up too, but this makes it immediate.
      await Promise.all([timePunchesStore.refetch(), timeEntriesStore.refetch()]);
      toast.success(`${day.staffName} clocked out at ${result.clockOut}`);
      onDone?.();
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add the missing clock-out</DialogTitle>
          <DialogDescription>
            {day.staffName} clocked in at {day.clockIn} on {day.date} and never clocked out.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="adjust-date">Day</Label>
              <select
                id="adjust-date"
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              >
                <option value={day.date}>{day.date} (same day)</option>
                <option value={addDays(day.date, 1)}>{addDays(day.date, 1)} (next morning)</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="adjust-time">Clock-out time</Label>
              <Input id="adjust-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="adjust-reason">Why it is missing</Label>
            <Textarea
              id="adjust-reason"
              rows={2}
              placeholder="e.g. phone battery died at the end of the shift; time confirmed with the house lead"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Recorded as a correction against your name. The original record is kept exactly as it was.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={saving || !time || !reason.trim()} onClick={handleSave}>
            {saving ? "Saving…" : "Record clock-out"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
