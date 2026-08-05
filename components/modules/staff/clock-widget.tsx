"use client";

import * as React from "react";
import { Clock, LogIn, LogOut, CalendarCheck, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IconCircle } from "@/components/patterns/icon-circle";
import { PersonAvatar } from "@/components/patterns/person-avatar";
import { staff, shifts, timeEntries } from "@/lib/mock-data";
import { useLocalCollection } from "@/lib/store/use-mock-store";
import { useRole } from "@/lib/rbac/use-role";
import { TODAY_ISO } from "@/lib/utils/seeded-random";
import type { TimeEntry } from "@/lib/types/staff";
import { EmptyState } from "@/components/patterns/empty-state";

function nowLabel() {
  return new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

export function ClockWidget() {
  const { user } = useRole();
  const { items, updateItem, addItem } = useLocalCollection<TimeEntry>("time-entries", timeEntries);

  const me = staff.find((s) => `${s.firstName} ${s.lastName}` === user);

  if (!me) {
    return (
      <EmptyState
        title="No clock record for this role"
        description="Timekeeping applies to staff accounts. Switch to a staff role (e.g. House Staff or Driver) to see the clock widget."
      />
    );
  }

  const todayEntry = items.find((t) => t.staffId === me.id && t.date === TODAY_ISO);
  const clockedIn = !!todayEntry?.clockIn && !todayEntry?.clockOut;
  const todayShift = shifts.find((s) => s.staffId === me.id && s.date === TODAY_ISO);

  function handleClockIn() {
    if (!todayEntry) {
      addItem({
        id: `time-${me!.id}-${TODAY_ISO}`,
        staffId: me!.id,
        date: TODAY_ISO,
        clockIn: nowLabel(),
        breakMinutes: 0,
        flag: "on_time",
        overtimeMinutes: 0,
        gpsStamped: true,
      });
    } else {
      updateItem(todayEntry.id, { clockIn: nowLabel(), clockOut: undefined });
    }
    toast.success(`Clocked in at ${nowLabel()}`);
  }

  function handleClockOut() {
    if (!todayEntry) return;
    updateItem(todayEntry.id, { clockOut: nowLabel() });
    toast.success(`Clocked out at ${nowLabel()}`);
  }

  const statusLabel = clockedIn
    ? `Clocked in at ${todayEntry?.clockIn}`
    : todayEntry?.clockOut
      ? `Clocked out at ${todayEntry.clockOut}`
      : "Not clocked in today";

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
          <span className="text-xs text-muted-foreground">{statusLabel}</span>
        </div>

        {clockedIn ? (
          <Button size="lg" variant="destructive" className="h-12 w-full gap-2 text-base" onClick={handleClockOut}>
            <LogOut className="size-5" />
            Clock Out
          </Button>
        ) : (
          <Button size="lg" className="h-12 w-full gap-2 text-base" onClick={handleClockIn}>
            <LogIn className="size-5" />
            Clock In
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
              <span className="text-sm font-medium">{clockedIn ? "In progress" : "0h 0m"}</span>
            </div>
          </div>
        </div>

        <div className="flex items-start gap-2.5 rounded-lg bg-accent/40 px-3 py-2.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-4 shrink-0 text-primary" />
          <span>Don&apos;t forget to clock out at the end of your shift.</span>
        </div>
      </CardContent>
    </Card>
  );
}
