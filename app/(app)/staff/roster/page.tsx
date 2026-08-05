"use client";

import { PageHeader } from "@/components/patterns/page-header";
import { RosterCalendar, type CalendarEvent } from "@/components/patterns/roster-calendar";
import { staff, shifts } from "@/lib/mock-data";
import { toast } from "sonner";

export default function RosterPage() {
  const events: CalendarEvent[] = shifts.map((shift) => {
    const person = staff.find((s) => s.id === shift.staffId);
    return {
      id: shift.id,
      date: shift.date,
      label: `${person?.firstName} ${person?.lastName}`,
      sublabel: `${shift.label} · ${shift.startTime}`,
      tone: shift.label === "PM" ? "warning" : shift.label === "24hr" ? "info" : "neutral",
    };
  });

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Shift Schedule" description="24/7 roster for resident social workers and household support." />
      <RosterCalendar
        events={events}
        onEventClick={(e) => toast.info(e.label + " — " + e.sublabel)}
        legend={[
          { label: "PM · 14:00", tone: "warning" },
          { label: "24hr · 06:00", tone: "info" },
          { label: "AM · 06:00", tone: "neutral" },
        ]}
      />
    </div>
  );
}
