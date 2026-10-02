"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeftRight, BedDouble, BookmarkPlus, Check, DoorOpen, FilePlus2, LogOut, MoonStar, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SectionCard } from "@/components/patterns/section-card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBedReservations } from "@/lib/hooks/use-bed-reservations";
import { FloorPlanBedPicker } from "@/components/modules/house-ops/floor-plan/floor-plan-bed-picker";
import { CheckInDialog, type CheckInTarget } from "@/components/modules/patients/check-in-dialog";
import { useReferralsData } from "@/lib/hooks/use-referrals-collection";
import { isHiddenPath } from "@/lib/rbac/hidden";
import { useRole } from "@/context/role-provider";
import { DischargeDialog } from "@/components/modules/patients/discharge-dialog";
import { BedPlanDialog } from "@/components/modules/patients/bed-plan-dialog";
import { confirmHouseSheetMatch } from "@/app/(app)/patients/house-sheet/actions";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";
import { useHouseLayout } from "@/lib/hooks/use-house-layout-collection";
import { houseSheetPeopleStore } from "@/lib/hooks/use-house-sheet-collection";
import { useBedNights } from "@/lib/hooks/use-bed-nights-collection";
import { usePickups } from "@/lib/hooks/use-pickups-collection";
import { useAllOrientationChecks } from "@/lib/hooks/use-orientation-topics";
import { orientationProgress } from "@/lib/utils/admission-tasks";
import { isActiveStay, unitForBedPosition } from "@/lib/utils/beds";
import { sexFromRelationship, sleeperOfStay, type Sex } from "@/lib/utils/bed-rules";
import { BedRuleBreaches, BedRuleException, CarerSexField, NO_EXCEPTION, exceptionFor, useBedChoices, type ExceptionDraft } from "@/components/modules/patients/bed-rule-fields";
import { formatDate, todayIso } from "@/lib/utils/date";
import { PRIORITIES } from "@/lib/utils/master-sheet";
import { houseSheetPatientId, type HouseSheetPerson } from "@/lib/types/house-sheet";
import type { Stay } from "@/lib/types/patient";
import { plainError } from "@/lib/utils/plain-error";

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
  const { role } = useRole();
  const { patients, stays, loading: patientsLoading } = usePatientsData();
  const { units, bedPositions, loading: layoutLoading } = useHouseLayout();
  const { nights, confirmNight } = useBedNights();
  const { pickups } = usePickups();
  const { topics, checks } = useAllOrientationChecks();
  const [checkIn, setCheckIn] = React.useState<CheckInTarget | null>(null);
  const { referrals } = useReferralsData();
  const [discharge, setDischarge] = React.useState<{ stay: Stay; name: string; on: string } | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  // A bed held before the child arrives (user, 2026-09-25; 0065).
  const { holdFor, reserve, release, replace, loading: holdsLoading } = useBedReservations();
  const [releasing, setReleasing] = React.useState<{ holdId: string; bed: string; name: string } | null>(null);
  const [reserving, setReserving] = React.useState<{ row: HouseSheetPerson; patientId: string | null } | null>(null);
  // The reserved child is not taking the bed: a social worker gives it to another (0066).
  const [replacing, setReplacing] = React.useState<{ holdId: string; bed: string; from: string } | null>(null);
  // "Move for tonight" picks the new bed on the floor plan (user, 2026-09-25).
  const [planning, setPlanning] = React.useState(false);
  const [moving, setMoving] = React.useState<{ stay: Stay; name: string; from: string; unitId?: string } | null>(null);

  // Until patients, stays and beds are in, every name would look "not checked
  // in" and offer "Admit new child" -- a duplicate record on a slow phone.
  if (patientsLoading || layoutLoading || holdsLoading) {
    return <p className="rounded-2xl border border-border bg-card px-4 py-6 text-center text-theme-sm text-muted-foreground">Loading the house…</p>;
  }

  const today = todayIso();
  const patientById = new Map(patients.map((p) => [p.id, p]));
  const activeStays = stays.filter(isActiveStay);
  const stayByPatient = new Map(activeStays.map((s) => [s.patientId, s]));
  const onSheet = people.filter((p) => p.offSheetAt === null && p.matchStatus !== "dismissed");
  const onSheetPatientIds = new Set(onSheet.map(settledPatientId).filter((id): id is string => id !== null));

  // Highest priority first (the sheet's P: A chemo ... D follow-up); no priority last.
  const priorityOf = (p: HouseSheetPerson) => patientById.get(settledPatientId(p) ?? "")?.priority ?? "Z";
  const arrivals = onSheet
    .filter((p) => {
      const id = settledPatientId(p);
      return id === null || !stayByPatient.has(id);
    })
    .sort((a, b) => priorityOf(a).localeCompare(priorityOf(b)));
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
    if (!r.ok) toast.error(plainError(r.error));
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
      <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-2xl border border-border bg-card px-4 py-3 text-theme-xs text-muted-foreground">
        <span>On NCH&apos;s sheet today: <b className="text-foreground">{onSheet.length}</b></span>
        <span>Checked in: <b className="text-foreground">{activeStays.length}</b></span>
        <span>Need a bed: <b className="text-foreground">{arrivals.length}</b></span>
        <span>Tonight confirmed: <b className="text-foreground">{tonight.length - unconfirmed.length}/{tonight.length}</b></span>
        <span>Left the sheet: <b className="text-foreground">{left.length}</b></span>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <SectionCard
          title={
            <span className="flex items-center gap-2">
              <DoorOpen className="size-4 text-muted-foreground" strokeWidth={1.75} />
              Arrived, needs a bed ({arrivals.length})
            </span>
          }
          flush
          bodyClassName="flex flex-col divide-y divide-border"
        >
          {arrivals.length === 0 ? <p className="px-5 py-3 text-theme-xs text-muted-foreground">Everyone on today&apos;s sheet has a bed.</p> : null}
          {arrivals.map((p) => {
            const patient = patientById.get(settledPatientId(p) ?? "");
            const hold = holdFor(patient?.id, p.id);
            return (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-theme-sm">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{p.patientName}</span>
                  <span className="text-theme-xs text-muted-foreground">
                    {patient ? `${patient.patientNumber}${patient.priority ? ` · Priority ${patient.priority}, ${PRIORITIES[patient.priority]}` : ""} · on file` : p.matchStatus === "suggested" ? "AI suggests a record" : "Not on file"} · since {formatDate(p.runStartedOn, "MMM d")}
                    {pickups.some((t) => t.date >= p.runStartedOn && t.manifest.some((m) => m.sheetRowId === p.id && m.boardedAt)) ? " · came on LAF HOPE" : ""}
                  </span>
                  {hold ? (
                    <span className="text-theme-xs text-primary">
                      Bed {units.find((u) => u.id === hold.unitId)?.code ?? "?"} reserved, expected {formatDate(hold.expectedOn, "MMM d")}
                    </span>
                  ) : null}
                  {hold && canEdit ? (
                    <span className="mt-1 flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        disabled={busy === hold.id}
                        onClick={() => setReleasing({ holdId: hold.id, bed: units.find((u) => u.id === hold.unitId)?.code ?? "?", name: p.patientName })}
                      >
                        Release
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        onClick={() => setReplacing({ holdId: hold.id, bed: units.find((u) => u.id === hold.unitId)?.code ?? "?", from: p.patientName })}
                      >
                        Replace
                      </Button>
                    </span>
                  ) : null}
                </div>
                {canEdit && !hold && p.matchStatus !== "encoded" ? (
                  <Button size="sm" variant="ghost" onClick={() => setReserving({ row: p, patientId: patient?.id ?? null })}>
                    <BookmarkPlus /> Reserve bed
                  </Button>
                ) : null}
                {canEdit ? (
                  patient ? (
                    <Button size="sm" onClick={() => setCheckIn({ patient, sheetRow: p })}>
                      <BedDouble /> {hold ? `Confirm bed ${units.find((u) => u.id === hold.unitId)?.code ?? ""}` : "Check in"}
                    </Button>
                  ) : p.matchStatus === "suggested" && p.matchedPatientId ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === p.id}
                      onClick={() =>
                        run(p.id, async () => {
                          const r = await confirmHouseSheetMatch(p.id, p.matchedPatientId!);
                          if (r.ok) await houseSheetPeopleStore.refetch();
                          return r;
                        }, `Linked to ${nameOf(p.matchedPatientId!)}.`)
                      }
                    >
                      <Check /> It&apos;s {nameOf(p.matchedPatientId)}
                    </Button>
                  ) : p.matchStatus === "encoded" ? (
                    // Encoded through the referral form: an approved referral checks in from here;
                    // one still waiting links to the board only where the board is shown.
                    (() => {
                      const referral = referrals.find((r) => r.id === p.referralId);
                      if (referral?.status === "approved") {
                        return (
                          <Button size="sm" onClick={() => setCheckIn({ referral })}>
                            <BedDouble /> Check in
                          </Button>
                        );
                      }
                      return isHiddenPath("/patients/referrals", role) ? (
                        <span className="text-theme-xs text-muted-foreground">Referral waiting for approval</span>
                      ) : (
                        <Link href="/patients/referrals" className="text-theme-xs text-primary hover:underline">
                          Referral waiting on the board
                        </Link>
                      );
                    })()
                  ) : (
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/patients/admit?fromSheet=${p.id}`}>
                        <FilePlus2 /> Admit new child
                      </Link>
                    </Button>
                  )
                ) : null}
              </div>
            );
          })}
          {canEdit && arrivals.some((p) => settledPatientId(p) === null && p.matchStatus !== "suggested" && p.matchStatus !== "encoded") ? (
            <p className="px-5 py-3 text-theme-xs text-muted-foreground">Already on file under another spelling? Use Choose… in the list below first.</p>
          ) : null}
        </SectionCard>

        <SectionCard
          title={
            <span className="flex items-center gap-2">
              <MoonStar className="size-4 text-muted-foreground" strokeWidth={1.75} />
              Tonight&apos;s beds ({tonight.length})
            </span>
          }
          actions={
            canEdit ? (
              <span className="flex flex-wrap gap-1.5">
                {tonight.length ? (
                  <Button size="sm" variant="outline" onClick={() => setPlanning(true)}>
                    <Sparkles /> Suggest bed plan
                  </Button>
                ) : null}
                {unconfirmed.length > 1 ? (
                  <Button size="sm" variant="outline" disabled={busy === "all"} onClick={confirmAllSame}>
                    All same beds
                  </Button>
                ) : null}
              </span>
            ) : undefined
          }
          flush
          bodyClassName="flex flex-col divide-y divide-border"
        >
          <div className="px-5 pt-3 empty:hidden"><BedRuleBreaches /></div>
          {tonight.length === 0 ? <p className="px-5 py-3 text-theme-xs text-muted-foreground">Nobody is checked in.</p> : null}
          {tonight.map((s) => {
            const night = tonightNight(s);
            const tasks = orientationProgress(s, stays, topics, checks);
            return (
              <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-theme-sm">
                <div className="flex min-w-0 flex-col">
                  <Link href={`/patients/${s.patientId}`} className="truncate font-medium hover:underline">
                    {nameOf(s.patientId)}
                  </Link>
                  <span className="text-theme-xs text-muted-foreground">
                    Bed {bedOf(s.bedPositionId)} · {night ? "confirmed for tonight" : "not confirmed yet"}
                    {tasks.total > 0 && tasks.done < tasks.total ? ` · orientation ${tasks.done}/${tasks.total}` : ""}
                  </span>
                </div>
                {canEdit && !night ? (
                  <div className="flex items-center gap-1">
                    <Button size="sm" disabled={busy === s.id} onClick={() => run(s.id, () => confirmNight(s.id), "Same bed tonight.")}>
                      <Check /> Same bed
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === s.id}
                      aria-label={`Change ${nameOf(s.patientId)}'s bed`}
                      onClick={() => setMoving({ stay: s, name: nameOf(s.patientId), from: bedOf(s.bedPositionId), unitId: unitForBedPosition(s.bedPositionId, units, bedPositions)?.id })}
                    >
                      <BedDouble /> Change bed
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </SectionCard>

        <SectionCard
          title={
            <span className="flex items-center gap-2">
              <LogOut className="size-4 text-muted-foreground" strokeWidth={1.75} />
              Left the sheet ({left.length})
            </span>
          }
          flush
          bodyClassName="flex flex-col divide-y divide-border"
        >
          {left.length === 0 ? <p className="px-5 py-3 text-theme-xs text-muted-foreground">Nobody checked in has left NCH&apos;s sheet.</p> : null}
          {left.map(({ stay, row }) => (
            <div key={stay.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-theme-sm">
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{nameOf(stay.patientId)}</span>
                <span className="text-theme-xs text-muted-foreground">
                  Bed {bedOf(stay.bedPositionId)} · last on the sheet {formatDate(row.lastSeenOn, "MMM d")}
                </span>
              </div>
              {canEdit ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDischarge({ stay, name: nameOf(stay.patientId), on: dayAfter(row.lastSeenOn) <= today ? dayAfter(row.lastSeenOn) : today })}
                >
                  <LogOut /> Check out
                </Button>
              ) : null}
            </div>
          ))}
        </SectionCard>
      </div>

      {planning ? <BedPlanDialog onClose={() => setPlanning(false)} /> : null}
      {moving ? (
        <MoveTonightDialog
          key={moving.stay.id}
          stay={moving.stay}
          currentUnitId={moving.unitId}
          name={moving.name}
          from={moving.from}
          busy={busy === moving.stay.id}
          onClose={() => setMoving(null)}
          onMove={async (unitId, exceptionReason) => {
            await run(moving.stay.id, () => confirmNight(moving.stay.id, unitId, exceptionReason), "Moved for tonight.");
            setMoving(null);
          }}
        />
      ) : null}
      {reserving ? (
        <ReserveBedDialog
          name={reserving.row.patientName}
          patientId={reserving.patientId}
          defaultSex={sexFromRelationship(reserving.row.relationship)}
          onClose={() => setReserving(null)}
          onReserve={async (unitId, expectedOn, note, carerSex) => {
            const r = await reserve({ unitId, patientId: reserving.patientId, sheetPersonId: reserving.row.id, reservedFor: reserving.row.patientName, expectedOn, note, carerSex });
            if (!r.ok) return toast.error(plainError(r.error));
            toast.success("Bed reserved. Confirm it at check-in.");
            setReserving(null);
          }}
        />
      ) : null}
      {replacing ? (
        <ReplaceHoldDialog
          bed={replacing.bed}
          from={replacing.from}
          candidates={arrivals.filter((a) => !holdFor(settledPatientId(a), a.id))}
          onClose={() => setReplacing(null)}
          onReplace={async (row, carerSex) => {
            const r = await replace(replacing.holdId, { patientId: settledPatientId(row), sheetPersonId: row.id, reservedFor: row.patientName, carerSex });
            if (!r.ok) return toast.error(plainError(r.error));
            toast.success(`Bed ${replacing.bed} is now held for ${row.patientName}. Confirm it at their check-in.`);
            setReplacing(null);
          }}
        />
      ) : null}
      <CheckInDialog key={checkIn?.sheetRow?.id ?? checkIn?.referral?.id} target={checkIn} onOpenChange={(open) => !open && setCheckIn(null)} />
      <DischargeDialog
        key={discharge?.stay.id ?? "none"}
        stay={discharge?.stay ?? null}
        patientName={discharge?.name ?? ""}
        defaultCheckOutAt={discharge?.on}
        onOpenChange={(open) => !open && setDischarge(null)}
        onDischarged={() => setDischarge(null)}
      />
      <AlertDialog open={!!releasing} onOpenChange={(o) => !o && setReleasing(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Free bed {releasing?.bed}?</AlertDialogTitle>
            <AlertDialogDescription>
              It is held for {releasing?.name}. Once freed, anyone may take it; hold it again from here if you change your mind.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it held</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const r = releasing;
                setReleasing(null);
                if (r) void run(r.holdId, () => release(r.holdId), `Bed ${r.bed} is free again.`);
              }}
            >
              Free the bed
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Tonight in a different bed, chosen on the floor plan, under the bed rules (0070). */
function MoveTonightDialog({
  stay,
  currentUnitId,
  name,
  from,
  busy,
  onClose,
  onMove,
}: {
  stay: Stay;
  currentUnitId?: string;
  name: string;
  from: string;
  busy: boolean;
  onClose: () => void;
  onMove: (unitId: string, exceptionReason: string | null) => Promise<void>;
}) {
  const { carers, patients } = usePatientsData();
  const [unitId, setUnitId] = React.useState("");
  const [exception, setException] = React.useState<ExceptionDraft>(NO_EXCEPTION);
  const { options, blocked, isException } = useBedChoices(
    { who: sleeperOfStay(stay, carers, patients), excludeUnitId: currentUnitId, ignoreStayId: stay.id, patientId: stay.patientId },
    exception
  );
  const reason = exceptionFor(isException(unitId), exception);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Change {name}&apos;s bed</DialogTitle>
          <DialogDescription>Now in bed {from}. Tap the bed for tonight on the plan.</DialogDescription>
        </DialogHeader>
        <FloorPlanBedPicker value={unitId} onChange={setUnitId} options={options} blocked={blocked} />
        <BedRuleException blocked={blocked} value={exception} onChange={setException} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button disabled={!unitId || busy || (isException(unitId) && !reason)} onClick={() => onMove(unitId, reason)}>
            {busy ? "Changing…" : "Change bed"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Hold a bed for a child who has not arrived; Check in opens on it. */
function ReserveBedDialog({
  name,
  patientId,
  defaultSex,
  onClose,
  onReserve,
}: {
  name: string;
  patientId: string | null;
  defaultSex?: Sex;
  onClose: () => void;
  onReserve: (unitId: string, expectedOn: string, note: string, carerSex: Sex) => Promise<unknown>;
}) {
  const { patients } = usePatientsData();
  const [carerSex, setCarerSex] = React.useState<Sex | "">(defaultSex ?? "");
  const familyId = patientId ? patients.find((p) => p.id === patientId)?.familyId : undefined;
  // A hold follows the bed rules (0070); exceptions are for check-in only.
  const { options, blocked } = useBedChoices({ who: { sex: carerSex || undefined, familyId }, patientId });
  const [unitId, setUnitId] = React.useState("");
  const [expectedOn, setExpectedOn] = React.useState(todayIso());
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Reserve a bed for {name}</DialogTitle>
          <DialogDescription>Not checked in yet: the bed is held for them and offered to no one else. Confirm it when they arrive.</DialogDescription>
        </DialogHeader>
        <CarerSexField id="holdCarerSex" value={carerSex} onChange={(v) => { setCarerSex(v); setUnitId(""); }} />
        {carerSex ? <FloorPlanBedPicker value={unitId} onChange={setUnitId} options={options} blocked={blocked} /> : null}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="expectedOn">Expected to arrive</FieldLabel>
            <Input id="expectedOn" type="date" min={todayIso()} value={expectedOn} onChange={(e) => setExpectedOn(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="holdNote">Note (optional)</FieldLabel>
            <Input id="holdNote" placeholder="e.g. coming on LAF HOPE" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            disabled={!unitId || !expectedOn || !carerSex || busy}
            onClick={async () => {
              if (!carerSex) return;
              setBusy(true);
              await onReserve(unitId, expectedOn, note, carerSex);
              setBusy(false);
            }}
          >
            {busy ? "Reserving…" : "Reserve bed"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Replacement: the reserved child is not taking the bed; it is held for someone else. */
function ReplaceHoldDialog({
  bed,
  from,
  candidates,
  onClose,
  onReplace,
}: {
  bed: string;
  from: string;
  candidates: HouseSheetPerson[];
  onClose: () => void;
  onReplace: (row: HouseSheetPerson, carerSex: Sex) => Promise<unknown>;
}) {
  const [rowId, setRowId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [sexChoice, setSexChoice] = React.useState<Sex | "">("");
  const row = candidates.find((c) => c.id === rowId);
  const carerSex = sexChoice || sexFromRelationship(row?.relationship) || "";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Replace on bed {bed}</DialogTitle>
          <DialogDescription>{from} will not stay on this bed. Who takes it instead? Their check-in confirms it.</DialogDescription>
        </DialogHeader>
        <Select value={rowId} onValueChange={(v) => { setRowId(v); setSexChoice(""); }}>
          <SelectTrigger className="w-full" aria-label="Replacement">
            <SelectValue placeholder={candidates.length ? "Choose who takes the bed" : "Nobody else is waiting for a bed"} />
          </SelectTrigger>
          <SelectContent>
            {candidates.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.patientName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {row ? <CarerSexField id="replaceCarerSex" value={carerSex} onChange={setSexChoice} hint="The bed stays where it is; the rooms' rules still apply, so the database may refuse it." /> : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            disabled={!row || !carerSex || busy}
            onClick={async () => {
              if (!carerSex) return;
              setBusy(true);
              await onReplace(row!, carerSex);
              setBusy(false);
            }}
          >
            <ArrowLeftRight /> {busy ? "Replacing…" : "Replace"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
