"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { SectionCard } from "@/components/patterns/section-card";
import { ModuleSubNav } from "@/components/patterns/module-subnav";
import { PatientsSubNav } from "@/components/modules/patients/patients-subnav";
import { TRANSPORT_SUB_NAV } from "@/components/modules/transport/transport-nav";
import { HistoryDay } from "@/components/modules/patients/history-day";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useHistoryMonth } from "@/lib/hooks/use-history";
import { addDays } from "@/lib/utils/dtr";
import { monthGridDays } from "@/lib/utils/period";
import { csvLines, downloadCsv } from "@/lib/utils/csv";
import { formatDate, todayIso } from "@/lib/utils/date";
import { STATE_LABEL, dayState, monthCsv, monthsShown, type DayState, type HistoryMonthDay } from "@/lib/utils/history";

export type HistoryMode = "patients" | "transport";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** A day's state as a colour: done green, entered blue, short of the sheet amber, sheet only grey. */
export const STATE_STYLE: Record<DayState, string> = {
  complete: "border-success/40 bg-success/12 text-success-foreground dark:text-success",
  entered: "border-chart-1/40 bg-chart-1/10 text-foreground",
  partial: "border-warning/40 bg-warning/10 text-warning-foreground dark:text-warning",
  sheet_only: "border-border bg-muted/60 text-muted-foreground",
  empty: "border-transparent text-muted-foreground/70",
  future: "border-transparent text-muted-foreground/40",
};

/**
 * Patients > History and Transport > Ride history (0167, owner 19 Nov 2026): a month (or two) of past days,
 * as a calendar or a list, the app's figures beside the sheets'. A day opens its list of children, where
 * nights, beds, meals and rides are entered after the fact.
 */
export function HistoryLedger({ mode }: { mode: HistoryMode }) {
  const today = todayIso();
  const [month, setMonth] = React.useState(today.slice(0, 7));
  const [span, setSpan] = React.useState<1 | 2>(1);
  const [view, setView] = React.useState<"calendar" | "list">("calendar");
  const [open, setOpen] = React.useState<string | null>(null);
  const range = monthsShown(month, span);
  const { days, error, refetch } = useHistoryMonth(range.from, range.to);
  const byDay = new Map((days ?? []).map((d) => [d.day, d]));
  const past = (days ?? []).filter((d) => d.day < today);

  const step = (n: number) => {
    const [y, m] = month.split("-").map(Number);
    const next = new Date(Date.UTC(y!, m! - 1 + n, 1)).toISOString().slice(0, 7);
    setMonth(next > today.slice(0, 7) ? today.slice(0, 7) : next);
  };
  const totals = past.reduce(
    (t, d) => ({ complete: t.complete + (d.completed ? 1 : 0), sheetOnly: t.sheetOnly + (dayState(d, today) === "sheet_only" ? 1 : 0), partial: t.partial + (dayState(d, today) === "partial" ? 1 : 0) }),
    { complete: 0, sheetOnly: 0, partial: 0 }
  );

  function exportCsv() {
    const csv = monthCsv(past, today);
    downloadCsv(csvLines(csv.header, csv.rows), `history-${range.months.join("-")}.csv`);
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={mode === "patients" ? "History" : "Ride history"}
        description={
          mode === "patients"
            ? "Past days of the housing program: who stayed each night, in which bed, their meals and rides to and from NCH. Enter what the app is missing; a day marked complete is the record the reports use."
            : "Rides between LAF House and NCH on past days. Add the children who rode; a trip is made for a day that has none."
        }
        action={mode === "patients" ? <PatientsSubNav except="/patients/history" /> : <ModuleSubNav items={TRANSPORT_SUB_NAV} />}
      />

      <SectionCard
        title={
          <span className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="icon-sm" aria-label="Month before" onClick={() => step(-1)}>
              <ChevronLeft className="size-4" />
            </Button>
            <Input type="month" aria-label="Month" className="h-9 w-40" value={month} max={today.slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} />
            <Button variant="outline" size="icon-sm" aria-label="Month after" disabled={month >= today.slice(0, 7)} onClick={() => step(1)}>
              <ChevronRight className="size-4" />
            </Button>
          </span>
        }
        description={days ? `${totals.complete} complete · ${totals.partial} short of the sheet · ${totals.sheetOnly} on the sheet only` : undefined}
        actions={
          <>
            <Tabs value={String(span)} onValueChange={(v) => setSpan(v === "2" ? 2 : 1)}>
              <TabsList>
                <TabsTrigger value="1">1 month</TabsTrigger>
                <TabsTrigger value="2">2 months</TabsTrigger>
              </TabsList>
            </Tabs>
            <Tabs value={view} onValueChange={(v) => setView(v === "list" ? "list" : "calendar")}>
              <TabsList>
                <TabsTrigger value="calendar">Calendar</TabsTrigger>
                <TabsTrigger value="list">List</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!days}>
              <Download className="size-4" /> CSV
            </Button>
          </>
        }
      >
        {error ? <p className="text-theme-sm text-destructive">{error}</p> : null}
        {!days ? <p className="text-theme-sm text-muted-foreground">Loading the days…</p> : null}
        {days && view === "calendar" ? (
          <div className="flex flex-col gap-6">
            {range.months.map((m) => (
              <MonthCalendar key={m} month={m} today={today} mode={mode} byDay={byDay} onOpen={setOpen} />
            ))}
            <Legend />
          </div>
        ) : null}
        {days && view === "list" ? <DayList days={past} today={today} mode={mode} onOpen={setOpen} /> : null}
      </SectionCard>

      <HistoryDay
        day={open}
        mode={mode}
        onClose={() => setOpen(null)}
        onChanged={refetch}
        onStep={(n) => open && setOpen(addDays(open, n) < today ? addDays(open, n) : open)}
      />
    </div>
  );
}

/** The figure a cell shows: children (app / sheet) for Patients, riders for Transport. */
const figure = (d: HistoryMonthDay, mode: HistoryMode) => (mode === "patients" ? [d.app_children, d.sheet_children] : [d.app_rides, d.sheet_rides]);

function MonthCalendar({ month, today, mode, byDay, onOpen }: { month: string; today: string; mode: HistoryMode; byDay: Map<string, HistoryMonthDay>; onOpen: (day: string) => void }) {
  const days = monthGridDays(month);
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-theme-sm font-semibold">{formatDate(`${month}-01`, "MMMM yyyy")}</h4>
      <div className="grid grid-cols-7 gap-1 text-center text-theme-xs text-muted-foreground">
        {WEEKDAYS.map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          if (!day.startsWith(month)) return <div key={day} />;
          const d = byDay.get(day);
          const state = d ? dayState(d, today) : day >= today ? "future" : "empty";
          const [app, sheet] = d ? figure(d, mode) : [0, 0];
          const clickable = day < today;
          return (
            <button
              key={day}
              type="button"
              disabled={!clickable}
              onClick={() => onOpen(day)}
              title={`${formatDate(day, "EEE, MMM d")}: ${STATE_LABEL[state]}`}
              className={cn(
                "flex min-h-14 flex-col items-start gap-0.5 rounded-lg border p-1.5 text-left transition-colors sm:min-h-16",
                STATE_STYLE[state],
                clickable && "hover:ring-2 hover:ring-ring/40 focus-visible:ring-2 focus-visible:ring-ring",
                day === today && "ring-1 ring-primary/50"
              )}
            >
              <span className="text-theme-xs font-semibold">{Number(day.slice(8))}</span>
              {clickable && (app > 0 || sheet > 0) ? (
                <span className="text-[11px] leading-tight tabular-nums">
                  {app}
                  <span className="text-muted-foreground"> / {sheet}</span>
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Legend() {
  const shown: DayState[] = ["complete", "entered", "partial", "sheet_only"];
  return (
    <div className="flex flex-wrap items-center gap-3 text-theme-xs text-muted-foreground">
      <span>In a day: the app&apos;s figure / the sheet&apos;s.</span>
      {shown.map((s) => (
        <span key={s} className="flex items-center gap-1.5">
          <span className={cn("size-3 rounded border", STATE_STYLE[s])} />
          {STATE_LABEL[s]}
        </span>
      ))}
    </div>
  );
}

function DayList({ days, today, mode, onOpen }: { days: HistoryMonthDay[]; today: string; mode: HistoryMode; onOpen: (day: string) => void }) {
  const rows = [...days].reverse();
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-theme-sm">
        <thead className="text-left text-theme-xs text-muted-foreground">
          <tr>
            <th className="py-2 pr-3 font-medium">Day</th>
            {mode === "patients" ? <th className="py-2 pr-3 font-medium">Children (app / sheet)</th> : null}
            {mode === "patients" ? <th className="py-2 pr-3 font-medium">Meals (app / sheet)</th> : null}
            <th className="py-2 pr-3 font-medium">Riders (app / sheet)</th>
            <th className="py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((d) => {
            const state = dayState(d, today);
            return (
              <tr key={d.day} className="cursor-pointer hover:bg-muted/50" onClick={() => onOpen(d.day)}>
                <td className="py-2 pr-3">
                  <button type="button" className="font-medium hover:underline" onClick={() => onOpen(d.day)}>
                    {formatDate(d.day, "EEE, MMM d")}
                  </button>
                </td>
                {mode === "patients" ? <td className="py-2 pr-3 tabular-nums">{d.app_children} / {d.sheet_children}</td> : null}
                {mode === "patients" ? <td className="py-2 pr-3 tabular-nums">{d.app_meals} / {d.sheet_meals}</td> : null}
                <td className="py-2 pr-3 tabular-nums">{d.app_rides} / {d.sheet_rides}</td>
                <td className="py-2">
                  <span className={cn("rounded-md border px-2 py-0.5 text-theme-xs", STATE_STYLE[state])}>{STATE_LABEL[state]}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
