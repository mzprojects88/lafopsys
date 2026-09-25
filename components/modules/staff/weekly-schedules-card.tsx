"use client";

import * as React from "react";
import { toast } from "sonner";
import { Link2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/patterns/section-card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScheduleDialog, describePattern } from "@/components/modules/hr/schedule-tab";
import { useCollection } from "@/lib/data/collection-store";
import { allSchedulesStore, rosterStore, type RosterPerson } from "@/lib/hooks/use-roster";
import { useStaffRoster, type StaffRosterEntry } from "@/lib/hooks/use-staff-roster";
import { createEmployee, linkStaffAccount } from "@/app/(app)/hr/actions";
import { EMPLOYMENT_TYPES, type EmploymentType } from "@/lib/types/hr";
import { todayIso } from "@/lib/utils/date";

/**
 * Everyone's weekly schedule, set from Staff & Time (DTR plan phase 3):
 * HR is hidden in production, and without a schedule the DTR cannot say who
 * was late, left early or was absent. A schedule belongs to an HR record,
 * so a login without one is linked to an existing record or given a
 * minimal new one here first. Admins and HR only (the actions check too).
 */
export function WeeklySchedulesCard() {
  const { staff } = useStaffRoster();
  const { data: people } = useCollection(rosterStore);
  const { data: schedules } = useCollection(allSchedulesStore);
  const today = todayIso();
  const active = staff.filter((s) => s.active).sort((a, b) => a.lastName.localeCompare(b.lastName));
  const unlinked = people.filter((p) => !p.staffId && p.status !== "resigned" && p.status !== "terminated");
  const currentFor = (employeeId: string) =>
    schedules
      .filter((s) => s.employeeId === employeeId && s.effectiveFrom <= today && (!s.effectiveTo || s.effectiveTo > today))
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? null;
  const missing = active.filter((s) => {
    const emp = people.find((p) => p.staffId === s.id);
    return !emp || !currentFor(emp.employeeId);
  }).length;

  return (
    <SectionCard
      title="Weekly schedules"
      description={
        missing > 0
          ? `${missing} of ${active.length} people have no schedule yet. Without one, lateness, undertime and absences are not worked out.`
          : "Everyone has a schedule. Late and undertime are measured against it, after the grace period in Settings."
      }
      flush
      bodyClassName="divide-y divide-border"
    >
        {active.map((s) => {
          const emp = people.find((p) => p.staffId === s.id);
          const current = emp ? currentFor(emp.employeeId) : null;
          return (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-theme-sm">
              <div className="flex min-w-0 flex-col">
                <span className="font-medium">
                  {s.firstName} {s.lastName}
                </span>
                <span className="text-theme-xs text-muted-foreground">
                  {!emp ? "No HR record yet: link or create one to set a schedule." : current ? `${describePattern(current.pattern)} · ${current.hoursPerDay} h/day` : "No schedule yet."}
                </span>
              </div>
              {emp ? <ScheduleDialog employee={{ id: emp.employeeId }} current={current} /> : <LinkOrCreate person={s} unlinked={unlinked} />}
            </div>
          );
        })}
    </SectionCard>
  );
}

function LinkOrCreate({ person, unlinked }: { person: StaffRosterEntry; unlinked: RosterPerson[] }) {
  const [employeeId, setEmployeeId] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function link() {
    setBusy(true);
    const r = await linkStaffAccount(employeeId, person.id);
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    toast.success("Linked. Set the schedule next.");
    await rosterStore.refetch();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {unlinked.length > 0 ? (
        <>
          <Select value={employeeId} onValueChange={setEmployeeId}>
            <SelectTrigger className="h-8 w-44" aria-label={`HR record for ${person.firstName} ${person.lastName}`}>
              <SelectValue placeholder="Existing HR record" />
            </SelectTrigger>
            <SelectContent>
              {unlinked.map((p) => (
                <SelectItem key={p.employeeId} value={p.employeeId}>
                  {p.firstName} {p.lastName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={!employeeId || busy} onClick={link}>
            <Link2 className="size-3.5" />
            Link
          </Button>
        </>
      ) : null}
      <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setCreating(true)}>
        <UserPlus className="size-3.5" />
        Create HR record
      </Button>
      {creating ? <CreateRecordDialog person={person} onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

/** The fewest fields an HR record needs (hr/actions.ts validateEmployee); the rest can be filled in HR later. */
function CreateRecordDialog({ person, onClose }: { person: StaffRosterEntry; onClose: () => void }) {
  const [code, setCode] = React.useState("");
  const [position, setPosition] = React.useState(person.position ?? "");
  const [hireDate, setHireDate] = React.useState("");
  const [type, setType] = React.useState<EmploymentType>("probationary");
  const [busy, setBusy] = React.useState(false);

  async function save() {
    setBusy(true);
    const created = await createEmployee({ employeeCode: code, firstName: person.firstName, lastName: person.lastName, position, employmentType: type, hireDate });
    if (!created.ok || !created.data) {
      setBusy(false);
      return toast.error(created.ok ? "The record was not returned." : created.error);
    }
    const linked = await linkStaffAccount(created.data.id, person.id);
    setBusy(false);
    if (!linked.ok) return toast.error(`Record created, but linking failed: ${linked.error}`);
    toast.success("HR record created. Set the schedule next.");
    await rosterStore.refetch();
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            HR record for {person.firstName} {person.lastName}
          </DialogTitle>
          <DialogDescription>The minimum a record needs. Government IDs, pay and the rest can be added in HR later.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="hr-code">Employee ID</FieldLabel>
            <Input id="hr-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="LAF-0007" />
          </Field>
          <Field>
            <FieldLabel htmlFor="hr-hired">Date hired</FieldLabel>
            <Input id="hr-hired" type="date" value={hireDate} max={todayIso()} onChange={(e) => setHireDate(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="hr-position">Position</FieldLabel>
            <Input id="hr-position" value={position} onChange={(e) => setPosition(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="hr-type">Employment</FieldLabel>
            <Select value={type} onValueChange={(v) => setType(v as EmploymentType)}>
              <SelectTrigger id="hr-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EMPLOYMENT_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || !code.trim() || !position.trim() || !hireDate}>
            {busy ? "Saving…" : "Create and link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
