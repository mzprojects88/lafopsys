"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { RosterCalendar, type CalendarEvent } from "@/components/patterns/roster-calendar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRoster, type RosterPerson } from "@/lib/hooks/use-roster";
import { scheduleOverridesStore } from "@/lib/hooks/use-pay-periods-collection";
import { useRole } from "@/lib/rbac/use-role";
import { canManageHr } from "@/lib/rbac/roles";
import { formatDate } from "@/lib/utils/date";
import { useNow } from "@/lib/hooks/use-now";
import { dayKey } from "@/lib/utils/dtr";
import { deleteScheduleOverride, saveScheduleOverride } from "@/app/(app)/hr/actions";

/**
 * The week's roster, drawn from each person's weekly schedule (HR →
 * Employees → Schedule) and the per-day overrides HR sets here: a swapped
 * rest day, a 24-hour house duty, a night shift. Everyone can read it;
 * HR and admins click a day to change it.
 */
export default function RosterPage() {
  const { role, isHr } = useRole();
  const manages = canManageHr(role, isHr);
  const { people, entryFor, onDay, overrides, loading } = useRoster();
  const today = dayKey(useNow());
  const [dialog, setDialog] = React.useState<{ day: string; person: RosterPerson | null } | null>(null);

  const eventsFor = React.useCallback(
    (day: string): CalendarEvent[] =>
      onDay(day).map((e) => ({
        id: `${e.person.employeeId}:${day}`,
        date: day,
        label: `${e.person.firstName} ${e.person.lastName}`,
        sublabel: `${e.shift!.start}–${e.shift!.end}${e.overridden ? " · changed" : ""}`,
        tone: e.overridden ? "warning" : e.shift!.end < e.shift!.start ? "info" : "neutral",
      })),
    [onDay]
  );

  const unscheduled = people.filter((p) => !entryFor(p, today).hasSchedule);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Roster"
        description={manages ? "Who is on duty when. Click a day to swap a rest day or set a one-off shift; the weekly pattern lives on each employee's page." : "Who is on duty when, from each person's weekly schedule."}
      />
      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      <RosterCalendar
        eventsFor={eventsFor}
        onDayClick={manages ? (day) => setDialog({ day, person: null }) : undefined}
        onEventClick={(e) => {
          const [employeeId, day] = e.id.split(":");
          const person = people.find((p) => p.employeeId === employeeId) ?? null;
          if (manages) setDialog({ day, person });
          else toast.info(`${e.label} — ${e.sublabel}`);
        }}
        legend={[
          { label: "Weekly pattern", tone: "neutral" },
          { label: "Changed for the day", tone: "warning" },
          { label: "Overnight", tone: "info" },
        ]}
      />
      {manages && unscheduled.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          No schedule yet: {unscheduled.map((p) => `${p.firstName} ${p.lastName}`).join(", ")} — set one on{" "}
          <Link href="/hr/employees" className="underline">
            their employee page
          </Link>
          .
        </p>
      ) : null}
      {dialog ? (
        <OverrideDialog
          key={`${dialog.day}:${dialog.person?.employeeId ?? ""}`}
          day={dialog.day}
          people={people}
          initialPerson={dialog.person}
          entryFor={entryFor}
          existingId={dialog.person ? (overrides.find((o) => o.employeeId === dialog.person!.employeeId && o.date === dialog.day)?.id ?? null) : null}
          close={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}

function OverrideDialog({
  day,
  people,
  initialPerson,
  entryFor,
  existingId,
  close,
}: {
  day: string;
  people: RosterPerson[];
  initialPerson: RosterPerson | null;
  entryFor: ReturnType<typeof useRoster>["entryFor"];
  existingId: string | null;
  close: () => void;
}) {
  const [employeeId, setEmployeeId] = React.useState(initialPerson?.employeeId ?? people[0]?.employeeId ?? "");
  const person = people.find((p) => p.employeeId === employeeId) ?? null;
  const current = person ? entryFor(person, day) : null;
  const [restDay, setRestDay] = React.useState(current?.restDay ?? false);
  const [start, setStart] = React.useState(current?.shift?.start ?? "08:00");
  const [end, setEnd] = React.useState(current?.shift?.end ?? "17:00");
  const [reason, setReason] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  async function handleSave() {
    setSaving(true);
    const result = await saveScheduleOverride({ employeeId, date: day, start: restDay ? null : start, end: restDay ? null : end, isRestDay: restDay, reason });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    await scheduleOverridesStore.refetch();
    toast.success("Roster updated.");
    close();
  }

  async function handleRemove() {
    if (!existingId) return;
    setSaving(true);
    const result = await deleteScheduleOverride(existingId);
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    await scheduleOverridesStore.refetch();
    toast.success("Back to the weekly pattern.");
    close();
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{formatDate(day, "EEEE, MMM d")}</DialogTitle>
          <DialogDescription>A change for this one day. The weekly pattern is unchanged.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="ov-who">Who</FieldLabel>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger id="ov-who" className="w-full">
                <SelectValue placeholder="Choose" />
              </SelectTrigger>
              <SelectContent>
                {people.map((p) => (
                  <SelectItem key={p.employeeId} value={p.employeeId}>
                    {p.firstName} {p.lastName} · {p.position}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {current ? (
              <p className="text-xs text-muted-foreground">
                Currently: {current.shift ? `${current.shift.start}–${current.shift.end}` : current.hasSchedule ? "rest day" : "no schedule"}
                {current.overridden ? " (already changed for this day)" : ""}
              </p>
            ) : null}
          </Field>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">Rest day</span>
            <Switch checked={restDay} onCheckedChange={setRestDay} />
          </div>
          {!restDay ? (
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="ov-start">Start</FieldLabel>
                <Input id="ov-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="ov-end">End</FieldLabel>
                <Input id="ov-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
                <p className="text-xs text-muted-foreground">Earlier than the start = overnight.</p>
              </Field>
            </div>
          ) : null}
          <Field>
            <FieldLabel htmlFor="ov-reason">Reason</FieldLabel>
            <Input id="ov-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Swapped with Saturday, house duty, …" />
          </Field>
        </div>
        <DialogFooter className="sm:justify-between">
          {existingId ? (
            <Button variant="ghost" className="gap-1.5 text-rose-700" onClick={handleRemove} disabled={saving}>
              <Trash2 className="size-3.5" />
              Remove change
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={close} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !employeeId}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
