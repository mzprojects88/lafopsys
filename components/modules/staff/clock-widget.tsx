"use client";

import * as React from "react";
import { Clock, LogIn, LogOut, CalendarCheck, CalendarDays, CalendarRange, ShieldCheck, MapPin } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IconCircle } from "@/components/patterns/icon-circle";
import { PersonAvatar } from "@/components/patterns/person-avatar";
import { useShiftsData } from "@/lib/hooks/use-shifts-collection";
import { useClockStatus } from "@/lib/hooks/use-clock-status";
import { useDtrSessions } from "@/lib/hooks/use-dtr-sessions";
import { todayIso } from "@/lib/utils/date";
import { formatMinutes } from "@/lib/utils/dtr";
import { TODAY_ISO } from "@/lib/utils/seeded-random";
import { EmptyState } from "@/components/patterns/empty-state";

function nowLabel() {
  return new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

export function ClockWidget() {
  const { me, todayEntry, openEntry, clockedIn, loading, clockIn, clockOut } = useClockStatus();
  const { shifts } = useShiftsData();
  // Live hours from the punches; an open session keeps ticking on its own.
  const { totals } = useDtrSessions({ staffIds: me ? [me.id] : [] });
  // A punch waits on a GPS fix (up to 8s), so the button has to say so — an
  // unresponsive-looking button invites a second tap and a duplicate punch.
  const [punching, setPunching] = React.useState(false);

  if (loading) return null;

  if (!me) {
    return (
      <EmptyState
        title="No clock record for this role"
        description="Timekeeping applies to staff accounts. Switch to a staff role (e.g. House Staff or Driver) to see the clock widget."
      />
    );
  }

  const todayShift = shifts.find((s) => s.staffId === me.id && s.date === TODAY_ISO);

  async function handleClockIn() {
    setPunching(true);
    const result = await clockIn();
    setPunching(false);
    if (result?.ok) toast.success(`Clocked in at ${nowLabel()}`);
    else toast.error(result ? result.error : "Couldn't record the punch.");
  }

  async function handleClockOut() {
    setPunching(true);
    const result = await clockOut();
    setPunching(false);
    if (result?.ok) toast.success(`Clocked out at ${nowLabel()}`);
    else toast.error(result ? result.error : "You're not clocked in.");
  }

  const sessionsToday = todayEntry?.sessionCount ?? 0;
  const statusLabel = clockedIn
    ? `Clocked in at ${openEntry?.clockIn}${openEntry && openEntry.date !== todayIso() ? " yesterday" : ""}`
    : todayEntry?.clockOut
      ? `Clocked out at ${todayEntry.clockOut}`
      : "Not clocked in today";
  const sessionsLabel = sessionsToday > 0 ? ` · ${sessionsToday} session${sessionsToday === 1 ? "" : "s"} today` : "";

  return (
    <Card>
      <CardContent className="flex flex-col gap-5 py-6">
        <div className="flex items-center gap-2.5">
          <PersonAvatar name={`${me.firstName} ${me.lastName}`} size="sm" />
          <span className="text-sm font-medium">{me.firstName} {me.lastName} · {me.position}</span>
        </div>

        <div className="flex flex-col items-center gap-2">
          <IconCircle icon={Clock} color="blue" size="lg" />
          <span className="text-4xl font-semibold tabular-nums">{nowLabel()}</span>
          <span className="text-xs text-muted-foreground">
            {statusLabel}
            {sessionsLabel}
          </span>
        </div>

        {clockedIn ? (
          <Button
            size="lg"
            variant="destructive"
            className="h-12 w-full gap-2 text-base"
            disabled={punching}
            onClick={handleClockOut}
          >
            <LogOut className="size-5" />
            {punching ? "Recording…" : "Clock Out"}
          </Button>
        ) : (
          <Button
            size="lg"
            className="h-12 w-full gap-2 text-base"
            disabled={punching}
            onClick={handleClockIn}
          >
            <LogIn className="size-5" />
            {punching ? "Recording…" : "Clock In"}
          </Button>
        )}

        <div className="flex flex-col gap-2 border-t pt-4">
          <span className="text-xs font-medium text-muted-foreground">Today&apos;s Summary</span>
          <div className="flex items-center gap-2.5 rounded-lg border px-3 py-2">
            <IconCircle icon={CalendarCheck} color="green" size="sm" />
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">Status</span>
              <span className="text-sm font-medium capitalize">{statusLabel.startsWith("Not") ? "Not clocked in" : clockedIn ? "Clocked in" : "Clocked out"}</span>
            </div>
          </div>
          <div className="flex items-center gap-2.5 rounded-lg border px-3 py-2">
            <IconCircle icon={Clock} color="purple" size="sm" />
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">Scheduled Shift</span>
              <span className="text-sm font-medium">
                {todayShift ? `${todayShift.label} (${todayShift.startTime}–${todayShift.endTime})` : "—"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2.5 rounded-lg border px-3 py-2">
            <IconCircle icon={CalendarCheck} color="blue" size="sm" />
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">Hours Today</span>
              <span className="text-sm font-medium tabular-nums">
                {formatMinutes(totals.today)}
                {clockedIn && <span className="ml-1.5 text-xs font-normal text-muted-foreground">in progress</span>}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center gap-2.5 rounded-lg border px-3 py-2">
              <IconCircle icon={CalendarDays} color="indigo" size="sm" />
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">This Week</span>
                <span className="text-sm font-medium tabular-nums">{formatMinutes(totals.week)}</span>
              </div>
            </div>
            <div className="flex items-center gap-2.5 rounded-lg border px-3 py-2">
              <IconCircle icon={CalendarRange} color="purple" size="sm" />
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">This Month</span>
                <span className="text-sm font-medium tabular-nums">{formatMinutes(totals.month)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Staff are told what a punch records, in plain words and before they tap
            it — location tracking that people only discover afterwards isn't consent.
            Declining the browser's location prompt is explicitly safe. */}
        <div className="flex items-start gap-2.5 rounded-lg bg-accent/40 px-3 py-2.5 text-xs text-muted-foreground">
          <MapPin className="size-4 shrink-0 text-primary" />
          <span>
            Clocking in or out records your location, device and network address to your Daily Time Record.
            You can decline the location prompt — your punch is still saved, noted as no location given.
          </span>
        </div>

        <div className="flex items-start gap-2.5 rounded-lg bg-accent/40 px-3 py-2.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-4 shrink-0 text-primary" />
          <span>Don&apos;t forget to clock out at the end of your shift.</span>
        </div>
      </CardContent>
    </Card>
  );
}
