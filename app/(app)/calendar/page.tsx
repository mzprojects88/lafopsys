"use client";

import * as React from "react";
import { CalendarDays, ChevronLeft, ChevronRight, List, Plus } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CalendarList } from "@/components/modules/calendar/calendar-list";
import { MonthGrid } from "@/components/modules/calendar/month-grid";
import { EventDialog, type EventDialogState } from "@/components/modules/calendar/event-dialog";
import { useCalendarEventsData } from "@/lib/hooks/use-calendar-events-collection";
import { useNow } from "@/lib/hooks/use-now";
import { useRole } from "@/lib/rbac/use-role";
import { canEditCalendar, canEditCalendarEvent } from "@/lib/rbac/roles";
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import { SyncStatus } from "@/components/modules/calendar/sync-status";
import { dayKey, monthKey } from "@/lib/utils/dtr";
import { inWindow, periodLabel, periodWindow, shiftAnchor, type PeriodKind } from "@/lib/utils/period";
import type { CalendarEvent } from "@/lib/types/calendar";

const PERIODS: { kind: PeriodKind; label: string }[] = [
  { kind: "today", label: "Today" },
  { kind: "week", label: "This Week" },
  { kind: "month", label: "This Month" },
  { kind: "quarter", label: "This Quarter" },
  { kind: "year", label: "This Year" },
];

/**
 * The foundation's master calendar, replacing the Google Sheet.
 *
 * State is { kind, anchor, view }: the period kind picks a window around the
 * anchor day, prev/next move the anchor by one period, and the month view
 * always shows the anchor's month whatever the kind. "Today" is the live
 * Manila day from useNow(), never the frozen demo constant.
 */
export default function CalendarPage() {
  const { events, loading, error } = useCalendarEventsData();
  const { role } = useRole();
  const { calendarSheetSyncEnabled } = useAppSettings();
  const canEdit = canEditCalendar(role);
  const canEditEvent = React.useCallback(
    (event: CalendarEvent) => canEditCalendarEvent(role, event, calendarSheetSyncEnabled),
    [role, calendarSheetSyncEnabled]
  );
  const today = dayKey(useNow());

  const [kind, setKind] = React.useState<PeriodKind>("week");
  const [anchor, setAnchor] = React.useState(today);
  const [view, setView] = React.useState<"list" | "month">("list");
  const [dialog, setDialog] = React.useState<EventDialogState>({ mode: "closed" });

  const window = React.useMemo(() => periodWindow(kind, anchor), [kind, anchor]);
  const month = monthKey(anchor);

  const inPeriod = React.useMemo(() => events.filter((e) => inWindow(e.date, window)), [events, window]);
  const inMonth = React.useMemo(() => events.filter((e) => e.date.startsWith(month)), [events, month]);

  const isCurrent = inWindow(today, window);

  function openCreate(date: string) {
    if (!canEdit) return;
    setDialog({ mode: "create", date });
  }
  // Everyone can open an event; whether it opens for editing depends on the
  // role and, while the sheet sync is on, on where the event came from.
  function openEvent(event: CalendarEvent) {
    setDialog(canEditEvent(event) ? { mode: "edit", event } : { mode: "view", event });
  }

  const periodControl = (
    <div className="flex flex-wrap items-center gap-2">
      <Tabs
        value={kind}
        onValueChange={(v) => {
          setKind(v as PeriodKind);
          setAnchor(today);
        }}
      >
        <TabsList>
          {PERIODS.map((p) => (
            <TabsTrigger key={p.kind} value={p.kind}>
              {p.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon-sm" aria-label="Previous period" onClick={() => setAnchor(shiftAnchor(kind, anchor, -1))}>
          <ChevronLeft />
        </Button>
        <Button variant="outline" size="sm" onClick={() => setAnchor(today)} disabled={isCurrent}>
          Today
        </Button>
        <Button variant="outline" size="icon-sm" aria-label="Next period" onClick={() => setAnchor(shiftAnchor(kind, anchor, 1))}>
          <ChevronRight />
        </Button>
      </div>
      <span className="text-sm font-medium tabular-nums">{view === "month" ? periodLabel("month", periodWindow("month", anchor)) : periodLabel(kind, window)}</span>
    </div>
  );

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Calendar"
        description="Every visit, care cart, meeting and holiday on the foundation's schedule."
        action={
          <div className="flex items-center gap-2">
            <Tabs value={view} onValueChange={(v) => setView(v as "list" | "month")}>
              <TabsList>
                <TabsTrigger value="list" aria-label="List view">
                  <List className="size-4" />
                  List
                </TabsTrigger>
                <TabsTrigger value="month" aria-label="Month view">
                  <CalendarDays className="size-4" />
                  Month
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {canEdit ? (
              <Button onClick={() => openCreate(isCurrent ? today : window.from)}>
                <Plus />
                Add event
              </Button>
            ) : null}
          </div>
        }
      />

      <SyncStatus />

      {error ? (
        <EmptyState title="Couldn't load the calendar" description={error} />
      ) : view === "month" ? (
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            {periodControl}
            <MonthGrid month={month} events={inMonth} today={today} canEdit={canEdit} onDayClick={openCreate} onEventClick={openEvent} />
            {!canEdit ? <p className="text-xs text-muted-foreground">Admins and social workers can add and change events.</p> : null}
          </CardContent>
        </Card>
      ) : (
        <CalendarList
          events={inPeriod}
          canEdit={canEdit}
          canEditEvent={canEditEvent}
          onOpen={openEvent}
          toolbar={periodControl}
          emptyMessage={loading ? "Loading…" : `Nothing on the calendar for ${periodLabel(kind, window)}.`}
        />
      )}

      <EventDialog state={dialog} onOpenChange={(open) => (open ? undefined : setDialog({ mode: "closed" }))} />
    </div>
  );
}
