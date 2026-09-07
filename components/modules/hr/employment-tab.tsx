"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/patterns/status-badge";
import { useEmploymentEvents, employmentEventsFamily } from "@/lib/hooks/use-employee-detail-collections";
import { employeesStore } from "@/lib/hooks/use-employees-collection";
import { formatDate } from "@/lib/utils/date";
import { addEmploymentEvent, type EmploymentEventInput } from "@/app/(app)/hr/actions";
import { EMPLOYMENT_STATUSES, EMPLOYMENT_TYPES, SEPARATION_CAUSES, type Employee, type EmploymentEventKind, type EmploymentStatus, type EmploymentType, type SeparationCause } from "@/lib/types/hr";

const KIND_LABEL: Record<EmploymentEventKind, string> = {
  hired: "Hired",
  regularized: "Regularised",
  status_change: "Status change",
  position_change: "Position change",
  separated: "Separated",
  rehired: "Rehired",
};
const TYPE_LABEL = Object.fromEntries(EMPLOYMENT_TYPES.map((t) => [t.value, t.label]));
const STATUS_LABEL = Object.fromEntries(EMPLOYMENT_STATUSES.map((t) => [t.value, t.label]));
const CAUSE_LABEL = Object.fromEntries(SEPARATION_CAUSES.map((c) => [c.value, c.label]));
const KEEP = "__keep__";

/** Employment history: every change of status, type or position, with its date and reason. */
export function EmploymentTab({ employee, manages }: { employee: Employee; manages: boolean }) {
  const { events, loading } = useEmploymentEvents(employee.id);
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Employment history</CardTitle>
        {manages ? <EmploymentEventDialog employee={employee} /> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {loading && events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events recorded.</p>
        ) : (
          events.map((ev) => (
            <div key={ev.id} className="flex flex-wrap items-start justify-between gap-2 rounded-xl border px-3 py-2.5 text-sm">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium">
                  {KIND_LABEL[ev.kind]}
                  {ev.kind === "separated" && ev.separationCause ? ` · ${CAUSE_LABEL[ev.separationCause]}` : ""}
                  {ev.position ? ` · ${ev.position}` : ""}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatDate(ev.effectiveOn)}
                  {ev.employmentType ? ` · ${TYPE_LABEL[ev.employmentType]}` : ""}
                  {ev.status ? ` · ${STATUS_LABEL[ev.status]}` : ""}
                  {ev.reason ? ` — ${ev.reason}` : ""}
                </span>
              </div>
              <StatusBadge domain="employee" status={ev.status ?? ev.employmentType ?? "active"} label={KIND_LABEL[ev.kind]} />
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function EmploymentEventDialog({ employee }: { employee: Employee }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState<EmploymentEventInput>({ kind: "regularized", effectiveOn: "", employmentType: null, status: null, position: "", separationCause: null, reason: "" });

  function reset() {
    setForm({ kind: employee.employmentType === "probationary" ? "regularized" : "status_change", effectiveOn: "", employmentType: null, status: null, position: "", separationCause: null, reason: "" });
  }

  async function handleSave() {
    setSaving(true);
    const result = await addEmploymentEvent(employee.id, form);
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    await Promise.all([employmentEventsFamily.get(employee.id).refetch(), employeesStore.refetch()]);
    toast.success("Recorded.");
    setOpen(false);
    router.refresh();
  }

  const showType = form.kind === "status_change" || form.kind === "rehired";
  const showStatus = form.kind === "status_change";
  const showPosition = form.kind === "position_change" || form.kind === "rehired";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Plus className="size-3.5" />
          Record a change
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record an employment change</DialogTitle>
          <DialogDescription>History is appended, never edited: the latest event by date sets the employee&apos;s current status.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="ev-kind">What happened</FieldLabel>
            <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v as EmploymentEventKind, separationCause: null })}>
              <SelectTrigger id="ev-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["regularized", "status_change", "position_change", "separated", "rehired"] as EmploymentEventKind[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {KIND_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="ev-date">Effective on</FieldLabel>
            <Input id="ev-date" type="date" value={form.effectiveOn} onChange={(e) => setForm({ ...form, effectiveOn: e.target.value })} />
          </Field>
          {form.kind === "separated" ? (
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="ev-cause">Cause</FieldLabel>
              <Select value={form.separationCause ?? ""} onValueChange={(v) => setForm({ ...form, separationCause: v as SeparationCause })}>
                <SelectTrigger id="ev-cause" className="w-full">
                  <SelectValue placeholder="Choose the cause" />
                </SelectTrigger>
                <SelectContent>
                  {SEPARATION_CAUSES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label} — {c.hint}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Final pay is due within 30 days and a certificate of employment within 3 (Labor Advisory 06-20).</p>
            </Field>
          ) : null}
          {showType ? (
            <Field>
              <FieldLabel htmlFor="ev-type">Employment type</FieldLabel>
              <Select value={form.employmentType ?? KEEP} onValueChange={(v) => setForm({ ...form, employmentType: v === KEEP ? null : (v as EmploymentType) })}>
                <SelectTrigger id="ev-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={KEEP}>Unchanged</SelectItem>
                  {EMPLOYMENT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
          {showStatus ? (
            <Field>
              <FieldLabel htmlFor="ev-status">Status</FieldLabel>
              <Select value={form.status ?? KEEP} onValueChange={(v) => setForm({ ...form, status: v === KEEP ? null : (v as EmploymentStatus) })}>
                <SelectTrigger id="ev-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={KEEP}>Unchanged</SelectItem>
                  {EMPLOYMENT_STATUSES.filter((s) => s.value === "active" || s.value === "on_leave").map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
          {showPosition ? (
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="ev-position">Position</FieldLabel>
              <Input id="ev-position" value={form.position ?? ""} onChange={(e) => setForm({ ...form, position: e.target.value })} placeholder={employee.position} />
            </Field>
          ) : null}
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="ev-reason">Reason / notes</FieldLabel>
            <Textarea id="ev-reason" rows={2} value={form.reason ?? ""} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Record"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
