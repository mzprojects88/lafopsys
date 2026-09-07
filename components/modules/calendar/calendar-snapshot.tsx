"use client";

import Link from "next/link";
import { ArrowRight, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCalendarEventsData } from "@/lib/hooks/use-calendar-events-collection";
import { useNow } from "@/lib/hooks/use-now";
import { dayKey } from "@/lib/utils/dtr";
import { inWindow, periodWindow } from "@/lib/utils/period";
import { formatDate } from "@/lib/utils/date";
import { VenueBadge } from "@/components/modules/calendar/calendar-list";

/**
 * Today and the rest of this week, compactly -- what the CEO wants to glance
 * at before opening the full calendar. Reads the same collection as
 * /calendar, so it is live too.
 */
export function CalendarSnapshot() {
  const { events, loading } = useCalendarEventsData();
  const today = dayKey(useNow());
  const week = periodWindow("week", today);

  const todays = events.filter((e) => e.date === today);
  const laterThisWeek = events.filter((e) => e.date > today && inWindow(e.date, week));

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarDays className="size-4 text-muted-foreground" />
          Calendar
        </CardTitle>
        <Button asChild variant="outline" size="sm">
          <Link href="/calendar">
            Open full calendar
            <ArrowRight />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Section title="Today" subtitle={formatDate(today, "EEEE, MMMM d")} events={todays} loading={loading} empty="Nothing scheduled today." />
        <Section title="Later this week" events={laterThisWeek} loading={loading} empty="Nothing else this week." showDate />
      </CardContent>
    </Card>
  );
}

function Section({
  title,
  subtitle,
  events,
  loading,
  empty,
  showDate,
}: {
  title: string;
  subtitle?: string;
  events: { id: string; date: string; time?: string; title: string; venue?: string; officerOnDuty?: string; isHoliday: boolean }[];
  loading: boolean;
  empty: string;
  showDate?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">{title}</span>
        {subtitle ? <span className="text-xs text-muted-foreground">{subtitle}</span> : null}
      </div>
      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : events.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {events.map((e) => (
            <li key={e.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="w-24 shrink-0 text-xs text-muted-foreground">
                {showDate ? formatDate(e.date, "EEE d") : null}
                {showDate && e.time ? " · " : null}
                {e.time ?? (showDate ? null : "—")}
              </span>
              <span className={e.isHoliday ? "flex-1 truncate font-medium text-amber-700 dark:text-amber-400" : "flex-1 truncate"}>{e.title}</span>
              {e.officerOnDuty ? <span className="hidden text-xs text-muted-foreground sm:inline">{e.officerOnDuty}</span> : null}
              <VenueBadge venue={e.venue} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
