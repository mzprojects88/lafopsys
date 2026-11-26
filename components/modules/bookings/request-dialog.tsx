"use client";

import * as React from "react";
import { AlertTriangle, Printer } from "lucide-react";
import { toast } from "sonner";
import { ConfirmBy } from "@/components/modules/bookings/confirm-by";
import { MembersEditor } from "@/components/modules/bookings/members-editor";
import { ReasonDialog } from "@/components/patterns/reason-dialog";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useBookingRequests, useBookingSetup, type BookingStep } from "@/lib/hooks/use-bookings-collection";
import { useStaffRoster } from "@/lib/hooks/use-staff-roster";
import { createClient } from "@/lib/supabase/client";
import type { BookingRequest } from "@/lib/types/booking";
import { BOOKING_STATUS_LABEL, CHANNEL_LABEL, REQUESTOR_KINDS, WEEKDAYS, durationLabel, participantsLabel } from "@/lib/utils/booking";
import { formatDate, todayIso } from "@/lib/utils/date";
import { formatTime12 } from "@/lib/utils/time12";

const when = (iso: string | null) => formatDate(iso, "MMM d, yyyy, h:mm a");
const TRAIL: Record<string, string> = { requested: "Request filed", approved: "Approved", declined: "Declined", cancelled: "Cancelled", moved: "Moved", names: "Volunteers' names given", date_changed: "Date changed by the group", expired: "Not confirmed in time: closed", attendance: "Who came, confirmed by the group", completed: "Visit recorded", no_show: "Marked: did not come" };
const SOURCE: Record<string, string> = { plan: "In the NCH-approved plan", list: "From LAF's list", suggested: "Suggested by the group" };
/** A moment as `yyyy-MM-ddTHH:mm` in this browser's own time, for a datetime-local input. */
const localInput = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-theme-xs text-muted-foreground">{label}</dt>
      <dd className="text-theme-sm break-words text-foreground">{children || "—"}</dd>
    </div>
  );
}

/**
 * One booking request (0172): who asks, for which slot, the program flow, the volunteers' names, the coordination
 * with NCH, the step that moves it on and its trail. Every step runs in the database (booking.decide), which checks
 * who may and whether the step fits. The page gives the dialog a key per request, so nothing half-typed carries over.
 */
export function RequestDialog({ request, canEdit, onClose }: { request: BookingRequest | null; canEdit: boolean; onClose: () => void }) {
  const { items, volunteers, events, decide, saveNotes, saveMembers } = useBookingRequests();
  const { places, slots, settings } = useBookingSetup();
  const { staff } = useStaffRoster();
  const [busy, setBusy] = React.useState(false);
  const [ask, setAsk] = React.useState<"approve" | "decline" | "cancel" | "move" | "complete" | "no_show" | null>(null);
  const [nch, setNch] = React.useState({ contact: request?.nchContact ?? "", at: "", notes: request?.nchNotes ?? "" });
  const [instructions, setInstructions] = React.useState(request?.instructions ?? "");
  const [staffNote, setStaffNote] = React.useState(request?.staffNote ?? "");
  const [move, setMove] = React.useState({ date: request?.date ?? "", start: request?.start ?? "" });
  const [visit, setVisit] = React.useState({ children: "", volunteers: String(request?.volunteersCount ?? ""), hours: "" });
  // The day’s other entries on the Calendar, so a clash with the foundation’s own events is seen before approving.
  // Kept with the day they were read for; the booking’s own entry (its remark names the booking) is left out.
  const [sameDay, setSameDay] = React.useState<{ day: string; events: { id: string; time: string; title: string; venue: string; holiday: boolean }[] } | null>(null);
  const day = request?.date ?? "";
  const seqNo = request?.seqNo ?? "";
  React.useEffect(() => {
    let live = true;
    if (day)
      void createClient()
        .schema("ops")
        .from("calendar_events")
        .select("id, time, title, venue, is_holiday, remarks")
        .eq("date", day)
        .is("sheet_removed_at", null)
        .order("time")
        .then(({ data }) => {
          if (!live) return;
          const events = (data ?? []).filter((e) => !(seqNo && String(e.remarks ?? "").includes(seqNo))).map((e) => ({ id: e.id as string, time: String(e.time ?? ""), title: String(e.title ?? ""), venue: String(e.venue ?? ""), holiday: e.is_holiday === true }));
          setSameDay({ day, events });
        });
    return () => {
      live = false;
    };
  }, [day, seqNo]);

  if (!request) return null;
  const r = request;
  const place = places.find((p) => p.id === r.placeId);
  const flow = items.filter((i) => i.requestId === r.id);
  const members = volunteers.filter((v) => v.requestId === r.id);
  const trail = events.filter((e) => e.requestId === r.id);
  const open = r.status === "pending" || r.status === "approved";
  const visited = r.status === "approved" && r.date <= todayIso();
  const who = (id: string | null, byRequestor: boolean) => {
    if (byRequestor) return "The requestor";
    const s = staff.find((x) => x.id === id);
    return s ? `${s.firstName} ${s.lastName}`.trim() : "Staff";
  };
  // The slots the place offers on the weekday of the chosen day (the database is the judge of what is free).
  const weekday = move.date ? new Date(`${move.date}T00:00:00Z`).getUTCDay() : -1;
  const offered = slots.filter((s) => s.placeId === r.placeId && s.active && s.weekday === weekday);

  async function run(step: BookingStep, payload: Record<string, unknown>, done: string) {
    setBusy(true);
    const res = await decide(r.id, step, payload);
    setBusy(false);
    if (!res.ok) return void toast.error(res.error);
    toast.success(done);
    setAsk(null);
  }
  async function keep(what: Promise<{ ok: true } | { ok: false; error: string }>, done: string) {
    setBusy(true);
    const res = await what;
    setBusy(false);
    if (!res.ok) return void toast.error(res.error);
    toast.success(done);
  }
  const approve = () =>
    run("approve", { instructions, ...(r.offPlan ? { nch_contact: nch.contact, nch_coordinated_at: nch.at ? new Date(nch.at).toISOString() : "", nch_notes: nch.notes } : {}) }, "Approved. The requestor is told by email.");

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {r.requestorName}
              <StatusBadge domain="booking" status={r.status} label={BOOKING_STATUS_LABEL[r.status]} />
              {r.status === "pending" && r.confirmBy ? <ConfirmBy day={r.confirmBy} /> : null}
            </DialogTitle>
            <DialogDescription>
              {r.seqNo} · Request ID {r.ref} · filed {when(r.createdAt)}
            </DialogDescription>
          </DialogHeader>

          {r.status === "approved" || r.status === "completed" ? (
            <a href={`/api/bookings/pdf?kind=details&id=${r.id}`} target="_blank" rel="noreferrer noopener" className="inline-flex w-fit items-center gap-1.5 text-theme-sm font-medium text-primary underline-offset-4 hover:underline">
              <Printer className="size-4" /> Booking Details sheet for the NCH guard (PDF)
            </a>
          ) : null}

          <dl className="grid min-w-0 grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
            <Fact label="Day">{formatDate(r.date, "EEEE, MMM d, yyyy")}</Fact>
            <Fact label="Time">{`${formatTime12(r.start)} to ${formatTime12(r.end)}`}</Fact>
            <Fact label="Place">{place?.name}</Fact>
            <Fact label="Requestor">{REQUESTOR_KINDS.find((k) => k.key === r.requestorKind)?.label}</Fact>
            <Fact label="Contact person">{r.contactPerson}</Fact>
            <Fact label="Volunteers">{`${r.volunteersCount}${r.hasMinors ? " (some under 18)" : ""}`}</Fact>
            <Fact label="Email">{r.email || "None given (no email is sent)"}</Fact>
            <Fact label="Mobile">{r.mobile}</Fact>
            <Fact label="How it came">{CHANNEL_LABEL[r.channel]}</Fact>
            {r.declineReason ? <Fact label="Why it was declined">{r.declineReason}</Fact> : null}
            {r.status === "completed" ? <Fact label="The visit">{`${r.attendedChildren ?? 0} children · ${r.attendedVolunteers ?? 0} volunteers · ${r.attendedHours ?? 0} h`}</Fact> : null}
          </dl>

          <section className="min-w-0 flex flex-col gap-2">
            <h4 className="text-theme-sm font-medium text-foreground">Program flow</h4>
            <div className="overflow-x-auto rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Activity</TableHead>
                    <TableHead>Purpose</TableHead>
                    <TableHead>Participants</TableHead>
                    <TableHead>Materials</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {flow.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="whitespace-nowrap">
                        {formatTime12(i.start)} to {formatTime12(i.end)}
                        <div className="text-theme-xs text-muted-foreground">{durationLabel(i.start, i.end)}</div>
                      </TableCell>
                      <TableCell className="min-w-36 whitespace-normal">
                        {i.activity}
                        <div className="text-theme-xs text-muted-foreground">{SOURCE[i.source]}</div>
                      </TableCell>
                      <TableCell className="min-w-28 whitespace-normal">{i.purpose || "—"}</TableCell>
                      <TableCell className="min-w-28 whitespace-normal">{participantsLabel(i)}</TableCell>
                      <TableCell className="min-w-28 whitespace-normal">{i.materials || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>

          {sameDay?.day === r.date && sameDay.events.length ? (
            <section className="min-w-0 flex flex-col gap-1.5">
              <h4 className="text-theme-sm font-medium text-foreground">Also on the Calendar that day</h4>
              <ul className="flex flex-col gap-1 text-theme-sm text-muted-foreground">
                {sameDay.events.map((e) => (
                  <li key={e.id}>
                    <span className="text-foreground">{e.title}</span>
                    {e.time ? ` · ${e.time}` : ""}
                    {e.venue ? ` · ${e.venue}` : ""}
                    {e.holiday ? " · Holiday" : ""}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {r.offPlan ? (
            <section className="min-w-0 flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning/5 p-4">
              <p className="flex items-start gap-2 text-theme-sm text-foreground">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                An activity here is not in the month&apos;s NCH-approved plan. Inform NCH, then record who you coordinated with and when. Your approval says it is coordinated.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="nch-contact">Coordinated with (at NCH)</FieldLabel>
                  <Input id="nch-contact" value={nch.contact} maxLength={120} disabled={!canEdit || !open} onChange={(e) => setNch({ ...nch, contact: e.target.value })} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="nch-at">Date and time of the call or approval</FieldLabel>
                  {r.nchCoordinatedAt && !nch.at ? (
                    <div className="flex h-10 items-center justify-between gap-2 text-theme-sm">
                      {when(r.nchCoordinatedAt)}
                      {canEdit && open ? (
                        <Button type="button" variant="ghost" size="sm" onClick={() => setNch({ ...nch, at: localInput(new Date(r.nchCoordinatedAt ?? Date.now())) })}>
                          Change
                        </Button>
                      ) : null}
                    </div>
                  ) : (
                    <Input id="nch-at" type="datetime-local" value={nch.at} max={localInput()} disabled={!canEdit || !open} onChange={(e) => setNch({ ...nch, at: e.target.value })} />
                  )}
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="nch-notes">Notes</FieldLabel>
                <Textarea id="nch-notes" rows={2} value={nch.notes} maxLength={1000} disabled={!canEdit || !open} onChange={(e) => setNch({ ...nch, notes: e.target.value })} />
              </Field>
              {canEdit && open ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="self-start"
                  disabled={busy}
                  onClick={() => keep(saveNotes(r.id, { nchContact: nch.contact, nchNotes: nch.notes, ...(nch.at ? { nchCoordinatedAt: new Date(nch.at).toISOString() } : {}) }), "Coordination saved.")}
                >
                  Save the coordination
                </Button>
              ) : null}
            </section>
          ) : null}

          <MembersEditor
            key={members.map((m) => `${m.id}${m.email}${m.came}`).join()}
            members={members}
            count={r.volunteersCount}
            // On the day staff may add who turned up beyond the number booked, up to the group limit (0185).
            limit={Math.max(r.volunteersCount, settings.maxVolunteers)}
            recorded={r.status === "completed"}
            canEdit={canEdit && r.status !== "declined" && r.status !== "cancelled"}
            busy={busy}
            onSave={async (rows) => {
              setBusy(true);
              const res = await saveMembers(r.id, rows);
              setBusy(false);
              if (!res.ok) {
                toast.error(res.error);
                return false;
              }
              toast.success("Members saved.");
              return true;
            }}
          />

          <section className="min-w-0 grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="instructions">Instructions for this booking</FieldLabel>
                <Textarea id="instructions" rows={2} value={instructions} maxLength={2000} disabled={!canEdit} onChange={(e) => setInstructions(e.target.value)} />
                <FieldDescription>Shown to the group once approved, with the place&apos;s own instructions.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="staff-note">Note for staff</FieldLabel>
                <Textarea id="staff-note" rows={2} value={staffNote} maxLength={2000} disabled={!canEdit} onChange={(e) => setStaffNote(e.target.value)} />
                <FieldDescription>Never shown to the group.</FieldDescription>
              </Field>
              {canEdit && (instructions !== r.instructions || staffNote !== r.staffNote) ? (
                <Button type="button" variant="outline" size="sm" className="self-start" disabled={busy} onClick={() => keep(saveNotes(r.id, { instructions, staffNote }), "Saved.")}>
                  Save the notes
                </Button>
              ) : null}
            </div>
          </section>

          <section className="min-w-0 flex flex-col gap-1.5">
            <h4 className="text-theme-sm font-medium text-foreground">Trail</h4>
            <ul className="flex flex-col gap-1 text-theme-sm text-muted-foreground">
              {trail.map((e) => (
                <li key={e.id}>
                  <span className="text-foreground">{TRAIL[e.action] ?? e.action}</span> · {who(e.actor, e.byRequestor)} · {when(e.at)}
                  {e.detail ? ` · ${e.detail}` : ""}
                </li>
              ))}
            </ul>
          </section>

          {canEdit && open ? (
            <DialogFooter className="flex-wrap gap-2 sm:justify-between">
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" disabled={busy} onClick={() => setAsk("move")}>
                  Move
                </Button>
                <Button type="button" variant="outline" disabled={busy} onClick={() => setAsk("cancel")}>
                  Cancel booking
                </Button>
                {r.status === "pending" ? (
                  <Button type="button" variant="outline" disabled={busy} onClick={() => setAsk("decline")}>
                    Decline
                  </Button>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {visited ? (
                  <>
                    <Button type="button" variant="outline" disabled={busy} onClick={() => setAsk("no_show")}>
                      Did not come
                    </Button>
                    <Button type="button" disabled={busy} onClick={() => setAsk("complete")}>
                      Record the visit
                    </Button>
                  </>
                ) : null}
                {r.status === "pending" ? (
                  <Button type="button" disabled={busy} onClick={approve}>
                    Approve
                  </Button>
                ) : null}
              </div>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>

      <ReasonDialog
        open={ask === "decline"}
        onOpenChange={(o) => !o && setAsk(null)}
        title="Decline this request?"
        description="The requestor is told by email, with your reason. The slot becomes free again."
        confirmLabel="Decline"
        requireReason
        minLength={5}
        destructive
        onConfirm={(reason) => run("decline", { reason }, "Declined. The slot is free again.")}
      />
      <ReasonDialog
        open={ask === "cancel"}
        onOpenChange={(o) => !o && setAsk(null)}
        title="Cancel this booking?"
        description="The requestor is told by email. The slot becomes free again."
        confirmLabel="Cancel booking"
        destructive
        onConfirm={(reason) => run("cancel", { reason }, "Cancelled. The slot is free again.")}
      />
      <ReasonDialog
        open={ask === "no_show"}
        onOpenChange={(o) => !o && setAsk(null)}
        title="The group did not come?"
        description="The booking is closed as Did not come."
        confirmLabel="Did not come"
        destructive
        onConfirm={() => run("no_show", {}, "Recorded.")}
      />

      <Dialog open={ask === "move"} onOpenChange={(o) => !o && setAsk(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Move to another slot</DialogTitle>
            <DialogDescription>The program flow moves with it. Only a free slot of the same length can take it.</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="move-date">Day</FieldLabel>
            <Input id="move-date" type="date" value={move.date} min={todayIso()} onChange={(e) => setMove({ date: e.target.value, start: "" })} />
          </Field>
          <Field>
            <FieldLabel>Slot</FieldLabel>
            <Select value={move.start} onValueChange={(start) => setMove({ ...move, start })} disabled={!offered.length}>
              <SelectTrigger>
                <SelectValue placeholder={offered.length ? "Choose a slot" : weekday >= 0 ? `No slot on a ${WEEKDAYS[weekday]}` : "Choose a day first"} />
              </SelectTrigger>
              <SelectContent>
                {offered.map((s) => (
                  <SelectItem key={s.id} value={s.start}>
                    {formatTime12(s.start)} to {formatTime12(s.end)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAsk(null)}>
              Back
            </Button>
            <Button type="button" disabled={busy || !move.date || !move.start || (move.date === r.date && move.start === r.start)} onClick={() => run("move", { date: move.date, start_time: move.start }, "Moved. The requestor is told by email.")}>
              Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={ask === "complete"} onOpenChange={(o) => !o && setAsk(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record the visit</DialogTitle>
            <DialogDescription>Who came, and for how long. This closes the booking as Completed.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-3">
            <Field>
              <FieldLabel htmlFor="v-children">Children</FieldLabel>
              <Input id="v-children" inputMode="numeric" value={visit.children} onChange={(e) => setVisit({ ...visit, children: e.target.value.replace(/\D/g, "").slice(0, 3) })} />
            </Field>
            <Field>
              <FieldLabel htmlFor="v-volunteers">Volunteers</FieldLabel>
              <Input id="v-volunteers" inputMode="numeric" value={visit.volunteers} onChange={(e) => setVisit({ ...visit, volunteers: e.target.value.replace(/\D/g, "").slice(0, 3) })} />
            </Field>
            <Field>
              <FieldLabel htmlFor="v-hours">Hours</FieldLabel>
              <Input id="v-hours" inputMode="decimal" value={visit.hours} placeholder={String((new Date(`1970-01-01T${r.end}:00Z`).getTime() - new Date(`1970-01-01T${r.start}:00Z`).getTime()) / 3_600_000)} onChange={(e) => setVisit({ ...visit, hours: e.target.value.replace(/[^\d.]/g, "").slice(0, 4) })} />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAsk(null)}>
              Back
            </Button>
            <Button type="button" disabled={busy || !visit.children || !visit.volunteers || !/^\d{1,2}(\.\d{1,2})?$/.test(visit.hours)} onClick={() => run("complete", visit, "The visit is recorded.")}>
              Record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
