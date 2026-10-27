"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Award, Clock, Pencil, Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { SectionCard } from "@/components/patterns/section-card";
import { PersonAvatar } from "@/components/patterns/person-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useVolunteersData, type VolunteerDraft } from "@/lib/hooks/use-volunteers-collection";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import { useRole } from "@/lib/rbac/use-role";
import { holdsPower } from "@/lib/rbac/roles";
import { VOLUNTEER_ACTIVITIES, type Volunteer, type VolunteerActivity } from "@/lib/types/staff";
import { formatDate, todayIso } from "@/lib/utils/date";

const BLANK: VolunteerDraft = { firstName: "", lastName: "", focusArea: "Care Cart", phone: "", email: "", active: true };
const hoursLabel = (h: number) => `${Math.round(h * 100) / 100} h`;

/**
 * Staff › Volunteers (0116): who volunteers, every session they serve, and their service
 * certificates. House Ops editors (Social Worker, House Staff, Driver) and Staff editors add
 * volunteers and log hours; the Super Admin and the Office Admin print certificates.
 */
export default function VolunteersPage() {
  const access = useModuleAccess();
  const { roles } = useRole();
  const canEdit = access.canEdit("staff") || access.canEdit("house_ops");
  const canCertify = access.canEdit("staff") || holdsPower(roles, "runs_hr");
  const { volunteers, hours, addVolunteer, updateVolunteer, logHours, removeHours } = useVolunteersData();
  const today = todayIso();
  const year = today.slice(0, 4);

  const [editing, setEditing] = React.useState<{ id: string | null; draft: VolunteerDraft } | null>(null);
  const [logging, setLogging] = React.useState<{ volunteerId: string; date: string; hours: string; activity: VolunteerActivity; note: string } | null>(null);
  const [certFor, setCertFor] = React.useState<{ volunteer: Volunteer; from: string; to: string } | null>(null);
  const [busy, setBusy] = React.useState(false);

  const nameOf = (id: string) => {
    const v = volunteers.find((x) => x.id === id);
    return v ? `${v.firstName} ${v.lastName}` : "Volunteer";
  };
  const hoursThisYear = hours.filter((h) => h.date.startsWith(year)).reduce((s, h) => s + h.hours, 0);
  const sessionsThisMonth = hours.filter((h) => h.date.startsWith(today.slice(0, 7))).length;

  async function saveVolunteer() {
    if (!editing) return;
    if (!editing.draft.firstName.trim() || !editing.draft.lastName.trim()) return void toast.error("Enter the first and last name.");
    setBusy(true);
    const r = editing.id ? await updateVolunteer(editing.id, editing.draft) : await addVolunteer(editing.draft);
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success(editing.id ? "Volunteer saved" : "Volunteer added");
    setEditing(null);
  }

  async function saveHours() {
    if (!logging) return;
    const h = Number(logging.hours);
    if (!logging.volunteerId) return void toast.error("Choose the volunteer.");
    if (!Number.isFinite(h) || h <= 0 || h > 24) return void toast.error("Hours must be more than 0 and at most 24.");
    if (logging.date > today) return void toast.error("Hours can't be logged ahead.");
    setBusy(true);
    const r = await logHours({ volunteerId: logging.volunteerId, date: logging.date, hours: h, activity: logging.activity, note: logging.note });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success(`${hoursLabel(h)} logged for ${nameOf(logging.volunteerId)}`);
    setLogging(null);
  }

  async function downloadCertificate() {
    if (!certFor) return;
    setBusy(true);
    try {
      const res = await fetch("/api/volunteers/certificate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ volunteerId: certFor.volunteer.id, from: certFor.from, to: certFor.to }) });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(e.error ?? "Couldn't make the certificate.");
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `Volunteer certificate - ${certFor.volunteer.firstName} ${certFor.volunteer.lastName}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setCertFor(null);
    } finally {
      setBusy(false);
    }
  }

  const columns: ColumnDef<Volunteer>[] = [
    {
      id: "name",
      header: "Name",
      accessorFn: (v) => `${v.firstName} ${v.lastName}`,
      cell: ({ row }) => {
        const name = `${row.original.firstName} ${row.original.lastName}`;
        return (
          <div className="flex items-center gap-2.5">
            <PersonAvatar name={name} size="sm" />
            <span className="font-medium">{name}</span>
            {!row.original.active ? <Badge variant="outline">Inactive</Badge> : null}
          </div>
        );
      },
    },
    { accessorKey: "focusArea", header: "Helps with" },
    { id: "contact", header: "Contact", accessorFn: (v) => v.phone || v.email, cell: ({ row }) => <span className="text-muted-foreground">{row.original.phone || row.original.email || "—"}</span> },
    { accessorKey: "totalHours", header: "Hours", cell: ({ row }) => hoursLabel(row.original.totalHours) },
    { accessorKey: "lastSessionDate", header: "Last session", cell: ({ row }) => (row.original.lastSessionDate ? formatDate(row.original.lastSessionDate) : "—") },
    { accessorKey: "certificatesIssued", header: "Certificates" },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const v = row.original;
        return (
          <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            {canEdit ? (
              <>
                <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={() => setLogging({ volunteerId: v.id, date: today, hours: "", activity: v.focusArea, note: "" })}>
                  <Clock className="size-3.5" /> Log hours
                </Button>
                <Button size="sm" variant="ghost" className="h-7" aria-label={`Edit ${v.firstName} ${v.lastName}`} onClick={() => setEditing({ id: v.id, draft: { firstName: v.firstName, lastName: v.lastName, focusArea: v.focusArea, phone: v.phone, email: v.email, active: v.active } })}>
                  <Pencil className="size-3.5" />
                </Button>
              </>
            ) : null}
            {canCertify ? (
              <Button size="sm" variant="outline" className="h-7 gap-1.5" disabled={v.totalHours <= 0} onClick={() => setCertFor({ volunteer: v, from: `${year}-01-01`, to: today })}>
                <Award className="size-3.5" /> Certificate
              </Button>
            ) : null}
          </div>
        );
      },
    },
  ];

  const setDraft = <K extends keyof VolunteerDraft>(k: K, value: VolunteerDraft[K]) => setEditing((e) => (e ? { ...e, draft: { ...e.draft, [k]: value } } : e));

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Volunteers"
        description="The people who help at the Care Cart, the LAF Center, events and on the road: every session logged, and a service certificate when they need one."
        action={
          canEdit ? (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setLogging({ volunteerId: "", date: today, hours: "", activity: "Care Cart", note: "" })} disabled={!volunteers.some((v) => v.active)}>
                <Clock /> Log hours
              </Button>
              <Button onClick={() => setEditing({ id: null, draft: BLANK })}>
                <Plus /> Add volunteer
              </Button>
            </div>
          ) : null
        }
      />
      <KpiGrid>
        <KpiCard label="Active volunteers" value={volunteers.filter((v) => v.active).length} icon={Users} />
        <KpiCard label={`Hours in ${year}`} value={hoursLabel(hoursThisYear)} icon={Clock} />
        <KpiCard label="Sessions this month" value={sessionsThisMonth} icon={Award} />
      </KpiGrid>
      <DataTable columns={columns} data={volunteers} searchPlaceholder="Search volunteers…" />

      {hours.length > 0 ? (
        <SectionCard flush className="overflow-hidden" title="Latest sessions" description="The most recent hours logged.">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-theme-sm">
              <tbody>
                {hours.slice(0, 15).map((h) => (
                  <tr key={h.id} className="border-b border-border last:border-0">
                    <td className="px-5 py-2.5 whitespace-nowrap text-muted-foreground">{formatDate(h.date)}</td>
                    <td className="px-5 py-2.5 font-medium">{nameOf(h.volunteerId)}</td>
                    <td className="px-5 py-2.5">{h.activity}</td>
                    <td className="px-5 py-2.5 tabular-nums">{hoursLabel(h.hours)}</td>
                    <td className="px-5 py-2.5 text-muted-foreground">{h.note}</td>
                    <td className="px-5 py-2.5 text-right">
                      {canEdit ? (
                        <Button size="sm" variant="ghost" className="h-7 text-destructive" aria-label="Remove this session" onClick={async () => { const r = await removeHours(h.id); if (!r.ok) toast.error(r.error); }}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      ) : null}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit volunteer" : "Add volunteer"}</DialogTitle>
          </DialogHeader>
          {editing ? (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel htmlFor="vol-first">First name</FieldLabel>
                  <Input id="vol-first" value={editing.draft.firstName} maxLength={60} onChange={(e) => setDraft("firstName", e.target.value)} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="vol-last">Last name</FieldLabel>
                  <Input id="vol-last" value={editing.draft.lastName} maxLength={60} onChange={(e) => setDraft("lastName", e.target.value)} />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="vol-focus">Usually helps with</FieldLabel>
                <Select value={editing.draft.focusArea} onValueChange={(v) => setDraft("focusArea", v as VolunteerActivity)}>
                  <SelectTrigger id="vol-focus" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {VOLUNTEER_ACTIVITIES.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel htmlFor="vol-phone">Phone</FieldLabel>
                  <Input id="vol-phone" inputMode="tel" value={editing.draft.phone} maxLength={40} onChange={(e) => setDraft("phone", e.target.value)} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="vol-email">Email</FieldLabel>
                  <Input id="vol-email" type="email" value={editing.draft.email} maxLength={120} onChange={(e) => setDraft("email", e.target.value)} />
                </Field>
              </div>
              {editing.id ? (
                <label htmlFor="vol-active" className="flex items-center justify-between gap-3 text-sm">
                  Still volunteering
                  <Switch id="vol-active" checked={editing.draft.active} onCheckedChange={(v) => setDraft("active", v)} />
                </label>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button disabled={busy} onClick={saveVolunteer}>{busy ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!logging} onOpenChange={(o) => !o && setLogging(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Log hours</DialogTitle>
            <DialogDescription>One line per session a volunteer served.</DialogDescription>
          </DialogHeader>
          {logging ? (
            <div className="flex flex-col gap-3">
              <Field>
                <FieldLabel htmlFor="log-volunteer">Volunteer</FieldLabel>
                <Select value={logging.volunteerId || undefined} onValueChange={(v) => setLogging({ ...logging, volunteerId: v, activity: volunteers.find((x) => x.id === v)?.focusArea ?? logging.activity })}>
                  <SelectTrigger id="log-volunteer" className="w-full"><SelectValue placeholder="Who served?" /></SelectTrigger>
                  <SelectContent>
                    {volunteers.filter((v) => v.active || v.id === logging.volunteerId).map((v) => <SelectItem key={v.id} value={v.id}>{v.firstName} {v.lastName}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel htmlFor="log-date">Date</FieldLabel>
                  <Input id="log-date" type="date" max={today} value={logging.date} onChange={(e) => e.target.value && setLogging({ ...logging, date: e.target.value })} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="log-hours">Hours</FieldLabel>
                  <Input id="log-hours" type="number" inputMode="decimal" min={0.25} max={24} step={0.25} value={logging.hours} onChange={(e) => setLogging({ ...logging, hours: e.target.value })} />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="log-activity">Activity</FieldLabel>
                <Select value={logging.activity} onValueChange={(v) => setLogging({ ...logging, activity: v as VolunteerActivity })}>
                  <SelectTrigger id="log-activity" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {VOLUNTEER_ACTIVITIES.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="log-note">Note (optional)</FieldLabel>
                <Input id="log-note" value={logging.note} maxLength={200} onChange={(e) => setLogging({ ...logging, note: e.target.value })} placeholder="e.g. 5:00 PM Care Cart run" />
              </Field>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setLogging(null)}>Cancel</Button>
            <Button disabled={busy} onClick={saveHours}>{busy ? "Saving…" : "Log hours"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!certFor} onOpenChange={(o) => !o && setCertFor(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Service certificate</DialogTitle>
            <DialogDescription>{certFor ? `${certFor.volunteer.firstName} ${certFor.volunteer.lastName}: the hours logged in the period, signed by the certificate signatory in Settings.` : ""}</DialogDescription>
          </DialogHeader>
          {certFor ? (
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="cert-from">From</FieldLabel>
                <Input id="cert-from" type="date" max={certFor.to} value={certFor.from} onChange={(e) => e.target.value && setCertFor({ ...certFor, from: e.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="cert-to">To</FieldLabel>
                <Input id="cert-to" type="date" min={certFor.from} max={today} value={certFor.to} onChange={(e) => e.target.value && setCertFor({ ...certFor, to: e.target.value })} />
              </Field>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCertFor(null)}>Cancel</Button>
            <Button disabled={busy} onClick={downloadCertificate}>{busy ? "Making…" : "Download PDF"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
