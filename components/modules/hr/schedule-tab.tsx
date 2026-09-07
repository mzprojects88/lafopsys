"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Field, FieldLabel } from "@/components/ui/field";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/patterns/status-badge";
import { useWorkScheduleHistory, workSchedulesFamily } from "@/lib/hooks/use-employee-detail-collections";
import { formatDate } from "@/lib/utils/date";
import { addWorkSchedule, type WorkScheduleInput } from "@/app/(app)/hr/actions";
import { WEEKDAYS, type Employee, type SchedulePattern, type Weekday, type WorkSchedule } from "@/lib/types/hr";

const DAY_LABEL: Record<Weekday, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

const DEFAULT_PATTERN: SchedulePattern = {
  mon: { start: "08:00", end: "17:00" },
  tue: { start: "08:00", end: "17:00" },
  wed: { start: "08:00", end: "17:00" },
  thu: { start: "08:00", end: "17:00" },
  fri: { start: "08:00", end: "17:00" },
  sat: null,
  sun: null,
};

export function describePattern(p: SchedulePattern): string {
  const parts: string[] = [];
  let run: Weekday[] = [];
  let runShift = "";
  const flush = () => {
    if (run.length) parts.push(`${DAY_LABEL[run[0]]}${run.length > 1 ? `–${DAY_LABEL[run[run.length - 1]]}` : ""} ${runShift}`);
    run = [];
  };
  for (const d of WEEKDAYS) {
    const s = p[d];
    const key = s ? `${s.start}–${s.end}` : "";
    if (!s) {
      flush();
      continue;
    }
    if (key !== runShift) flush();
    runShift = key;
    run.push(d);
  }
  flush();
  const rest = WEEKDAYS.filter((d) => !p[d]).map((d) => DAY_LABEL[d]);
  return `${parts.join(", ")}${rest.length ? ` · rest ${rest.join("/")}` : ""}`;
}

/**
 * The weekly pattern the DTR is judged against: late, undertime, absent and
 * rest-day premiums all come from this (P2, lib/utils/attendance.ts). A
 * change is a new row from a date, like pay.
 */
export function ScheduleTab({ employee, manages }: { employee: Employee; manages: boolean }) {
  const { history, current, loading } = useWorkScheduleHistory(employee.id);
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Work schedule</CardTitle>
        {manages ? <ScheduleDialog employee={employee} current={current} /> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {loading && history.length === 0 ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No schedule on file. Without one, lateness, undertime and absences cannot be worked out from the DTR.</p>
        ) : (
          history.map((s) => (
            <div key={s.id} className="flex flex-wrap items-start justify-between gap-2 rounded-xl border px-3 py-2.5 text-sm">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium">{describePattern(s.pattern)}</span>
                <span className="text-xs text-muted-foreground">
                  From {formatDate(s.effectiveFrom)}
                  {s.effectiveTo ? ` to ${formatDate(s.effectiveTo)}` : " (current)"} · {s.hoursPerDay} h/day · {s.breakMinutes} min unpaid break
                  {s.reason ? ` — ${s.reason}` : ""}
                </span>
              </div>
              {s.effectiveTo === null ? <StatusBadge domain="employee" status="active" label="Current" /> : null}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function ScheduleDialog({ employee, current }: { employee: Employee; current: WorkSchedule | null }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState<WorkScheduleInput>(() => blank(current));

  function blank(from: WorkSchedule | null): WorkScheduleInput {
    const pattern = { ...(from?.pattern ?? DEFAULT_PATTERN) };
    return { effectiveFrom: "", pattern, breakMinutes: from?.breakMinutes ?? 60, hoursPerDay: from?.hoursPerDay ?? 8, reason: "" };
  }

  function setDay(d: Weekday, shift: { start: string; end: string } | null) {
    setForm((f) => ({ ...f, pattern: { ...f.pattern, [d]: shift } }));
  }

  async function handleSave() {
    setSaving(true);
    const result = await addWorkSchedule(employee.id, form);
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    await workSchedulesFamily.get(employee.id).refetch();
    toast.success("Schedule recorded.");
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setForm(blank(current));
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Plus className="size-3.5" />
          {current ? "New schedule" : "Set schedule"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{current ? "New schedule" : "Set schedule"}</DialogTitle>
          <DialogDescription>A day switched off is a rest day (at least one a week, Art. 91). An end time earlier than the start is an overnight shift.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="sch-from">Effective from</FieldLabel>
              <Input id="sch-from" type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} />
            </Field>
            <Field>
              <FieldLabel htmlFor="sch-hours">Hours per day</FieldLabel>
              <Input id="sch-hours" type="number" min="1" max="12" step="0.5" value={form.hoursPerDay} onChange={(e) => setForm({ ...form, hoursPerDay: Number(e.target.value) })} />
            </Field>
            <Field>
              <FieldLabel htmlFor="sch-break">Unpaid break (min)</FieldLabel>
              <Input id="sch-break" type="number" min="0" max="240" step="5" value={form.breakMinutes} onChange={(e) => setForm({ ...form, breakMinutes: Number(e.target.value) })} />
            </Field>
          </div>
          <div className="flex flex-col gap-2">
            {WEEKDAYS.map((d) => {
              const shift = form.pattern[d];
              return (
                <div key={d} className="grid grid-cols-[3rem_auto_1fr_1fr] items-center gap-2">
                  <span className="text-sm font-medium">{DAY_LABEL[d]}</span>
                  <Switch checked={shift !== null} onCheckedChange={(on) => setDay(d, on ? { start: "08:00", end: "17:00" } : null)} aria-label={`${DAY_LABEL[d]} is a working day`} />
                  {shift ? (
                    <>
                      <Input type="time" value={shift.start} onChange={(e) => setDay(d, { ...shift, start: e.target.value })} aria-label={`${DAY_LABEL[d]} start`} />
                      <Input type="time" value={shift.end} onChange={(e) => setDay(d, { ...shift, end: e.target.value })} aria-label={`${DAY_LABEL[d]} end`} />
                    </>
                  ) : (
                    <span className="col-span-2 text-xs text-muted-foreground">Rest day</span>
                  )}
                </div>
              );
            })}
          </div>
          <Field>
            <FieldLabel htmlFor="sch-reason">Reason</FieldLabel>
            <Input id="sch-reason" value={form.reason ?? ""} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="New shift rotation, part-time arrangement…" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
