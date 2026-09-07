"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Field, FieldLabel } from "@/components/ui/field";
import { CALENDAR_VENUES, type CalendarEvent } from "@/lib/types/calendar";
import { useCalendarEventsData, type CalendarEventInput } from "@/lib/hooks/use-calendar-events-collection";

/** The people who appear as Officer on Duty in the sheet, offered as
 * suggestions. Free text is still allowed -- a new officer is not a config change. */
const OFFICER_SUGGESTIONS = ["Butch", "Des", "Cath", "Queen"];
const TIME_SUGGESTIONS = ["All day", "9:00 AM", "10:00 AM", "10:30 AM - 12:00 NN", "12:00 NN", "1:00 PM", "2:00 PM", "3:00 PM", "TBD"];

export type EventDialogState =
  | { mode: "closed" }
  | { mode: "create"; date: string }
  | { mode: "edit"; event: CalendarEvent };

/**
 * Add or edit one calendar event. Plain useState, seeded from the state it is
 * opened with and remounted (keyed by the caller) when that changes -- the
 * repo's dialog pattern, see components/modules/settings/create-staff-dialog.tsx.
 *
 * Fields mirror the sheet's columns one for one, so someone who has kept the
 * Google Sheet for years finds nothing missing and nothing renamed.
 */
export function EventDialog({ state, onOpenChange }: { state: EventDialogState; onOpenChange: (open: boolean) => void }) {
  if (state.mode === "closed") return null;
  const key = state.mode === "edit" ? state.event.id : `new-${state.date}`;
  return <EventForm key={key} state={state} onOpenChange={onOpenChange} />;
}

function EventForm({
  state,
  onOpenChange,
}: {
  state: Exclude<EventDialogState, { mode: "closed" }>;
  onOpenChange: (open: boolean) => void;
}) {
  const { addEvent, updateEvent, deleteEvent } = useCalendarEventsData();
  const existing = state.mode === "edit" ? state.event : null;

  const [date, setDate] = React.useState(state.mode === "edit" ? state.event.date : state.date);
  const [time, setTime] = React.useState(existing?.time ?? "");
  const [title, setTitle] = React.useState(existing?.title ?? "");
  const [venue, setVenue] = React.useState(existing?.venue ?? "");
  const [officer, setOfficer] = React.useState(existing?.officerOnDuty ?? "");
  const [staffNeeded, setStaffNeeded] = React.useState(existing?.staffNeeded ?? "");
  const [bookedBy, setBookedBy] = React.useState(existing?.bookedBy ?? "");
  const [contactInfo, setContactInfo] = React.useState(existing?.contactInfo ?? "");
  const [remarks, setRemarks] = React.useState(existing?.remarks ?? "");
  const [isHoliday, setIsHoliday] = React.useState(existing?.isHoliday ?? false);
  const [saving, setSaving] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const canSave = !!date && !!title.trim() && !saving;

  function payload(): CalendarEventInput {
    return { date, time, title, venue, officerOnDuty: officer, staffNeeded, bookedBy, contactInfo, remarks, isHoliday };
  }

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    const result = existing ? await updateEvent(existing.id, payload()) : await addEvent(payload());
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error.includes("calendar_events_natural_key") ? "That event is already on the calendar for that date and time." : result.error);
      return;
    }
    toast.success(existing ? "Event updated" : "Event added to the calendar");
    onOpenChange(false);
  }

  async function handleDelete() {
    if (!existing) return;
    setSaving(true);
    const result = await deleteEvent(existing.id);
    setSaving(false);
    setConfirmDelete(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Event removed");
    onOpenChange(false);
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit event" : "Add event"}</DialogTitle>
          <DialogDescription>
            {existing ? "Changes are saved to the foundation calendar for everyone." : "Goes on the foundation calendar for everyone to see."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="ev-title">Event</FieldLabel>
            <Input id="ev-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Gerry's Grill Care Cart" autoFocus />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="ev-date">Date</FieldLabel>
              <Input id="ev-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="ev-time">Time</FieldLabel>
              <Input id="ev-time" list="ev-time-suggestions" value={time} onChange={(e) => setTime(e.target.value)} placeholder="12:00 NN, All day, TBD" />
              <datalist id="ev-time-suggestions">
                {TIME_SUGGESTIONS.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="ev-venue">Venue</FieldLabel>
              <Input id="ev-venue" list="ev-venue-suggestions" value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="LAF, NCH, OTHER…" />
              <datalist id="ev-venue-suggestions">
                {CALENDAR_VENUES.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </Field>
            <Field>
              <FieldLabel htmlFor="ev-officer">Officer on duty</FieldLabel>
              <Input id="ev-officer" list="ev-officer-suggestions" value={officer} onChange={(e) => setOfficer(e.target.value)} />
              <datalist id="ev-officer-suggestions">
                {OFFICER_SUGGESTIONS.map((o) => (
                  <option key={o} value={o} />
                ))}
              </datalist>
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="ev-staff">Staff needed</FieldLabel>
            <Input id="ev-staff" value={staffNeeded} onChange={(e) => setStaffNeeded(e.target.value)} placeholder="e.g. Butch, Jeff, Marge" />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="ev-booked">Booked by</FieldLabel>
              <Input id="ev-booked" value={bookedBy} onChange={(e) => setBookedBy(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="ev-contact">Contact name and number</FieldLabel>
              <Input id="ev-contact" value={contactInfo} onChange={(e) => setContactInfo(e.target.value)} />
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="ev-remarks">Remarks</FieldLabel>
            <Textarea id="ev-remarks" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>

          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">Holiday</span>
              <span className="text-xs text-muted-foreground">Shown tinted on the month view; no officer expected.</span>
            </div>
            <Switch checked={isHoliday} onCheckedChange={setIsHoliday} />
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          {existing ? (
            <Button variant="ghost" className="text-destructive" onClick={() => setConfirmDelete(true)} disabled={saving}>
              Remove
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!canSave}>
              {saving ? "Saving…" : existing ? "Save" : "Add event"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this event?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{existing?.title}&rdquo; on {existing?.date} comes off the calendar for everyone. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={saving} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
