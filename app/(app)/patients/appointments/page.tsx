"use client";

import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/patterns/page-header";
import { RosterCalendar, type CalendarEvent } from "@/components/patterns/roster-calendar";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";

export default function AppointmentsPage() {
  const router = useRouter();
  const { patients, appointments } = usePatientsData();

  const events: CalendarEvent[] = appointments.map((a) => {
    const patient = patients.find((p) => p.id === a.patientId);
    return {
      id: a.id,
      date: a.date,
      label: `${patient?.firstName} ${patient?.lastName}`,
      sublabel: `${a.time} · ${a.clinic}`,
      tone: a.needsTransport ? "warning" : "info",
    };
  });

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Appointments" description="All-patients appointment calendar. Amber = needs transport." />
      <RosterCalendar
        events={events}
        onEventClick={(e) => {
          const appt = appointments.find((a) => a.id === e.id);
          if (appt) router.push(`/patients/${appt.patientId}`);
        }}
        legend={[
          { label: "Needs transport", tone: "warning" },
          { label: "No transport needed", tone: "info" },
        ]}
      />
    </div>
  );
}
