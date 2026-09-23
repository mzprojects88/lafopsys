"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { BedDouble, Check, DoorOpen, FilePlus2, LogOut, MoonStar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckInDialog } from "@/components/modules/patients/check-in-dialog";
import { DischargeDialog } from "@/components/modules/patients/discharge-dialog";
import { confirmHouseSheetMatch } from "@/app/(app)/patients/house-sheet/actions";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";
import { useHouseLayout } from "@/lib/hooks/use-house-layout-collection";
import { houseSheetPeopleStore } from "@/lib/hooks/use-house-sheet-collection";
import { useBedNights } from "@/lib/hooks/use-bed-nights-collection";
import { usePickups } from "@/lib/hooks/use-pickups-collection";
import { useAllOrientationChecks } from "@/lib/hooks/use-orientation-topics";
import { orientationProgress } from "@/lib/utils/admission-tasks";
import { assignableBeds, isActiveStay, unitForBedPosition } from "@/lib/utils/beds";
import { formatDate, todayIso } from "@/lib/utils/date";
import { houseSheetPatientId, type HouseSheetPerson } from "@/lib/types/house-sheet";
import type { Patient, Stay } from "@/lib/types/patient";

const dayAfter = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** The patient a sheet row settles to -- an AI suggestion does not count until confirmed. */
function settledPatientId(p: HouseSheetPerson): string | null {
  return ["auto_matched", "confirmed", "encoded"].includes(p.matchStatus) ? houseSheetPatientId(p) : null;
}

/**
 * The house today, from NCH's Occupancy Tracker (0051): who arrived and
 * needs a bed, tonight's bed for everyone in, and who has left the sheet.
 * The sheet is NCH's; everything here is one click on top of it.
 */
export function HouseToday({ people, canEdit }: { people: HouseSheetPerson[]; canEdit: boolean }) {
  const { patients, stays } = usePatientsData();
  const { rooms, units, bedPositions } = useHouseLayout();
  const { nights, confirmNight } = useBedNights();
  const { pickups } = usePickups();
  const { topics, checks } = useAllOrientationChecks();
  const [checkIn, setCheckIn] = React.useState<{ patient: Patient; sheetRow: HouseSheetPerson } | null>(null);
  const [discharge, setDischarge] = React.useState<{ stay: Stay; name: string; on: string } | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const today = todayIso();
  const patientById = new Map(patients.map((p) => [p.id, p]));
  const activeStays = stays.filter(isActiveStay);
  const stayByPatient = new Map(activeStays.map((s) => [s.patientId, s]));
  const onSheet = people.filter((p) => p.offSheetAt === null && p.matchStatus !== "dismissed");
  const onSheetPatientIds = new Set(onSheet.map(settledPatientId).filter((id): id is string => id !== null));

  const arrivals = onSheet.filter((p) => {
    const id = settledPatientId(p);
    return id === null || !stayByPatient.has(id);
  });
  // In the house but gone from the newest tab: NCH says they left.
  const left = activeStays.flatMap((s) => {
    if (onSheetPatientIds.has(s.patientId)) return [];
    const row = people.find((p) => p.offSheetAt !== null && settledPatientId(p) === s.patientId);
    return row ? [{ stay: s, row }] : [];
  });
  const leftStayIds = new Set(left.map((l) => l.stay.id));
  const tonight = activeStays.filter((s) => !leftStayIds.has(s.id));
  const tonightNight = (s: Stay) => nights.find((n) => n.night === today && n.stayId === s.id);
  const unconfirmed = tonight.filter((s) => !tonightNight(s));

  const nameOf = (patientId: string) => {
    const p = patientById.get(patientId);
    return p ? `${p.lastName}, ${p.firstName}` : "Unknown patient";
  };
  const bedOf = (bedPositionId: string) => unitForBedPosition(bedPositionId, units, bedPositions)?.code ?? "—";

  async function run(key: string, fn: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    setBusy(key);
    const r = await fn();
    setBusy(null);
    if (!r.ok) toast.error(r.error ?? "Something went wrong.");
    else toast.success(done);
  }

  async function confirmAllSame() {
    setBusy("all");
    let failed = 0;
    for (const s of unconfirmed) if (!(await confirmNight(s.id)).ok) failed += 1;
    setBusy(null);
    if (failed) toast.error(`${failed} could not be confirmed; try them one by one.`);
    else toast.success(`${unconfirmed.length} bed${unconfirmed.length === 1 ? "" : "s"} confirmed for tonight`);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <span>On NCH&apos;s sheet today: <b className="text-foreground">{onSheet.length}</b></span>
        <span>Checked in: <b className="text-foreground">{activeStays.length}</b></span>
        <span>Need a bed: <b className="text-foreground">{arrivals.length}</b></span>
        <span>Tonight confirmed: <b className="text-foreground">{tonight.length - unconfirmed.length}/{tonight.length}</b></span>
        <span>Left the sheet: <b className="text-foreground">{left.length}</b></span>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <DoorOpen className="size-4 text-muted-foreground" />
            <CardTitle className="text-sm">Arrived, needs a bed ({arrivals.length})</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {arrivals.length === 0 ? <p className="text-xs text-muted-foreground">Everyone on today&apos;s sheet has a bed.</p> : null}
            {arrivals.map((p) => {
              const patient = patientById.get(settledPatientId(p) ?? "");
              return (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">{p.patientName}</span>
                    <span className="text-xs text-muted-foreground">
                      {patient ? `${patient.patientNumber} · on file` : p.matchStatus === "suggested" ? "AI suggests a record" : "Not on file"} · since {formatDate(p.runStartedOn, "MMM d")}
                      {pickups.some((t) => t.date >= p.runStartedOn && t.manifest.some((m) => m.sheetRowId === p.id && m.boardedAt)) ? " · came on LAF HOPE" : ""}
                    </span>
                  </div>
                  {canEdit ? (
                    patient ? (
                      <Button size="sm" className="h-7 gap-1" onClick={() => setCheckIn({ patient, sheetRow: p })}>
                        <BedDouble className="size-3.5" /> Check in
                      </Button>
                    ) : p.matchStatus === "suggested" && p.matchedPatientId ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1"
                        disabled={busy === p.id}
                        onClick={() =>
                          run(p.id, async () => {
                            const r = await confirmHouseSheetMatch(p.id, p.matchedPatientId!);
                            if (r.ok) await houseSheetPeopleStore.refetch();
                            return r;
                          }, `Linked to ${nameOf(p.matchedPatientId!)}.`)
                        }
                      >
                        <Check className="size-3.5" /> It&apos;s {nameOf(p.matchedPatientId)}
                      </Button>
                    ) : p.matchStatus === "encoded" ? (
                      <Link href="/patients/referrals" className="text-xs text-primary hover:underline">
                        Referral waiting on the board
                      </Link>
                    ) : (
                      <Button asChild size="sm" variant="outline" className="h-7 gap-1">
                        <Link href={`/patients/admit?fromSheet=${p.id}`}>
                          <FilePlus2 className="size-3.5" /> Admit new child
                        </Link>
                      </Button>
                    )
                  ) : null}
                </div>
              );
            })}
            {canEdit && arrivals.some((p) => settledPatientId(p) === null && p.matchStatus !== "suggested" && p.matchStatus !== "encoded") ? (
              <p className="text-[11px] text-muted-foreground">Already on file under another spelling? Use Choose… in the list below first.</p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
            <div className="flex items-center gap-2">
              <MoonStar className="size-4 text-muted-foreground" />
              <CardTitle className="text-sm">Tonight&apos;s beds ({tonight.length})</CardTitle>
            </div>
            {canEdit && unconfirmed.length > 1 ? (
              <Button size="sm" variant="outline" className="h-7" disabled={busy === "all"} onClick={confirmAllSame}>
                All same beds
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {tonight.length === 0 ? <p className="text-xs text-muted-foreground">Nobody is checked in.</p> : null}
            {tonight.map((s) => {
              const night = tonightNight(s);
              const moves = assignableBeds(units, bedPositions, stays, rooms, { excludeUnitId: unitForBedPosition(s.bedPositionId, units, bedPositions)?.id });
              const tasks = orientationProgress(s, stays, topics, checks);
              return (
                <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm">
                  <div className="flex min-w-0 flex-col">
                    <Link href={`/patients/${s.patientId}`} className="truncate font-medium hover:underline">
                      {nameOf(s.patientId)}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      Bed {bedOf(s.bedPositionId)} · {night ? "confirmed for tonight" : "not confirmed yet"}
                      {tasks.total > 0 && tasks.done < tasks.total ? ` · orientation ${tasks.done}/${tasks.total}` : ""}
                    </span>
                  </div>
                  {canEdit && !night ? (
                    <div className="flex items-center gap-1">
                      <Button size="sm" className="h-7 gap-1" disabled={busy === s.id} onClick={() => run(s.id, () => confirmNight(s.id), "Same bed tonight.")}>
                        <Check className="size-3.5" /> Same bed
                      </Button>
                      <Select value="" onValueChange={(unitId) => run(s.id, () => confirmNight(s.id, unitId), "Moved for tonight.")}>
                        <SelectTrigger size="sm" className="h-7 w-[92px] text-xs" aria-label={`Move ${nameOf(s.patientId)} to another bed`}>
                          <SelectValue placeholder="Move…" />
                        </SelectTrigger>
                        <SelectContent>
                          {moves.map((b) => (
                            <SelectItem key={b.unit.id} value={b.unit.id}>
                              {b.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <LogOut className="size-4 text-muted-foreground" />
            <CardTitle className="text-sm">Left the sheet ({left.length})</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {left.length === 0 ? <p className="text-xs text-muted-foreground">Nobody checked in has left NCH&apos;s sheet.</p> : null}
            {left.map(({ stay, row }) => (
              <div key={stay.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{nameOf(stay.patientId)}</span>
                  <span className="text-xs text-muted-foreground">
                    Bed {bedOf(stay.bedPositionId)} · last on the sheet {formatDate(row.lastSeenOn, "MMM d")}
                  </span>
                </div>
                {canEdit ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1"
                    onClick={() => setDischarge({ stay, name: nameOf(stay.patientId), on: dayAfter(row.lastSeenOn) <= today ? dayAfter(row.lastSeenOn) : today })}
                  >
                    <LogOut className="size-3.5" /> Discharge
                  </Button>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <CheckInDialog key={checkIn?.sheetRow.id} target={checkIn} onOpenChange={(open) => !open && setCheckIn(null)} />
      <DischargeDialog
        stay={discharge?.stay ?? null}
        patientName={discharge?.name ?? ""}
        defaultCheckOutAt={discharge?.on}
        onOpenChange={(open) => !open && setDischarge(null)}
        onDischarged={() => setDischarge(null)}
      />
    </div>
  );
}
