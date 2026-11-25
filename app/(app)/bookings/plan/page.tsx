"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, FileDown, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { LoadingState } from "@/components/patterns/loading-state";
import { PageHeader } from "@/components/patterns/page-header";
import { ReasonDialog } from "@/components/patterns/reason-dialog";
import { SectionCard } from "@/components/patterns/section-card";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useRole } from "@/context/role-provider";
import { useBookingPlans, type PlanItemInput } from "@/lib/hooks/use-booking-plans";
import { fetchSlotStates, useBookingSetup, type MutationResult } from "@/lib/hooks/use-bookings-collection";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import type { SlotOfDay } from "@/lib/types/booking";
import { PLAN_STATUS_LABEL, durationLabel, lastDayOf, minutesOf, monthCover, monthName, shiftMonth } from "@/lib/utils/booking";
import { formatDate, todayIso } from "@/lib/utils/date";
import { formatTime12 } from "@/lib/utils/time12";

type ItemForm = PlanItemInput & { id: string | null };

/**
 * LAF Activity Center Bookings › Activity Plan (0172, 0176): the month's activities for a place, which the social
 * worker prepares and sends to National Children's Hospital. The plan is a complete list by day (owner, 26 Nov
 * 2026): every date from the 1st to the last, and for each date its activities with their goal, participants,
 * duration and materials. Once NCH approved it, a day's activities are offered first on the booking page for that
 * day, and a booking for one of them needs no further coordination. Activities can be changed only while the plan
 * is a draft or was returned: an approved plan is reopened first, which takes the approval away.
 */
export default function ActivityPlanPage() {
  const access = useModuleAccess();
  const canEdit = access.levelOfPath("/bookings/plan") === "edit";
  const { staffId } = useRole();
  const { places, activityTypes, loading: setupLoading } = useBookingSetup();
  const book = useBookingPlans();
  const [month, setMonth] = React.useState(() => shiftMonth(todayIso().slice(0, 7), 1));
  const [chosenPlace, setChosenPlace] = React.useState<string | null>(null);
  const [item, setItem] = React.useState<ItemForm | null>(null);
  const [ask, setAsk] = React.useState<"approve" | "return" | "reopen" | null>(null);
  const [approval, setApproval] = React.useState({ by: "", on: todayIso() });
  const [notes, setNotes] = React.useState<{ planId: string; text: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  // The month's slots, kept with what they were read for: the days a group can come, their times, holidays and closed dates.
  const [read, setRead] = React.useState<{ key: string; slots: SlotOfDay[] } | null>(null);
  const placeId = chosenPlace ?? places[0]?.id ?? "";
  const readKey = `${placeId}|${month}`;

  React.useEffect(() => {
    let live = true;
    if (placeId) void fetchSlotStates(placeId, `${month}-01`, lastDayOf(month)).then((slots) => live && setRead({ key: readKey, slots }), () => live && setRead({ key: readKey, slots: [] }));
    return () => {
      live = false;
    };
  }, [placeId, month, readKey]);

  if (book.loading || setupLoading) return <LoadingState />;

  const slots = read?.key === readKey ? read.slots : [];
  const plan = book.plans.find((p) => p.placeId === placeId && p.month === month) ?? null;
  const items = plan ? book.items.filter((i) => i.planId === plan.id) : [];
  const earlier = book.plans.filter((p) => p.placeId === placeId && p.month < month && book.items.some((i) => i.planId === p.id)).sort((a, b) => b.month.localeCompare(a.month))[0];
  const open = !!plan && canEdit && (plan.status === "draft" || plan.status === "returned");
  const noteText = notes && plan && notes.planId === plan.id ? notes.text : (plan?.notes ?? "");
  const days = Array.from({ length: Number(lastDayOf(month).slice(8)) }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
  const planned = new Set(items.map((i) => i.onDate)).size;
  /** Why a day holds no activity, when there is a reason: a holiday, a closed date, or no slot on that weekday. */
  const dayNote = (day: string): string => {
    const of = slots.filter((s) => s.day === day);
    if (read?.key !== readKey) return "";
    if (of.some((s) => s.state === "holiday")) return "Holiday";
    if (of.some((s) => s.state === "closed")) return "Closed";
    return of.length ? "" : "No slot on this day";
  };
  /** A new activity for a day starts after the day's last one, inside the day's slot when it has one. */
  const newItem = (day: string): ItemForm => {
    const slot = slots.find((s) => s.day === day);
    const last = items.filter((i) => i.onDate === day && i.end).sort((a, b) => b.end.localeCompare(a.end))[0];
    const start = last?.end ?? slot?.start ?? "10:00";
    const end = slot && minutesOf(slot.end) > minutesOf(start) ? slot.end : "";
    return { id: null, onDate: day, activity: "", purpose: "", participants: "", materials: "", start, end };
  };
  const timeProblem = item && (item.start || item.end) && !(minutesOf(item.end) > minutesOf(item.start)) ? "Give both times, the end after the start; or leave both empty." : "";

  async function run(what: Promise<MutationResult>, done: string, after?: () => void) {
    setBusy(true);
    const r = await what;
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success(done);
    after?.();
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Activity Plan"
        description="The month's activities at the LAF Activity Center, day by day, sent to National Children's Hospital for approval."
        action={
          <div className="flex flex-wrap items-center gap-2">
            {places.length > 1 ? (
              <Select value={placeId} onValueChange={setChosenPlace}>
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="Place" />
                </SelectTrigger>
                <SelectContent>
                  {places.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <Button type="button" variant="outline" size="icon" aria-label="The month before" onClick={() => setMonth(shiftMonth(month, -1))}>
              <ChevronLeft className="size-4" />
            </Button>
            <span className="min-w-36 text-center text-theme-sm font-medium text-foreground">{monthName(month)}</span>
            <Button type="button" variant="outline" size="icon" aria-label="The month after" onClick={() => setMonth(shiftMonth(month, 1))}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        }
      />

      {!plan ? (
        <SectionCard title={`No plan for ${monthName(month)} yet`} description={`A plan covers ${monthCover(month)}, day by day. Until NCH approves one, every booking for the month is coordinated with the hospital one by one.`}>
          {canEdit && placeId ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={busy} onClick={() => run(book.createPlan(placeId, month, staffId ?? null), "The plan is started as a draft.")}>
                <Plus className="size-4" /> Start the plan
              </Button>
              {earlier ? (
                <Button type="button" variant="outline" disabled={busy} onClick={() => run(book.createPlan(placeId, month, staffId ?? null, earlier.id), `Started from ${monthName(earlier.month)}: each activity on the same weekday of the same week.`)}>
                  Start from {monthName(earlier.month)}&apos;s plan
                </Button>
              ) : null}
            </div>
          ) : (
            <p className="text-theme-sm text-muted-foreground">The social worker or the office admin starts the plan.</p>
          )}
        </SectionCard>
      ) : (
        <>
          <SectionCard
            title={`${monthName(month)} · ${places.find((p) => p.id === placeId)?.name ?? ""}`}
            description={
              plan.status === "approved"
                ? `Approved by ${plan.approvedBy || "NCH"} on ${formatDate(plan.approvedOn)}. Each day's activities are offered first on the booking page for that day.`
                : plan.status === "submitted"
                  ? `Sent to NCH on ${formatDate(plan.submittedOn)}. Record its approval here once the signed copy comes back.`
                  : `Covers ${monthCover(month)}: ${items.length} activit${items.length === 1 ? "y" : "ies"} on ${planned} day${planned === 1 ? "" : "s"}. Add each day's activities, download the PDF and send it to NCH.`
            }
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge domain="booking_plan" status={plan.status} label={PLAN_STATUS_LABEL[plan.status]} />
                <Button asChild variant="outline" size="sm">
                  <a href={`/api/bookings/pdf?kind=plan&id=${plan.id}`} target="_blank" rel="noreferrer noopener">
                    <FileDown className="size-4" /> PDF
                  </a>
                </Button>
              </div>
            }
            flush
          >
            <div className="overflow-x-auto border-t border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Activity</TableHead>
                    <TableHead>Goal</TableHead>
                    <TableHead>Participants</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Materials</TableHead>
                    <TableHead className="w-28" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {days.flatMap((day) => {
                    const of = items.filter((i) => i.onDate === day);
                    const date = (
                      <TableCell className="align-top whitespace-nowrap" rowSpan={Math.max(of.length, 1)}>
                        <span className="font-medium text-foreground">{formatDate(day, "MMM d")}</span>
                        <div className="text-theme-xs text-muted-foreground">{formatDate(day, "EEEE")}</div>
                      </TableCell>
                    );
                    const add = open ? (
                      <Button type="button" variant="ghost" size="sm" aria-label={`Add an activity on ${formatDate(day, "MMMM d")}`} onClick={() => setItem(newItem(day))}>
                        <Plus className="size-4" /> Add
                      </Button>
                    ) : null;
                    if (of.length === 0)
                      return [
                        <TableRow key={day} className="hover:bg-transparent">
                          {date}
                          <TableCell colSpan={5} className="text-muted-foreground">
                            No activity{dayNote(day) ? ` (${dayNote(day)})` : ""}
                          </TableCell>
                          <TableCell className="text-right">{add}</TableCell>
                        </TableRow>,
                      ];
                    return of.map((i, n) => (
                      <TableRow key={i.id} className="hover:bg-transparent">
                        {n === 0 ? date : null}
                        <TableCell className="min-w-36 align-top font-medium whitespace-normal">{i.activity}</TableCell>
                        <TableCell className="min-w-44 align-top whitespace-normal">{i.purpose || "—"}</TableCell>
                        <TableCell className="min-w-32 align-top whitespace-normal">{i.participants || "—"}</TableCell>
                        <TableCell className="align-top whitespace-nowrap">
                          {durationLabel(i.start, i.end) || "—"}
                          {i.start && i.end ? (
                            <div className="text-theme-xs text-muted-foreground">
                              {formatTime12(i.start)} to {formatTime12(i.end)}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell className="min-w-32 align-top whitespace-normal">{i.materials || "—"}</TableCell>
                        <TableCell className="align-top">
                          {open ? (
                            <div className="flex justify-end gap-1">
                              <Button type="button" variant="ghost" size="icon" aria-label={`Edit ${i.activity} on ${formatDate(day, "MMMM d")}`} onClick={() => setItem({ id: i.id, onDate: i.onDate, activity: i.activity, purpose: i.purpose, participants: i.participants, materials: i.materials, start: i.start, end: i.end })}>
                                <Pencil className="size-4" />
                              </Button>
                              <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${i.activity} on ${formatDate(day, "MMMM d")}`} disabled={busy} onClick={() => run(book.removeItem(i.id), "Activity removed.")}>
                                <Trash2 className="size-4" />
                              </Button>
                              {n === of.length - 1 ? add : null}
                            </div>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ));
                  })}
                </TableBody>
              </Table>
            </div>
            {canEdit ? (
              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border p-4">
                {open ? (
                  <Button type="button" disabled={busy || items.length === 0} onClick={() => run(book.setStatus(plan.id, "submitted", { on: todayIso() }), "Marked as sent to NCH.")}>
                    Mark as sent to NCH
                  </Button>
                ) : null}
                {plan.status === "submitted" ? (
                  <>
                    <Button type="button" variant="outline" disabled={busy} onClick={() => setAsk("return")}>
                      NCH returned it
                    </Button>
                    <Button type="button" disabled={busy} onClick={() => setAsk("approve")}>
                      NCH approved it
                    </Button>
                  </>
                ) : null}
                {plan.status === "approved" || plan.status === "submitted" ? (
                  <Button type="button" variant="outline" disabled={busy} onClick={() => setAsk("reopen")}>
                    Reopen to change
                  </Button>
                ) : null}
              </div>
            ) : null}
          </SectionCard>

          <SectionCard title="Notes" description="Printed on the plan, under the list of days. What NCH asked to change when it returned a plan is kept here too.">
            <Textarea rows={3} maxLength={2000} disabled={!canEdit} value={noteText} onChange={(e) => setNotes({ planId: plan.id, text: e.target.value })} aria-label="Notes on the plan" />
            {canEdit && noteText !== plan.notes ? (
              <Button type="button" className="mt-3" disabled={busy} onClick={() => run(book.saveNotes(plan.id, noteText), "Notes saved.", () => setNotes(null))}>
                Save the notes
              </Button>
            ) : null}
          </SectionCard>
        </>
      )}

      <Dialog open={!!item} onOpenChange={(o) => !o && setItem(null)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{item?.id ? "Edit the activity" : "Add an activity"}</DialogTitle>
            <DialogDescription>As NCH will read it on the plan, and as a group will see it on the booking page for that day.</DialogDescription>
          </DialogHeader>
          {item ? (
            <div className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-[11rem_1fr]">
                <Field>
                  <FieldLabel htmlFor="pi-day">Day</FieldLabel>
                  <Input id="pi-day" type="date" min={`${month}-01`} max={lastDayOf(month)} value={item.onDate} onChange={(e) => setItem({ ...item, onDate: e.target.value })} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="pi-activity">Activity</FieldLabel>
                  <Input id="pi-activity" list="pi-activities" value={item.activity} maxLength={80} onChange={(e) => setItem({ ...item, activity: e.target.value })} />
                  <datalist id="pi-activities">
                    {activityTypes.filter((a) => a.active).map((a) => (
                      <option key={a.id} value={a.name} />
                    ))}
                  </datalist>
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="pi-purpose">Goal</FieldLabel>
                <Input id="pi-purpose" value={item.purpose} maxLength={300} placeholder="What the children or carers take from it" onChange={(e) => setItem({ ...item, purpose: e.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="pi-participants">Participants</FieldLabel>
                <Input id="pi-participants" value={item.participants} maxLength={200} placeholder="Patients and carers" onChange={(e) => setItem({ ...item, participants: e.target.value })} />
              </Field>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Field>
                  <FieldLabel htmlFor="pi-start">Start time</FieldLabel>
                  <Input id="pi-start" type="time" step={300} value={item.start} onChange={(e) => setItem({ ...item, start: e.target.value })} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="pi-end">End time</FieldLabel>
                  <Input id="pi-end" type="time" step={300} value={item.end} onChange={(e) => setItem({ ...item, end: e.target.value })} />
                </Field>
                <Field className="col-span-2 sm:col-span-1">
                  <FieldLabel>Duration</FieldLabel>
                  <p className="flex h-10 items-center text-theme-sm text-foreground">{durationLabel(item.start, item.end) || "—"}</p>
                </Field>
              </div>
              {timeProblem ? <p className="text-theme-sm text-destructive">{timeProblem}</p> : <FieldDescription>The duration is worked out from the two times.</FieldDescription>}
              <Field>
                <FieldLabel htmlFor="pi-materials">Materials needed</FieldLabel>
                <Textarea id="pi-materials" rows={2} value={item.materials} maxLength={500} onChange={(e) => setItem({ ...item, materials: e.target.value })} />
              </Field>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setItem(null)}>
              Back
            </Button>
            <Button
              type="button"
              disabled={busy || !item || !plan || item.activity.trim().length < 2 || !item.onDate || !!timeProblem}
              onClick={() => {
                if (!item || !plan) return;
                const { id, ...rest } = item;
                void run(id ? book.updateItem(id, rest) : book.addItem(plan.id, rest), id ? "Saved." : `Added on ${formatDate(rest.onDate, "MMMM d")}.`, () => setItem(null));
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={ask === "approve"} onOpenChange={(o) => !o && setAsk(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>NCH approved the plan</DialogTitle>
            <DialogDescription>As written on the signed copy. From now on each day&apos;s activities are offered first on the booking page for {monthName(month)}.</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="ap-by">Approved by (at NCH)</FieldLabel>
            <Input id="ap-by" value={approval.by} maxLength={120} onChange={(e) => setApproval({ ...approval, by: e.target.value })} />
          </Field>
          <Field>
            <FieldLabel htmlFor="ap-on">Date of approval</FieldLabel>
            <Input id="ap-on" type="date" max={todayIso()} value={approval.on} onChange={(e) => setApproval({ ...approval, on: e.target.value })} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAsk(null)}>
              Back
            </Button>
            <Button type="button" disabled={busy || !plan || approval.by.trim().length < 2 || !approval.on} onClick={() => plan && run(book.setStatus(plan.id, "approved", { on: approval.on, approvedBy: approval.by }), "The plan is approved.", () => setAsk(null))}>
              Record the approval
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReasonDialog
        open={ask === "return"}
        onOpenChange={(o) => !o && setAsk(null)}
        title="NCH returned the plan?"
        description="Write what NCH asked to change. It is added to the plan's notes, and the activities can be changed again."
        confirmLabel="Mark as returned"
        requireReason
        minLength={5}
        onConfirm={(reason) => {
          if (!plan) return;
          void run(
            book.setStatus(plan.id, "returned").then((r) => (r.ok ? book.saveNotes(plan.id, [plan.notes, `Returned by NCH (${formatDate(todayIso())}): ${reason}`].filter(Boolean).join("\n")) : r)),
            "Marked as returned. Change the activities and send it again.",
            () => setAsk(null),
          );
        }}
      />
      <ReasonDialog
        open={ask === "reopen"}
        onOpenChange={(o) => !o && setAsk(null)}
        title="Reopen the plan to change it?"
        description={plan?.status === "approved" ? "Its approval is taken away: the activities stop being offered on the booking page until NCH approves the changed plan." : "It goes back to a draft, and is sent to NCH again when ready."}
        confirmLabel="Reopen"
        destructive={plan?.status === "approved"}
        onConfirm={() => plan && run(book.setStatus(plan.id, "draft"), "Reopened as a draft.", () => setAsk(null))}
      />
    </div>
  );
}
