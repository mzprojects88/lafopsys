"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useBookingPlans } from "@/lib/hooks/use-booking-plans";
import { bookingRequestsStore, fetchSlotStates, useBookingSetup } from "@/lib/hooks/use-bookings-collection";
import type { SlotOfDay } from "@/lib/types/booking";
import { REQUESTOR_KINDS, SLOT_STATE_LABEL, durationLabel, flowProblems } from "@/lib/utils/booking";
import { formatDate, todayIso } from "@/lib/utils/date";
import { formatTime12 } from "@/lib/utils/time12";

/** One activity of the program flow, as typed. `choice` is "plan:<id>", "list:<name>" or "other" (suggested). */
interface Row {
  key: number;
  choice: string;
  custom: string;
  purpose: string;
  who: "patients" | "carers" | "both";
  ages: string;
  gender: "all" | "girls" | "boys";
  start: string;
  end: string;
  materials: string;
}
const row = (key: number, start: string, end: string): Row => ({ key, choice: "", custom: "", purpose: "", who: "patients", ages: "", gender: "all", start, end, materials: "" });
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
/** Staff may take a day the public page calls too soon or too far, never a taken, closed or past one. */
const TAKEABLE = new Set(["open", "too_soon", "too_far"]);

/**
 * A booking filed by staff for someone who phoned or walked in (0180). The same details and program flow as the
 * public page asks for; the email address is optional, and a day inside the 14 days may be taken. The database
 * applies the rules (booking.staff_request). The request starts as "pending approval", so the page opens it
 * right after for the approval step. The page gives the dialog a fresh key each time it opens.
 */
export function AddBookingDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (id: string) => void }) {
  const { places, activityTypes, settings } = useBookingSetup();
  const { plans, items: planRows } = useBookingPlans();
  const [channel, setChannel] = React.useState<"phone" | "walk_in">("phone");
  const [chosenPlace, setChosenPlace] = React.useState<string | null>(null);
  const [date, setDate] = React.useState("");
  const [start, setStart] = React.useState("");
  const [who, setWho] = React.useState({ requestorName: "", requestorKind: "organization", contactPerson: "", email: "", mobile: "", volunteers: "", hasMinors: false });
  const [rows, setRows] = React.useState<Row[]>([row(1, "", "")]);
  const [told, setTold] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [problems, setProblems] = React.useState<string[]>([]);
  const nextKey = React.useRef(2);
  // The chosen day's slots, kept with what they were read for.
  const [read, setRead] = React.useState<{ key: string; slots: SlotOfDay[] } | null>(null);
  const placeId = chosenPlace ?? places.find((p) => p.open)?.id ?? "";
  const readKey = `${placeId}|${date}`;

  React.useEffect(() => {
    let live = true;
    if (placeId && date) void fetchSlotStates(placeId, date, date).then((slots) => live && setRead({ key: readKey, slots }), () => live && setRead({ key: readKey, slots: [] }));
    return () => {
      live = false;
    };
  }, [placeId, date, readKey]);

  const slots = read?.key === readKey ? read.slots : null;
  const slot = slots?.find((s) => s.start === start && TAKEABLE.has(s.state)) ?? null;
  const plan = plans.find((p) => p.placeId === placeId && p.status === "approved" && p.month === date.slice(0, 7));
  const planItems = plan ? planRows.filter((i) => i.planId === plan.id && i.onDate === date) : [];
  const nameOf = (r: Row) => (r.choice.startsWith("plan:") ? (planItems.find((i) => `plan:${i.id}` === r.choice)?.activity ?? "") : r.choice.startsWith("list:") ? r.choice.slice(5) : r.custom.trim());
  const patch = (key: number, change: Partial<Row>) => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...change } : r)));

  function chooseSlot(s: SlotOfDay) {
    setStart(s.start);
    // A program not yet started takes the whole slot.
    setRows((all) => (all.length === 1 && !all[0].choice ? [{ ...all[0], start: s.start, end: s.end }] : all));
  }
  function pickActivity(r: Row, choice: string) {
    const item = planItems.find((i) => `plan:${i.id}` === choice);
    patch(r.key, { choice, ...(item ? { purpose: r.purpose || item.purpose, materials: r.materials || item.materials, ...(item.start && item.end ? { start: item.start, end: item.end } : {}) } : {}) });
  }

  function check(): string[] {
    const out: string[] = [];
    if (!slot) out.push("Choose a day and a free time slot.");
    if (who.requestorName.trim().length < 2) out.push("Give the requestor's name, or the name of the group.");
    if (who.contactPerson.trim().length < 2) out.push("Give the name of a contact person.");
    if (who.email.trim() && !EMAIL.test(who.email.trim())) out.push("The email address does not look right. Leave it empty if the person has none.");
    if (who.mobile.replace(/\D/g, "").length < 7) out.push("Give a contact number.");
    const n = Number(who.volunteers);
    if (!/^\d{1,3}$/.test(who.volunteers) || n < 1 || n > settings.maxVolunteers) out.push(`A group is 1 to ${settings.maxVolunteers} volunteers.`);
    if (slot) out.push(...flowProblems(rows.map((r) => ({ activity: nameOf(r), start: r.start, end: r.end })), slot.start, slot.end));
    if (!told) out.push("Tick that you went through the guidelines and the privacy notice with the requestor.");
    return out;
  }

  async function save() {
    const found = check();
    setProblems(found);
    if (found.length || !slot) return;
    setBusy(true);
    const res = await fetch("/api/bookings/add", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        channel,
        place_id: placeId,
        date: slot.day,
        start_time: slot.start,
        requestor_name: who.requestorName.trim(),
        requestor_kind: who.requestorKind,
        contact_person: who.contactPerson.trim(),
        email: who.email.trim(),
        mobile: who.mobile.trim(),
        volunteers_count: Number(who.volunteers),
        has_minors: who.hasMinors,
        agree_guidelines: told,
        agree_privacy: told,
        items: rows.map((r) => ({
          source: r.choice.startsWith("plan:") ? "plan" : r.choice.startsWith("list:") ? "list" : "suggested",
          plan_item_id: r.choice.startsWith("plan:") ? r.choice.slice(5) : "",
          activity: nameOf(r),
          purpose: r.purpose.trim(),
          who: r.who,
          ages: r.ages.trim(),
          gender: r.gender,
          start_time: r.start,
          end_time: r.end,
          materials: r.materials.trim(),
        })),
      }),
    }).catch(() => null);
    const out = (await res?.json().catch(() => null)) as { ok?: boolean; error?: string; id?: string; ref?: string } | null;
    setBusy(false);
    if (!res?.ok || !out?.ok || !out.id) return void setProblems([out?.error ?? "The booking was not saved. Check your connection and try again."]);
    await bookingRequestsStore.refetch();
    toast.success(`Filed. Request ID ${out.ref}: give it to the requestor. It now waits for approval.`);
    onAdded(out.id);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add a booking</DialogTitle>
          <DialogDescription>For someone who phoned or walked in. It is filed as pending approval, and you get the Request ID to give them.</DialogDescription>
        </DialogHeader>

        <div className="grid min-w-0 gap-4 sm:grid-cols-3">
          <Field>
            <FieldLabel>How it came</FieldLabel>
            <Select value={channel} onValueChange={(v) => setChannel(v as "phone" | "walk_in")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="phone">By phone</SelectItem>
                <SelectItem value="walk_in">Walk-in</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {places.filter((p) => p.open).length > 1 ? (
            <Field>
              <FieldLabel>Place</FieldLabel>
              <Select
                value={placeId}
                onValueChange={(v) => {
                  setChosenPlace(v);
                  setStart("");
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {places.filter((p) => p.open).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
          <Field>
            <FieldLabel htmlFor="ab-date">Day</FieldLabel>
            <Input
              id="ab-date"
              type="date"
              min={todayIso()}
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setStart("");
              }}
            />
          </Field>
        </div>

        {date ? (
          <div className="min-w-0">
            <p className="text-theme-sm font-medium text-foreground">Time slot on {formatDate(date, "EEEE, MMM d, yyyy")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {slots === null ? <span className="text-theme-sm text-muted-foreground">Reading the day…</span> : null}
              {slots?.length === 0 ? <span className="text-theme-sm text-muted-foreground">No slot is offered on this day.</span> : null}
              {slots?.map((s) =>
                TAKEABLE.has(s.state) ? (
                  <Button key={s.start} type="button" size="sm" variant={start === s.start ? "default" : "outline"} aria-pressed={start === s.start} onClick={() => chooseSlot(s)}>
                    {formatTime12(s.start)} to {formatTime12(s.end)}
                    {s.state !== "open" ? ` · ${SLOT_STATE_LABEL[s.state].toLowerCase()} for the public page` : ""}
                  </Button>
                ) : (
                  <span key={s.start} className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-theme-sm text-muted-foreground">
                    {formatTime12(s.start)} to {formatTime12(s.end)} · {SLOT_STATE_LABEL[s.state]}
                  </span>
                ),
              )}
            </div>
          </div>
        ) : null}

        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="ab-name">Name of requestor</FieldLabel>
            <Input id="ab-name" value={who.requestorName} maxLength={120} onChange={(e) => setWho({ ...who, requestorName: e.target.value })} />
          </Field>
          <Field>
            <FieldLabel>They are</FieldLabel>
            <Select value={who.requestorKind} onValueChange={(v) => setWho({ ...who, requestorKind: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REQUESTOR_KINDS.map((k) => (
                  <SelectItem key={k.key} value={k.key}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="ab-contact">Contact person</FieldLabel>
            <Input id="ab-contact" value={who.contactPerson} maxLength={120} onChange={(e) => setWho({ ...who, contactPerson: e.target.value })} />
          </Field>
          <Field>
            <FieldLabel htmlFor="ab-mobile">Contact number</FieldLabel>
            <Input id="ab-mobile" inputMode="tel" value={who.mobile} maxLength={20} onChange={(e) => setWho({ ...who, mobile: e.target.value })} />
          </Field>
          <Field>
            <FieldLabel htmlFor="ab-email">Email (if they have one)</FieldLabel>
            <Input id="ab-email" inputMode="email" value={who.email} maxLength={200} onChange={(e) => setWho({ ...who, email: e.target.value })} />
            <FieldDescription>Without one, no email is sent: they follow the booking with the Request ID.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="ab-volunteers">Number of volunteers</FieldLabel>
            <Input id="ab-volunteers" inputMode="numeric" value={who.volunteers} onChange={(e) => setWho({ ...who, volunteers: e.target.value.replace(/\D/g, "").slice(0, 3) })} />
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-theme-sm text-foreground">
            <Checkbox checked={who.hasMinors} onCheckedChange={(v) => setWho({ ...who, hasMinors: v === true })} />
            Some volunteers are under 18
          </label>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <p className="text-theme-sm font-medium text-foreground">
            Program flow <span className="font-normal text-muted-foreground">· 1 to 3 activities{slot ? `, between ${formatTime12(slot.start)} and ${formatTime12(slot.end)}` : ""}</span>
          </p>
          {rows.map((r, i) => (
            <fieldset key={r.key} className="grid min-w-0 gap-3 rounded-xl border border-border p-3 sm:grid-cols-4">
              <legend className="flex w-full items-center justify-between gap-2 px-1 text-theme-sm font-medium text-foreground">
                <span>
                  Activity {i + 1}
                  {durationLabel(r.start, r.end) ? <span className="ml-2 font-normal text-muted-foreground">{durationLabel(r.start, r.end)}</span> : null}
                </span>
                {rows.length > 1 ? (
                  <Button type="button" variant="ghost" size="icon" aria-label={`Remove activity ${i + 1}`} onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>
                    <Trash2 className="size-4" />
                  </Button>
                ) : null}
              </legend>
              <Field className="sm:col-span-2">
                <FieldLabel>Activity</FieldLabel>
                <Select value={r.choice} onValueChange={(v) => pickActivity(r, v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose an activity" />
                  </SelectTrigger>
                  <SelectContent>
                    {planItems.length ? (
                      <SelectGroup>
                        <SelectLabel>In the NCH-approved plan for this day</SelectLabel>
                        {planItems.map((p) => (
                          <SelectItem key={p.id} value={`plan:${p.id}`}>
                            {p.activity}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ) : null}
                    <SelectGroup>
                      <SelectLabel>From the list (NCH is informed first)</SelectLabel>
                      {activityTypes.filter((a) => a.active).map((a) => (
                        <SelectItem key={a.id} value={`list:${a.name}`}>
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                    <SelectItem value="other">Another activity they suggest</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {r.choice === "other" ? (
                <Field className="sm:col-span-2">
                  <FieldLabel htmlFor={`ab-custom-${r.key}`}>Their suggested activity</FieldLabel>
                  <Input id={`ab-custom-${r.key}`} value={r.custom} maxLength={80} onChange={(e) => patch(r.key, { custom: e.target.value })} />
                </Field>
              ) : (
                <div className="hidden sm:col-span-2 sm:block" />
              )}
              <Field>
                <FieldLabel htmlFor={`ab-start-${r.key}`}>Start</FieldLabel>
                <Input id={`ab-start-${r.key}`} type="time" step={300} value={r.start} onChange={(e) => patch(r.key, { start: e.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor={`ab-end-${r.key}`}>End</FieldLabel>
                <Input id={`ab-end-${r.key}`} type="time" step={300} value={r.end} onChange={(e) => patch(r.key, { end: e.target.value })} />
              </Field>
              <Field>
                <FieldLabel>Participants</FieldLabel>
                <Select value={r.who} onValueChange={(v) => patch(r.key, { who: v as Row["who"] })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="patients">Patients only</SelectItem>
                    <SelectItem value="both">Patients and carers</SelectItem>
                    <SelectItem value="carers">Carers only</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>For</FieldLabel>
                <Select value={r.gender} onValueChange={(v) => patch(r.key, { gender: v as Row["gender"] })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Girls and boys</SelectItem>
                    <SelectItem value="girls">Girls</SelectItem>
                    <SelectItem value="boys">Boys</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor={`ab-ages-${r.key}`}>Ages</FieldLabel>
                <Input id={`ab-ages-${r.key}`} value={r.ages} maxLength={40} placeholder="All, or 4 to 12" onChange={(e) => patch(r.key, { ages: e.target.value })} />
              </Field>
              <Field className="sm:col-span-3">
                <FieldLabel htmlFor={`ab-purpose-${r.key}`}>Purpose</FieldLabel>
                <Input id={`ab-purpose-${r.key}`} value={r.purpose} maxLength={300} onChange={(e) => patch(r.key, { purpose: e.target.value })} />
              </Field>
              <Field className="sm:col-span-4">
                <FieldLabel htmlFor={`ab-materials-${r.key}`}>Materials needed</FieldLabel>
                <Textarea id={`ab-materials-${r.key}`} rows={2} value={r.materials} maxLength={500} onChange={(e) => patch(r.key, { materials: e.target.value })} />
              </Field>
            </fieldset>
          ))}
          {rows.length < 3 ? (
            <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setRows([...rows, row(nextKey.current++, rows[rows.length - 1].end, slot?.end ?? "")])}>
              <Plus className="size-4" /> Add an activity
            </Button>
          ) : null}
        </div>

        <label className="flex min-w-0 items-start gap-2 text-theme-sm text-foreground">
          <Checkbox className="mt-0.5" checked={told} onCheckedChange={(v) => setTold(v === true)} />
          I went through the visit guidelines and the privacy notice with the requestor, and they agree.
        </label>

        {problems.length ? (
          <div role="alert" className="min-w-0 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-theme-sm text-destructive">
            <ul className="list-disc pl-5">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Back
          </Button>
          <Button type="button" disabled={busy} onClick={save}>
            {busy ? "Filing…" : "File the booking"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
