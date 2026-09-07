"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { monthGridDays } from "@/lib/utils/period";
import type { CalendarEvent } from "@/lib/types/calendar";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_PILLS = 3;

/**
 * A month of the foundation calendar as a grid -- the view the sheet's
 * "April 2026" / "May 2026" tabs were drawn by hand to give.
 *
 * Deliberately not built on components/patterns/roster-calendar.tsx: that is
 * a seven-day strip on a Sunday-first week anchored to the frozen demo date.
 * This is six Monday-first rows from lib/utils/period.ts's monthGridDays,
 * with "today" passed in by the page (todayIso(), Manila).
 */
export function MonthGrid({
  month,
  events,
  today,
  canEdit,
  onDayClick,
  onEventClick,
}: {
  /** `yyyy-MM`. */
  month: string;
  events: CalendarEvent[];
  today: string;
  canEdit: boolean;
  onDayClick: (day: string) => void;
  onEventClick: (event: CalendarEvent) => void;
}) {
  const days = React.useMemo(() => monthGridDays(month), [month]);
  const byDay = React.useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const list = map.get(e.date);
      if (list) list.push(e);
      else map.set(e.date, [e]);
    }
    return map;
  }, [events]);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-7 border-b text-center text-xs font-medium text-muted-foreground">
          {WEEKDAYS.map((d) => (
            <div key={d} className="py-2">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const inMonth = day.startsWith(month);
            const dayEvents = byDay.get(day) ?? [];
            const holiday = dayEvents.some((e) => e.isHoliday);
            const isToday = day === today;
            const overflow = dayEvents.length - MAX_PILLS;
            return (
              <div
                key={day}
                role={canEdit ? "button" : undefined}
                tabIndex={canEdit ? 0 : undefined}
                onClick={() => onDayClick(day)}
                onKeyDown={(e) => {
                  if (canEdit && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    onDayClick(day);
                  }
                }}
                className={cn(
                  "flex min-h-24 flex-col gap-1 border-b border-r p-1.5 text-left",
                  !inMonth && "bg-muted/30 text-muted-foreground",
                  holiday && inMonth && "bg-amber-50/60 dark:bg-amber-500/10",
                  canEdit && "cursor-pointer hover:bg-accent/40"
                )}
              >
                <span
                  className={cn(
                    "inline-flex size-6 items-center justify-center rounded-full text-xs tabular-nums",
                    isToday && "bg-primary font-semibold text-primary-foreground"
                  )}
                >
                  {Number(day.slice(8))}
                </span>
                {dayEvents.slice(0, MAX_PILLS).map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onEventClick(e);
                    }}
                    title={[e.time, e.title, e.venue].filter(Boolean).join(" · ")}
                    className={cn(
                      "w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] leading-tight",
                      e.isHoliday
                        ? "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300"
                        : "bg-primary/10 text-foreground hover:bg-primary/20"
                    )}
                  >
                    {e.time ? <span className="text-muted-foreground">{e.time} </span> : null}
                    {e.title}
                  </button>
                ))}
                {overflow > 0 ? <span className="px-1.5 text-[11px] text-muted-foreground">+{overflow} more</span> : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
