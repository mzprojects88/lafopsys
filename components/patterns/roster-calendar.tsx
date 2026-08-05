"use client";

import * as React from "react";
import { addDays, format, isSameDay, parseISO, startOfWeek } from "date-fns";
import { CalendarIcon, ChevronLeft, ChevronRight, CalendarX2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TODAY_ISO } from "@/lib/utils/seeded-random";

export interface CalendarEvent {
  id: string;
  date: string;
  label: string;
  sublabel?: string;
  tone?: "info" | "warning" | "positive" | "neutral";
}

interface RosterCalendarProps {
  events: CalendarEvent[];
  onEventClick?: (event: CalendarEvent) => void;
  legend?: { label: string; tone: NonNullable<CalendarEvent["tone"]> }[];
  className?: string;
}

const TONE_CLASSES: Record<NonNullable<CalendarEvent["tone"]>, string> = {
  info: "border-blue-200 bg-blue-50 dark:border-blue-500/25 dark:bg-blue-500/10",
  warning: "border-amber-200 bg-amber-50 dark:border-amber-500/25 dark:bg-amber-500/10",
  positive: "border-emerald-200 bg-emerald-50 dark:border-emerald-500/25 dark:bg-emerald-500/10",
  neutral: "border-slate-200 bg-slate-50 dark:border-slate-500/25 dark:bg-slate-500/10",
};

const DOT_CLASSES: Record<NonNullable<CalendarEvent["tone"]>, string> = {
  info: "bg-blue-500",
  warning: "bg-amber-500",
  positive: "bg-emerald-500",
  neutral: "bg-slate-400",
};

export function RosterCalendar({ events, onEventClick, legend, className }: RosterCalendarProps) {
  const [weekStart, setWeekStart] = React.useState(() => startOfWeek(parseISO(TODAY_ISO)));
  const days = Array.from({ length: 7 }).map((_, i) => addDays(weekStart, i));

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <CalendarIcon className="size-4 text-muted-foreground" />
          {format(weekStart, "MMM d")} – {format(addDays(weekStart, 6), "MMM d, yyyy")}
        </span>
        <div className="flex gap-1.5">
          <Button variant="outline" size="icon" className="size-8" onClick={() => setWeekStart((d) => addDays(d, -7))}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" size="sm" className="h-8 px-3 text-xs" onClick={() => setWeekStart(startOfWeek(parseISO(TODAY_ISO)))}>
            Today
          </Button>
          <Button variant="outline" size="icon" className="size-8" onClick={() => setWeekStart((d) => addDays(d, 7))}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-7">
        {days.map((day) => {
          const dayEvents = events.filter((e) => isSameDay(parseISO(e.date), day));
          const isToday = isSameDay(day, parseISO(TODAY_ISO));
          return (
            <div
              key={day.toISOString()}
              className={cn(
                "flex min-h-44 flex-col gap-2 rounded-xl border bg-card p-2.5",
                isToday && "border-primary/40 ring-1 ring-primary/20"
              )}
            >
              <div className={cn("flex items-center justify-between px-0.5 text-xs", isToday && "font-semibold text-primary")}>
                <span>{format(day, "EEE")}</span>
                <span>{format(day, "d")}</span>
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                {dayEvents.length === 0 ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-1 py-4 text-center">
                    <CalendarX2 className="size-4 text-muted-foreground/50" />
                    <span className="text-[10px] leading-tight text-muted-foreground">No shifts scheduled</span>
                  </div>
                ) : (
                  dayEvents.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => onEventClick?.(e)}
                      className={cn(
                        "rounded-lg border px-2 py-1.5 text-left text-[11px] leading-tight",
                        TONE_CLASSES[e.tone ?? "neutral"],
                        onEventClick && "cursor-pointer hover:opacity-80"
                      )}
                    >
                      <div className="flex items-center gap-1.5 font-medium">
                        <span className={cn("size-1.5 shrink-0 rounded-full", DOT_CLASSES[e.tone ?? "neutral"])} />
                        {e.label}
                      </div>
                      {e.sublabel && <div className="pl-3 text-muted-foreground">{e.sublabel}</div>}
                    </button>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {legend && legend.length > 0 && (
        <div className="flex flex-wrap gap-4 pt-1 text-xs text-muted-foreground">
          {legend.map((l) => (
            <div key={l.label} className="flex items-center gap-1.5">
              <span className={cn("size-2 shrink-0 rounded-full", DOT_CLASSES[l.tone])} />
              {l.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
