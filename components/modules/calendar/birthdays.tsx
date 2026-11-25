"use client";

import * as React from "react";
import { Cake } from "lucide-react";
import { SectionCard } from "@/components/patterns/section-card";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";
import { formatDate } from "@/lib/utils/date";

/**
 * The month's birthday celebrants (0171): what the Master Calendar workbook kept in its "Birthday Celebrants"
 * tab, read from Patients so nobody types it. The ongoing patients only, as that tab listed them. Shown by the
 * Calendar page only to people who may see Patients: the page checks that before it renders this, and the
 * database refuses the names to anyone else.
 */
export function Birthdays({ month, today }: { month: string; today: string }) {
  const { patients, loading } = usePatientsData();
  const [year, mm] = month.split("-");
  const celebrants = React.useMemo(
    () =>
      patients
        .filter((p) => p.status === "ongoing" && p.birthDate && p.birthDate.slice(5, 7) === mm)
        .map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}`.replace(/\s+/g, " ").trim(), day: `${year}-${p.birthDate!.slice(5)}`, age: Number(year) - Number(p.birthDate!.slice(0, 4)) }))
        .sort((a, b) => a.day.localeCompare(b.day) || a.name.localeCompare(b.name)),
    [patients, year, mm]
  );
  if (loading && celebrants.length === 0) return null;
  return (
    <SectionCard title={`Birthdays in ${formatDate(`${month}-01`, "MMMM yyyy")}`} description="Ongoing patients, from Patients. Nothing to type here.">
      {celebrants.length === 0 ? (
        <p className="px-5 pb-5 text-theme-sm text-muted-foreground">No birthdays this month.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-x-6 gap-y-2 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-3">
          {celebrants.map((c) => (
            <li key={c.id} className="flex min-w-0 items-center gap-2 text-theme-sm">
              <Cake className={`size-4 shrink-0 ${c.day === today ? "text-primary" : "text-muted-foreground"}`} aria-hidden />
              <span className="shrink-0 tabular-nums text-muted-foreground">{formatDate(c.day, "MMM d")}</span>
              <span className={`min-w-0 [overflow-wrap:anywhere] ${c.day === today ? "font-semibold text-foreground" : "text-foreground"}`}>{c.name}</span>
              <span className="shrink-0 text-theme-xs text-muted-foreground">
                {c.day < today ? "turned" : "turns"} {c.age}
              </span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
