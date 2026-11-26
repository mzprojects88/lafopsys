"use client";

import * as React from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { LoadingState } from "@/components/patterns/loading-state";
import { PageHeader } from "@/components/patterns/page-header";
import { SectionCard } from "@/components/patterns/section-card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useBookingSetup, type MutationResult } from "@/lib/hooks/use-bookings-collection";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import type { BookingPlace, BookingSettings } from "@/lib/types/booking";
import { WEEKDAYS, minutesOf } from "@/lib/utils/booking";
import { formatDate, todayIso } from "@/lib/utils/date";
import { formatTime12 } from "@/lib/utils/time12";

type PlaceForm = Omit<BookingPlace, "id" | "sort"> & { id: string | null };
const NEW_PLACE: PlaceForm = { id: null, name: "", site: "NCH", whereToGo: "", instructions: "", coordinatorName: "", coordinatorPhone: "", open: true };
const LIMITS: { key: keyof BookingSettings; label: string; note: string; min: number; max: number }[] = [
  { key: "minDaysAhead", label: "Earliest day a group can book", note: "Days ahead of today.", min: 1, max: 60 },
  { key: "maxDaysAhead", label: "Latest day a group can book", note: "Days ahead of today.", min: 7, max: 365 },
  { key: "maxVolunteers", label: "Most volunteers in a group", note: "Per booking.", min: 1, max: 50 },
  { key: "maxOpenRequests", label: "Open requests per email address", note: "Pending or approved, not yet held.", min: 1, max: 10 },
  { key: "namesDueDays", label: "Confirm, change the date and the names by", note: "Days before the visit: staff confirm a request by then; a group changes its date or names until then.", min: 1, max: 14 },
  { key: "maxDateChanges", label: "Changes of date per booking", note: "How many times a group may change its own date.", min: 0, max: 5 },
  { key: "replyDays", label: "We answer a request within", note: "Working days. Shown to the group.", min: 1, max: 14 },
  { key: "attendanceDays", label: "Groups may confirm who came for", note: "Days after the visit, in the Volunteers Portal.", min: 0, max: 30 },
];

/**
 * LAF Activity Center Bookings › Settings (0172): the places groups can book and what an approved group is told,
 * the weekly slots of each place, closed dates, how far ahead a booking may be, the activity list, and the texts of
 * the booking page. Every figure and text the booking page shows comes from here.
 */
export default function BookingSettingsPage() {
  const access = useModuleAccess();
  const canEdit = access.levelOfPath("/bookings/settings") === "edit";
  const setup = useBookingSetup();
  const { settings, places, slots, closures, activityTypes, loading } = setup;
  const [limits, setLimits] = React.useState<Partial<Record<keyof BookingSettings, string>>>({});
  const [texts, setTexts] = React.useState<Partial<Pick<BookingSettings, "guidelines" | "prohibited" | "privacyNotice">>>({});
  const [siteUrl, setSiteUrl] = React.useState<string | null>(null);
  const [alertEmails, setAlertEmails] = React.useState<string | null>(null);
  const [place, setPlace] = React.useState<PlaceForm | null>(null);
  const [slot, setSlot] = React.useState({ placeId: "", weekday: "1", start: "10:00", end: "12:00" });
  const [closure, setClosure] = React.useState({ placeId: "all", dateFrom: "", dateTo: "", reason: "" });
  const [activity, setActivity] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  if (loading) return <LoadingState />;

  async function run(what: Promise<MutationResult>, done: string, after?: () => void) {
    setBusy(true);
    const r = await what;
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success(done);
    after?.();
  }

  const typed = Object.entries(limits) as [keyof BookingSettings, string][];
  const limitValues = Object.fromEntries(typed.map(([k, v]) => [k, Number(v)])) as Partial<BookingSettings>;
  const merged = { ...settings, ...limitValues };
  const limitError =
    typed.map(([k, v]) => {
      const def = LIMITS.find((l) => l.key === k);
      return def && (!/^\d{1,3}$/.test(v) || Number(v) < def.min || Number(v) > def.max) ? `${def.label}: ${def.min} to ${def.max}.` : "";
    }).find(Boolean) ?? (merged.maxDaysAhead <= merged.minDaysAhead ? "The latest day must be later than the earliest day." : "");
  const slotPlace = slot.placeId || places[0]?.id || "";
  const slotOk = minutesOf(slot.end) > minutesOf(slot.start);
  const textValue = (k: "guidelines" | "prohibited" | "privacyNotice") => texts[k] ?? settings[k];
  const siteOk = siteUrl === null || /^https?:\/\/[a-z0-9.:-]+$/.test(siteUrl.trim().replace(/\/+$/, ""));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Booking settings" description="What the public booking page offers and says. Changes show there at once." />

      <SectionCard title="Places" description="Where a group can book. The instructions and the coordinator are shown to a group only once its booking is approved." actions={canEdit ? <Button type="button" size="sm" onClick={() => setPlace(NEW_PLACE)}><Plus className="size-4" /> Add a place</Button> : null} flush>
        <div className="overflow-x-auto border-t border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Place</TableHead>
                <TableHead>Coordinator</TableHead>
                <TableHead>Weekly slots</TableHead>
                <TableHead>Open for booking</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {places.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="min-w-56 whitespace-normal">
                    {p.name}
                    <div className="text-theme-xs text-muted-foreground">{p.whereToGo || "No address yet"}</div>
                  </TableCell>
                  <TableCell className="min-w-40 whitespace-normal">
                    {p.coordinatorName || <span className="text-warning-foreground dark:text-warning">Not set yet</span>}
                    <div className="text-theme-xs text-muted-foreground">{p.coordinatorPhone}</div>
                  </TableCell>
                  <TableCell className="tabular-nums">{slots.filter((s) => s.placeId === p.id && s.active).length}</TableCell>
                  <TableCell>
                    <Switch checked={p.open} disabled={!canEdit || busy} aria-label={`${p.name}: open for booking`} onCheckedChange={(open) => run(setup.updatePlace(p.id, { open }), open ? "Open for booking." : "Closed for booking. Bookings already made stay.")} />
                  </TableCell>
                  <TableCell>
                    {canEdit ? (
                      <Button type="button" variant="ghost" size="icon" aria-label={`Edit ${p.name}`} onClick={() => setPlace({ ...p })}>
                        <Pencil className="size-4" />
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </SectionCard>

      <SectionCard title="Weekly slots" description="The days and times a group can book. One group per slot. A slot switched off takes no new request; bookings already made stay." flush>
        <div className="overflow-x-auto border-t border-border">
          <Table>
            <TableHeader>
              <TableRow>
                {places.length > 1 ? <TableHead>Place</TableHead> : null}
                <TableHead>Day</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Offered</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {slots.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    No slot yet, so nothing can be booked.
                  </TableCell>
                </TableRow>
              ) : (
                slots.map((s) => (
                  <TableRow key={s.id}>
                    {places.length > 1 ? <TableCell className="min-w-48 whitespace-normal">{places.find((p) => p.id === s.placeId)?.name}</TableCell> : null}
                    <TableCell>{WEEKDAYS[s.weekday]}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatTime12(s.start)} to {formatTime12(s.end)}
                    </TableCell>
                    <TableCell>
                      <Switch checked={s.active} disabled={!canEdit || busy} aria-label={`${WEEKDAYS[s.weekday]} ${formatTime12(s.start)}: offered`} onCheckedChange={(active) => run(setup.updateSlot(s.id, { active }), active ? "Offered again." : "No longer offered.")} />
                    </TableCell>
                    <TableCell>
                      {canEdit ? (
                        <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${WEEKDAYS[s.weekday]} ${formatTime12(s.start)}`} disabled={busy} onClick={() => run(setup.removeSlot(s.id), "Slot removed.")}>
                          <Trash2 className="size-4" />
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap items-end gap-3 border-t border-border p-4">
            {places.length > 1 ? (
              <Field className="w-64">
                <FieldLabel>Place</FieldLabel>
                <Select value={slotPlace} onValueChange={(placeId) => setSlot({ ...slot, placeId })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{places.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
            ) : null}
            <Field className="w-40">
              <FieldLabel>Day</FieldLabel>
              <Select value={slot.weekday} onValueChange={(weekday) => setSlot({ ...slot, weekday })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{WEEKDAYS.map((d, i) => <SelectItem key={d} value={String(i)}>{d}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field className="w-32">
              <FieldLabel htmlFor="slot-start">From</FieldLabel>
              <Input id="slot-start" type="time" value={slot.start} onChange={(e) => setSlot({ ...slot, start: e.target.value })} />
            </Field>
            <Field className="w-32">
              <FieldLabel htmlFor="slot-end">To</FieldLabel>
              <Input id="slot-end" type="time" value={slot.end} onChange={(e) => setSlot({ ...slot, end: e.target.value })} />
            </Field>
            <Button type="button" disabled={busy || !slotPlace || !slotOk} onClick={() => run(setup.addSlot(slotPlace, Number(slot.weekday), slot.start, slot.end), "Slot added.")}>
              <Plus className="size-4" /> Add a slot
            </Button>
            {!slotOk ? <p className="w-full text-theme-xs text-destructive">The end time must be after the start time.</p> : null}
          </div>
        ) : null}
      </SectionCard>

      <SectionCard title="Closed dates" description="Days nobody can book: a hospital event, a ward closure, staff away. Holidays on the Calendar close their slots by themselves." flush>
        <div className="overflow-x-auto border-t border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead>Place</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {closures.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    No closed date.
                  </TableCell>
                </TableRow>
              ) : (
                closures.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="whitespace-nowrap">{formatDate(c.dateFrom)}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatDate(c.dateTo)}</TableCell>
                    <TableCell className="min-w-40 whitespace-normal">{c.placeId ? places.find((p) => p.id === c.placeId)?.name : "Every place"}</TableCell>
                    <TableCell className="min-w-48 whitespace-normal">{c.reason || "—"}</TableCell>
                    <TableCell>
                      {canEdit ? (
                        <Button type="button" variant="ghost" size="icon" aria-label={`Remove the closed date of ${formatDate(c.dateFrom)}`} disabled={busy} onClick={() => run(setup.removeClosure(c.id), "Closed date removed.")}>
                          <Trash2 className="size-4" />
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap items-end gap-3 border-t border-border p-4">
            <Field className="w-40">
              <FieldLabel htmlFor="c-from">From</FieldLabel>
              <Input id="c-from" type="date" min={todayIso()} value={closure.dateFrom} onChange={(e) => setClosure({ ...closure, dateFrom: e.target.value, dateTo: closure.dateTo && closure.dateTo >= e.target.value ? closure.dateTo : e.target.value })} />
            </Field>
            <Field className="w-40">
              <FieldLabel htmlFor="c-to">To</FieldLabel>
              <Input id="c-to" type="date" min={closure.dateFrom || todayIso()} value={closure.dateTo} onChange={(e) => setClosure({ ...closure, dateTo: e.target.value })} />
            </Field>
            {places.length > 1 ? (
              <Field className="w-56">
                <FieldLabel>Place</FieldLabel>
                <Select value={closure.placeId} onValueChange={(placeId) => setClosure({ ...closure, placeId })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Every place</SelectItem>
                    {places.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            ) : null}
            <Field className="min-w-48 flex-1">
              <FieldLabel htmlFor="c-reason">Reason</FieldLabel>
              <Input id="c-reason" value={closure.reason} maxLength={200} onChange={(e) => setClosure({ ...closure, reason: e.target.value })} />
            </Field>
            <Button
              type="button"
              disabled={busy || !closure.dateFrom || !closure.dateTo || closure.dateTo < closure.dateFrom}
              onClick={() => run(setup.addClosure({ placeId: closure.placeId === "all" ? null : closure.placeId, dateFrom: closure.dateFrom, dateTo: closure.dateTo, reason: closure.reason }), "Closed date added.", () => setClosure({ placeId: "all", dateFrom: "", dateTo: "", reason: "" }))}
            >
              <Plus className="size-4" /> Add
            </Button>
          </div>
        ) : null}
      </SectionCard>

      <SectionCard title="Booking window and limits" description="How far ahead a group may book, and how big a group may be.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {LIMITS.map((l) => (
            <Field key={l.key}>
              <FieldLabel htmlFor={`limit-${l.key}`}>{l.label}</FieldLabel>
              <Input id={`limit-${l.key}`} inputMode="numeric" disabled={!canEdit} value={limits[l.key] ?? String(settings[l.key])} onChange={(e) => setLimits({ ...limits, [l.key]: e.target.value.replace(/\D/g, "").slice(0, 3) })} />
              <FieldDescription>{l.note}</FieldDescription>
            </Field>
          ))}
        </div>
        {limitError ? <p className="mt-3 text-theme-sm text-destructive">{limitError}</p> : null}
        {canEdit && typed.length ? (
          <Button type="button" className="mt-4" disabled={busy || !!limitError} onClick={() => run(setup.saveSettings(limitValues), "Saved.", () => setLimits({}))}>
            Save
          </Button>
        ) : null}
      </SectionCard>

      <SectionCard title="Activity list" description="What a group can choose from when its activity is not in the month's NCH-approved plan. A group may also suggest its own; either way the social worker coordinates with NCH before approving.">
        <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
          {activityTypes.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-1">
              <span className={`text-theme-sm ${a.active ? "text-foreground" : "text-muted-foreground line-through"}`}>{a.name}</span>
              <Switch checked={a.active} disabled={!canEdit || busy} aria-label={`${a.name}: offered`} onCheckedChange={(active) => run(setup.updateActivityType(a.id, { active }), active ? "Offered again." : "No longer offered.")} />
            </li>
          ))}
        </ul>
        {canEdit ? (
          <form
            className="mt-4 flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(setup.addActivityType(activity), "Activity added.", () => setActivity(""));
            }}
          >
            <Field className="w-full sm:w-72">
              <FieldLabel htmlFor="activity">Add an activity</FieldLabel>
              <Input id="activity" value={activity} maxLength={60} onChange={(e) => setActivity(e.target.value)} />
            </Field>
            <Button type="submit" disabled={busy || activity.trim().length < 2}>
              <Plus className="size-4" /> Add
            </Button>
          </form>
        ) : null}
      </SectionCard>

      <SectionCard title="Booking alerts by email" description="For the staff who answer bookings. The bell and the hourly reminder in ArkOS always show what waits; these emails are extra.">
        <div className="flex flex-col gap-4">
          <Field className="w-full sm:max-w-xl">
            <FieldLabel htmlFor="alert-emails">Send them to</FieldLabel>
            <Input id="alert-emails" inputMode="email" maxLength={600} disabled={!canEdit} placeholder="socialworker@littlearkfoundation.org, officeadmin@littlearkfoundation.org" value={alertEmails ?? settings.alertEmails} onChange={(e) => setAlertEmails(e.target.value)} />
            <FieldDescription>Up to 10 addresses, separated by commas.</FieldDescription>
          </Field>
          {canEdit && alertEmails !== null ? (
            <Button type="button" className="self-start" disabled={busy} onClick={() => run(setup.saveSettings({ alertEmails: alertEmails.trim() }), "Saved.", () => setAlertEmails(null))}>
              Save the addresses
            </Button>
          ) : null}
          <label className="flex items-center gap-3 text-theme-sm text-foreground">
            <Switch checked={settings.alertNewRequest} disabled={!canEdit || busy} onCheckedChange={(on) => run(setup.saveSettings({ alertNewRequest: on }), on ? "On." : "Off.")} />
            An email for each new request from the booking page
          </label>
          <label className="flex items-center gap-3 text-theme-sm text-foreground">
            <Switch checked={settings.alertMorning} disabled={!canEdit || busy} onCheckedChange={(on) => run(setup.saveSettings({ alertMorning: on }), on ? "On." : "Off.")} />
            A morning summary at 8:00 AM of every request that waits
          </label>
        </div>
      </SectionCard>

      <SectionCard title="Address of the booking page" description="Where the public booking page is served. The emails to a group link to it, so a wrong address here means links that do not open.">
        <div className="flex flex-wrap items-end gap-3">
          <Field className="w-full sm:w-96">
            <FieldLabel htmlFor="site-url">Address</FieldLabel>
            <Input id="site-url" inputMode="url" maxLength={120} disabled={!canEdit} value={siteUrl ?? settings.siteUrl} onChange={(e) => setSiteUrl(e.target.value)} />
          </Field>
          {canEdit && siteUrl !== null ? (
            <Button type="button" disabled={busy || !siteOk} onClick={() => run(setup.saveSettings({ siteUrl }), "Saved.", () => setSiteUrl(null))}>
              Save
            </Button>
          ) : null}
        </div>
        {!siteOk ? <p className="mt-2 text-theme-sm text-destructive">Give the address like https://book.littlearkfoundation.org, with nothing after it.</p> : null}
        {settings.siteUrl ? (
          <p className="mt-3 text-theme-sm text-muted-foreground">
            The booking page: <a className="text-primary underline-offset-4 hover:underline" href={`${settings.siteUrl}/book`} target="_blank" rel="noreferrer noopener">{settings.siteUrl}/book</a>
          </p>
        ) : null}
      </SectionCard>

      <SectionCard title="Texts of the booking page" description="A group reads these, and ticks that it agrees, before it files a request.">
        <div className="flex flex-col gap-4">
          {(
            [
              ["guidelines", "Guidelines for volunteers", 8, 6000],
              ["prohibited", "What is not allowed", 4, 1000],
              ["privacyNotice", "Privacy notice", 5, 4000],
            ] as const
          ).map(([key, label, rows, max]) => (
            <Field key={key}>
              <FieldLabel htmlFor={`text-${key}`}>{label}</FieldLabel>
              <Textarea id={`text-${key}`} rows={rows} disabled={!canEdit} value={textValue(key)} maxLength={max} onChange={(e) => setTexts({ ...texts, [key]: e.target.value })} />
            </Field>
          ))}
        </div>
        {canEdit && Object.keys(texts).length ? (
          <Button type="button" className="mt-4" disabled={busy || Object.values(texts).some((t) => (t ?? "").trim().length < 20)} onClick={() => run(setup.saveSettings(texts), "Saved.", () => setTexts({}))}>
            Save the texts
          </Button>
        ) : null}
      </SectionCard>

      <Dialog open={!!place} onOpenChange={(o) => !o && setPlace(null)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{place?.id ? "Edit the place" : "Add a place"}</DialogTitle>
            <DialogDescription>The name and address show on the booking page. The rest is shown only to a group whose booking is approved.</DialogDescription>
          </DialogHeader>
          {place ? (
            <div className="flex flex-col gap-4">
              <Field>
                <FieldLabel htmlFor="p-name">Name</FieldLabel>
                <Input id="p-name" value={place.name} maxLength={80} onChange={(e) => setPlace({ ...place, name: e.target.value })} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
                <Field>
                  <FieldLabel>Site</FieldLabel>
                  <Select value={place.site} onValueChange={(site) => setPlace({ ...place, site: site as "NCH" | "LAF" })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NCH">At NCH</SelectItem>
                      <SelectItem value="LAF">At the LAF House</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="p-where">Address</FieldLabel>
                  <Input id="p-where" value={place.whereToGo} maxLength={300} onChange={(e) => setPlace({ ...place, whereToGo: e.target.value })} />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="p-instructions">Instructions for an approved group</FieldLabel>
                <Textarea id="p-instructions" rows={5} value={place.instructions} maxLength={3000} onChange={(e) => setPlace({ ...place, instructions: e.target.value })} />
                <FieldDescription>The gate to use, the logbook, the gate pass, what to bring, where to wait.</FieldDescription>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="p-coordinator">Who to coordinate with</FieldLabel>
                  <Input id="p-coordinator" value={place.coordinatorName} maxLength={120} onChange={(e) => setPlace({ ...place, coordinatorName: e.target.value })} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="p-phone">Their contact number</FieldLabel>
                  <Input id="p-phone" value={place.coordinatorPhone} maxLength={40} onChange={(e) => setPlace({ ...place, coordinatorPhone: e.target.value })} />
                </Field>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPlace(null)}>
              Back
            </Button>
            <Button
              type="button"
              disabled={busy || !place || place.name.trim().length < 2}
              onClick={() => {
                if (!place) return;
                const { id, ...rest } = place;
                void run(id ? setup.updatePlace(id, rest) : setup.addPlace(rest), id ? "Saved." : "Place added. Add its weekly slots next.", () => setPlace(null));
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
