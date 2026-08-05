"use client";

import { useRole } from "@/context/role-provider";
import { useLocalCollection } from "@/lib/store/use-mock-store";
import { staff, timeEntries as seedTimeEntries } from "@/lib/mock-data";
import { TODAY_ISO } from "@/lib/utils/seeded-random";
import type { TimeEntry } from "@/lib/types/staff";

function nowLabel() {
  return new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Single source of truth for "is the current logged-in staff member clocked
 * in today" — drives the /staff clock widget, the clock-in-required dialog,
 * the topbar status badge, and the app-wide navigation gate.
 */
export function useClockStatus() {
  const { user } = useRole();
  const { items, updateItem, addItem } = useLocalCollection<TimeEntry>("time-entries", seedTimeEntries);

  const me = staff.find((s) => `${s.firstName} ${s.lastName}` === user);
  const todayEntry = me ? items.find((t) => t.staffId === me.id && t.date === TODAY_ISO) : undefined;
  const clockedIn = !!todayEntry?.clockIn && !todayEntry?.clockOut;
  const hasClockedInToday = !!todayEntry?.clockIn;

  function clockIn() {
    if (!me) return;
    if (!todayEntry) {
      addItem({
        id: `time-${me.id}-${TODAY_ISO}`,
        staffId: me.id,
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
  }

  function clockOut() {
    if (!todayEntry) return;
    updateItem(todayEntry.id, { clockOut: nowLabel() });
  }

  return { me, todayEntry, clockedIn, hasClockedInToday, clockIn, clockOut };
}
