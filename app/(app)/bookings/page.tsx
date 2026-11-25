"use client";

import * as React from "react";
import { CalendarCheck, CalendarClock, ChevronLeft, ChevronRight, ClipboardList, Hourglass, Search, Settings, Users } from "lucide-react";
import { RequestDialog } from "@/components/modules/bookings/request-dialog";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { LoadingState } from "@/components/patterns/loading-state";
import { ModuleSubNav, type ModuleSubNavItem } from "@/components/patterns/module-subnav";
import { PageHeader } from "@/components/patterns/page-header";
import { SectionCard } from "@/components/patterns/section-card";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchSlotStates, useBookingRequests, useBookingSetup } from "@/lib/hooks/use-bookings-collection";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import type { BookingRequest, BookingStatus, SlotOfDay, SlotState } from "@/lib/types/booking";
import { BOOKING_STATUS_LABEL, SLOT_STATE_LABEL, byNeedsAnswer, lastDayOf, monthWeeks, shiftMonth } from "@/lib/utils/booking";
import { formatDate, todayIso } from "@/lib/utils/date";
import { STATUS_TONE_CLASSES } from "@/lib/utils/status-colors";
import { formatTime12 } from "@/lib/utils/time12";

const SUB_NAV: ModuleSubNavItem[] = [
  { href: "/bookings/plan", label: "Activity Plan", icon: ClipboardList },
  { href: "/bookings/settings", label: "Settings", icon: Settings },
];

type Queue = "pending" | "upcoming" | "past" | "closed";
const QUEUES: { key: Queue; label: string; empty: string }[] = [
  { key: "pending", label: "Pending approval", empty: "No request is waiting for an answer." },
  { key: "upcoming", label: "Upcoming", empty: "No approved booking is coming up." },
  { key: "past", label: "Visits", empty: "No visit has been recorded yet." },
  { key: "closed", label: "Declined or cancelled", empty: "No declined or cancelled request." },
];
const queueOf = (r: BookingRequest): Queue => (r.status === "pending" ? "pending" : r.status === "approved" ? "upcoming" : r.status === "completed" || r.status === "no_show" ? "past" : "closed");

/** How a slot reads on the staff calendar: taken slots stand out, slots nobody can book fade. */
const SLOT_CLASS: Record<SlotState, string> = {
  open: "border border-dashed border-border text-muted-foreground",
  pending: STATUS_TONE_CLASSES.warning,
  booked: STATUS_TONE_CLASSES.positive,
  closed: STATUS_TONE_CLASSES.neutral,
  holiday: STATUS_TONE_CLASSES.neutral,
  too_soon: "border border-dashed border-border text-muted-foreground/70",
  too_far: "border border-dashed border-border text-muted-foreground/70",
  past: "text-muted-foreground/60",
};
const HOLDS: BookingStatus[] = ["pending", "approved", "completed", "no_show"];

/**
 * LAF Activity Center Bookings (0172): the requests filed on the public booking page. The calendar shows every slot
 * of the month for a place, as the booking page sees it; the lists hold the requests by what they need. Opening a
 * request shows its program flow and the step that moves it on.
 */
export default function BookingsPage() {
  const access = useModuleAccess();
  const canEdit = access.levelOfPath("/bookings") === "edit";
  const { requests, loading } = useBookingRequests();
  const { places, loading: setupLoading } = useBookingSetup();
  const [view, setView] = React.useState<"calendar" | "list">("calendar");
  const [queue, setQueue] = React.useState<Queue>("pending");
  const [search, setSearch] = React.useState("");
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [month, setMonth] = React.useState(() => todayIso().slice(0, 7));
  const [chosenPlace, setChosenPlace] = React.useState<string | null>(null);
  const [slots, setSlots] = React.useState<SlotOfDay[]>([]);
  const placeId = chosenPlace ?? places[0]?.id ?? null;
  // The slots are read again whenever a request changes (a decision frees or takes a slot).
  const stamp = requests.map((r) => `${r.id}${r.status}${r.date}`).join();

  React.useEffect(() => {
    let live = true;
    if (placeId) void fetchSlotStates(placeId, `${month}-01`, lastDayOf(month)).then((rows) => live && setSlots(rows), () => live && setSlots([]));
    return () => {
      live = false;
    };
  }, [placeId, month, stamp]);

  if (loading || setupLoading) return <LoadingState />;

  const today = todayIso();
  const count = (q: Queue) => requests.filter((r) => queueOf(r) === q).length;
  const term = search.trim().toLowerCase();
  const shown = (term ? requests.filter((r) => [r.requestorName, r.contactPerson, r.email, r.mobile, r.ref, r.seqNo].some((v) => v.toLowerCase().includes(term))) : requests.filter((r) => queueOf(r) === queue))
    .slice()
    .sort(queue === "upcoming" && !term ? (a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`) : byNeedsAnswer);
  const open = requests.find((r) => r.id === openId) ?? null;
  const holder = (s: SlotOfDay) => requests.find((r) => r.placeId === placeId && r.date === s.day && r.start === s.start && HOLDS.includes(r.status));
  const placeName = (id: string) => places.find((p) => p.id === id)?.name ?? "";
  const toRecord = requests.filter((r) => r.status === "approved" && r.date <= today).length;
  const nextUp = requests.filter((r) => r.status === "approved" && r.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="LAF Activity Center Bookings"
        description="Requests from donors and groups to run activities for the children, filed on the public booking page."
        action={<ModuleSubNav items={SUB_NAV} />}
      />

      <KpiGrid>
        <KpiCard label="Pending approval" value={count("pending")} sublabel="Each holds its slot" icon={Hourglass} tone={count("pending") ? "warning" : "default"} />
        <KpiCard label="Upcoming" value={requests.filter((r) => r.status === "approved" && r.date >= today).length} sublabel={nextUp ? `Next: ${formatDate(nextUp.date, "EEE, MMM d")}` : "None approved yet"} icon={CalendarCheck} />
        <KpiCard label="Visits to record" value={toRecord} sublabel="Approved, and the day has come" icon={CalendarClock} tone={toRecord ? "warning" : "default"} />
        <KpiCard label="Visits this year" value={requests.filter((r) => r.status === "completed" && r.date.startsWith(today.slice(0, 4))).length} sublabel="Completed" icon={Users} />
      </KpiGrid>

      <SectionCard flush className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <Tabs value={view} onValueChange={(v) => setView(v as "calendar" | "list")}>
            <TabsList>
              <TabsTrigger value="calendar">Calendar</TabsTrigger>
              <TabsTrigger value="list">
                Requests {count("pending") ? <span className="ml-1 text-muted-foreground">{count("pending")}</span> : null}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {view === "calendar" ? (
            <div className="flex flex-wrap items-center gap-2">
              {places.length > 1 ? (
                <Select value={placeId ?? ""} onValueChange={setChosenPlace}>
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
              <span className="min-w-36 text-center text-theme-sm font-medium text-foreground">{formatDate(`${month}-01`, "MMMM yyyy")}</span>
              <Button type="button" variant="outline" size="icon" aria-label="The month after" onClick={() => setMonth(shiftMonth(month, 1))}>
                <ChevronRight className="size-4" />
              </Button>
            </div>
          ) : (
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, email, mobile or Request ID" className="pl-9" aria-label="Search the requests" />
            </div>
          )}
        </div>

        {view === "calendar" ? (
          <div className="border-t border-border">
            {places.length === 1 ? <p className="px-4 pt-3 text-theme-sm text-muted-foreground">{places[0].name}</p> : null}
            <div className="overflow-x-auto p-4">
              <div className="grid min-w-[700px] grid-cols-7 gap-px overflow-hidden rounded-xl border border-border bg-border">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                  <div key={d} className="bg-muted px-2 py-1.5 text-theme-xs font-medium text-muted-foreground">
                    {d}
                  </div>
                ))}
                {monthWeeks(month)
                  .flat()
                  .map((day, i) => (
                    <div key={day ?? `x${i}`} className={`flex min-h-24 flex-col gap-1 bg-card p-1.5 ${day ? "" : "bg-muted/40"}`}>
                      {day ? (
                        <>
                          <span className={`text-theme-xs ${day === today ? "font-semibold text-primary" : "text-muted-foreground"}`}>{Number(day.slice(8))}</span>
                          {slots
                            .filter((s) => s.day === day)
                            .map((s) => {
                              const r = holder(s);
                              const label = r ? r.requestorName : SLOT_STATE_LABEL[s.state];
                              const body = (
                                <>
                                  <span className="block truncate font-medium">{label}</span>
                                  <span className="block truncate opacity-80">
                                    {formatTime12(s.start)}
                                    {r ? ` · ${SLOT_STATE_LABEL[s.state]}` : ""}
                                  </span>
                                </>
                              );
                              return r ? (
                                <button key={s.start} type="button" onClick={() => setOpenId(r.id)} className={`rounded-md px-1.5 py-1 text-left text-theme-xs transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${SLOT_CLASS[s.state]}`}>
                                  {body}
                                </button>
                              ) : (
                                <div key={s.start} className={`rounded-md px-1.5 py-1 text-theme-xs ${SLOT_CLASS[s.state]}`}>
                                  {body}
                                </div>
                              );
                            })}
                        </>
                      ) : null}
                    </div>
                  ))}
              </div>
            </div>
            <p className="px-4 pb-4 text-theme-xs text-muted-foreground">Open slots are what the booking page offers. A pending request holds its slot until it is answered. Holidays come from the Calendar; closed dates and the slots themselves from Settings.</p>
          </div>
        ) : (
          <>
            {!term ? (
              <div className="border-t border-border px-4 py-3">
                <Tabs value={queue} onValueChange={(v) => setQueue(v as Queue)}>
                  <TabsList className="h-auto flex-wrap">
                    {QUEUES.map((q) => (
                      <TabsTrigger key={q.key} value={q.key}>
                        {q.label} <span className="ml-1 text-muted-foreground">{count(q.key)}</span>
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </div>
            ) : null}
            <div className="overflow-x-auto border-t border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Day</TableHead>
                    <TableHead>Requestor</TableHead>
                    <TableHead>Place</TableHead>
                    <TableHead className="text-right">Volunteers</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Number</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                        {term ? "No request matches that search." : QUEUES.find((q) => q.key === queue)?.empty}
                      </TableCell>
                    </TableRow>
                  ) : (
                    shown.map((r) => (
                      <TableRow key={r.id} tabIndex={0} className="cursor-pointer" onClick={() => setOpenId(r.id)} onKeyDown={(e) => e.key === "Enter" && setOpenId(r.id)}>
                        <TableCell className="whitespace-nowrap">
                          {formatDate(r.date, "EEE, MMM d, yyyy")}
                          <div className="text-theme-xs text-muted-foreground">
                            {formatTime12(r.start)} to {formatTime12(r.end)}
                          </div>
                        </TableCell>
                        <TableCell className="min-w-48 whitespace-normal">
                          {r.requestorName}
                          <div className="text-theme-xs text-muted-foreground">{r.contactPerson}</div>
                        </TableCell>
                        <TableCell className="min-w-48 whitespace-normal">{placeName(r.placeId)}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.volunteersCount}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <StatusBadge domain="booking" status={r.status} label={BOOKING_STATUS_LABEL[r.status]} />
                            {r.offPlan && r.status === "pending" ? <StatusBadge domain="booking" status="off_plan" label="Not in the NCH plan" /> : null}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{r.seqNo}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </SectionCard>

      <RequestDialog key={open?.id ?? "none"} request={open} canEdit={canEdit} onClose={() => setOpenId(null)} />
    </div>
  );
}
