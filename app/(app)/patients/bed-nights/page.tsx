"use client";

import * as React from "react";
import { Download } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { PatientsSubNav } from "@/components/modules/patients/patients-subnav";
import { SectionCard } from "@/components/patterns/section-card";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";
import { useHouseLayout } from "@/lib/hooks/use-house-layout-collection";
import { csvLines, downloadCsv } from "@/lib/utils/csv";
import { formatDate, todayIso } from "@/lib/utils/date";
import { visitsOf } from "@/lib/utils/visits";

interface NightRow {
  night: string;
  stayId: string;
  bedPositionId: string;
}

/**
 * Bed nights (go-live report, 2026-10-13): every night each child slept in the house, from
 * ops.bed_nights -- the record check-in, "Same bed" and the daily re-admission write. By night
 * (beds used per room) and by child (nights and visits in the month), with a CSV.
 */
export default function BedNightsPage() {
  const { patients, carers, stays } = usePatientsData();
  const { rooms, units, bedPositions } = useHouseLayout();
  const [month, setMonth] = React.useState(todayIso().slice(0, 7));
  const [rows, setRows] = React.useState<NightRow[] | null>(null);

  React.useEffect(() => {
    let live = true;
    const from = `${month}-01`;
    const to = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
    createClient()
      .schema("ops")
      .from("bed_nights")
      .select("night, stay_id, bed_position_id")
      .gte("night", from)
      .lte("night", to)
      .order("night")
      .then(({ data }) => {
        if (live) setRows((data ?? []).map((r) => ({ night: r.night as string, stayId: r.stay_id as string, bedPositionId: r.bed_position_id as string })));
      });
    return () => {
      live = false;
    };
  }, [month]);

  const stayById = new Map(stays.map((s) => [s.id, s]));
  const patientById = new Map(patients.map((p) => [p.id, p]));
  const carerById = new Map(carers.map((c) => [c.id, c]));
  const unitOfPosition = new Map(bedPositions.map((bp) => [bp.id, units.find((u) => u.id === bp.unitId)]));
  const roomOfUnit = new Map(units.map((u) => [u.id, rooms.find((r) => r.id === u.roomId)]));
  const capacity = units.filter((u) => u.active).reduce((n, u) => n + u.capacity, 0);
  const sortedRooms = [...rooms].sort((a, b) => a.sortOrder - b.sortOrder);

  const nights = rows ?? [];
  const byNight = new Map<string, NightRow[]>();
  for (const n of nights) byNight.set(n.night, [...(byNight.get(n.night) ?? []), n]);
  const byPatient = new Map<string, NightRow[]>();
  for (const n of nights) {
    const pid = stayById.get(n.stayId)?.patientId;
    if (pid) byPatient.set(pid, [...(byPatient.get(pid) ?? []), n]);
  }
  const visits = visitsOf(stays);
  const visitsInMonth = (patientId: string) => {
    const mine = new Set(byPatient.get(patientId)?.map((n) => stayById.get(n.stayId)?.visitId ?? n.stayId));
    return visits.filter((v) => v.patientId === patientId && mine.has(v.id)).length;
  };
  const nameOf = (patientId: string) => {
    const p = patientById.get(patientId);
    return p ? `${p.lastName}, ${p.firstName}` : "Unknown";
  };
  const labelOf = (n: NightRow) => {
    const s = stayById.get(n.stayId);
    const unit = unitOfPosition.get(n.bedPositionId);
    return { bed: unit?.code ?? "?", room: unit ? (roomOfUnit.get(unit.id)?.name ?? "") : "", patient: s ? nameOf(s.patientId) : "Unknown", carer: s?.carerId ? (carerById.get(s.carerId)?.name ?? "") : "", visit: s?.visitId ?? s?.id ?? "" };
  };

  function exportCsv() {
    const lines = nights.map((n) => {
      const l = labelOf(n);
      return [n.night, l.room, l.bed, l.patient, l.carer, l.visit];
    });
    downloadCsv(csvLines(["Night", "Room", "Bed", "Patient", "Carer", "Visit"], lines), `bed-nights-${month}.csv`);
  }

  const nightsCount = nights.length;
  const daysWithNights = byNight.size;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Bed Nights"
        description="Every night a child slept in the house, as recorded at check-in and each evening's bed assignment."
        action={
          <div className="flex items-center gap-2">
            <Input type="month" aria-label="Month" className="w-44" value={month} max={todayIso().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} />
            <Button size="sm" variant="outline" disabled={!nightsCount} onClick={exportCsv}>
              <Download /> CSV
            </Button>
          </div>
        }
      />
      {/* The sub-nav's links are `sm:contents`: they need a wrapping row of their own outside the page header. */}
      <div className="flex w-full flex-wrap items-center gap-2">
        <PatientsSubNav except="/patients/bed-nights" />
      </div>

      <KpiGrid>
        <KpiCard label="Bed nights" value={nightsCount} />
        <KpiCard label="Nights with someone in" value={daysWithNights} />
        <KpiCard label="Children" value={byPatient.size} />
        <KpiCard label="Avg. beds used per night" value={daysWithNights ? (nightsCount / daysWithNights).toFixed(1) : "0"} />
      </KpiGrid>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionCard title="By night" flush bodyClassName="overflow-x-auto">
          {rows === null ? (
            <p className="px-5 py-3 text-theme-xs text-muted-foreground">Loading…</p>
          ) : byNight.size === 0 ? (
            <p className="px-5 py-3 text-theme-xs text-muted-foreground">No nights recorded in {formatDate(`${month}-01`, "MMMM yyyy")}.</p>
          ) : (
            <table className="w-full text-theme-sm">
              <thead className="text-theme-xs text-muted-foreground">
                <tr>
                  <th className="px-5 py-2 text-left font-medium">Night</th>
                  <th className="px-2 py-2 text-right font-medium">Beds used / {capacity}</th>
                  {sortedRooms.map((r) => (
                    <th key={r.id} className="px-2 py-2 text-right font-medium">{r.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[...byNight].map(([night, list]) => (
                  <tr key={night}>
                    <td className="px-5 py-2">{formatDate(night, "EEE, MMM d")}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{list.length}</td>
                    {sortedRooms.map((r) => (
                      <td key={r.id} className="px-2 py-2 text-right tabular-nums">{list.filter((n) => labelOf(n).room === r.name).length}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>

        <SectionCard title="By child" flush bodyClassName="overflow-x-auto">
          {byPatient.size === 0 ? (
            <p className="px-5 py-3 text-theme-xs text-muted-foreground">Nobody yet.</p>
          ) : (
            <table className="w-full text-theme-sm">
              <thead className="text-theme-xs text-muted-foreground">
                <tr>
                  <th className="px-5 py-2 text-left font-medium">Child</th>
                  <th className="px-2 py-2 text-right font-medium">Nights</th>
                  <th className="px-2 py-2 text-right font-medium">Visits</th>
                  <th className="px-2 py-2 text-left font-medium">Beds</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[...byPatient]
                  .sort((a, b) => b[1].length - a[1].length)
                  .map(([pid, list]) => (
                    <tr key={pid}>
                      <td className="px-5 py-2">{nameOf(pid)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{list.length}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{visitsInMonth(pid)}</td>
                      <td className="px-2 py-2 text-muted-foreground">{[...new Set(list.map((n) => labelOf(n).bed))].join(", ")}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
