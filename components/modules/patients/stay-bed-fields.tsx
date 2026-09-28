"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FloorPlanBedPicker } from "@/components/modules/house-ops/floor-plan/floor-plan-bed-picker";
import { BedRuleException, CarerSexField, type ExceptionDraft } from "@/components/modules/patients/bed-rule-fields";
import { BedPlanDialog } from "@/components/modules/patients/bed-plan-dialog";
import { ArrivalFields, type ArrivalDraft } from "@/components/modules/patients/arrival-fields";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";
import { isActiveStay, type AssignableBed } from "@/lib/utils/beds";
import { todayIso } from "@/lib/utils/date";
import { familyLink, type BlockedBed, type Sex } from "@/lib/utils/bed-rules";
import type { BedReservation } from "@/lib/hooks/use-bed-reservations";

/**
 * The carer, bed and arrival part of an admission, one block in one order for
 * Check in and Admit new child (walkthrough, 2026-09-28): who sleeps there,
 * the bed (a reserved one noted right by it), then when and how they came.
 */

const NO_SIBLING = "none";

/** "Sibling already in the house?": siblings share a family (0070), so their carers may share a room. */
export function SiblingField({ value, onChange, excludeId }: { value: string; onChange: (patientId: string) => void; excludeId?: string | null }) {
  const { patients, stays } = usePatientsData();
  const inHouse = patients.filter((p) => p.id !== excludeId && stays.some((s) => s.patientId === p.id && isActiveStay(s)));
  if (!inHouse.length) return null;
  return (
    <Field>
      <FieldLabel htmlFor="sibling">Sibling already in the house?</FieldLabel>
      <Select value={value || NO_SIBLING} onValueChange={(v) => onChange(v === NO_SIBLING ? "" : v)}>
        <SelectTrigger id="sibling" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_SIBLING}>No</SelectItem>
          {inHouse.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.firstName} {p.lastName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

export function StayBedFields({
  askSex,
  carerSex,
  onCarerSex,
  sexHint,
  bed,
  onBed,
  beds,
  blocked,
  bedsLoading,
  hold,
  newcomer,
  exception,
  onException,
  siblingNote,
}: {
  /** False when no carer stays: the child's own sex decides. */
  askSex: boolean;
  carerSex: Sex | "";
  onCarerSex: (sex: Sex) => void;
  sexHint?: string;
  bed: string;
  onBed: (unitId: string) => void;
  beds: AssignableBed[];
  blocked: BlockedBed[];
  bedsLoading: boolean;
  hold: BedReservation | undefined;
  newcomer: { sex: Sex; familyId?: string; name: string } | undefined;
  exception: ExceptionDraft;
  onException: (next: ExceptionDraft) => void;
  siblingNote?: string;
}) {
  const [planning, setPlanning] = React.useState(false);
  return (
    <>
      {askSex ? <CarerSexField id="carerSex" value={carerSex} onChange={onCarerSex} hint={sexHint} /> : null}
      <Field>
        <FieldLabel>Tonight&apos;s bed</FieldLabel>
        {!askSex || carerSex ? (
          <FloorPlanBedPicker value={bed} onChange={onBed} options={beds} blocked={blocked} />
        ) : (
          <FieldDescription>Say whether the carer is a woman or a man first: rooms are for women carers or men carers.</FieldDescription>
        )}
        {hold ? (
          <FieldDescription>
            A bed was reserved for them{hold.unitId === bed ? "" : " (another bed is chosen, so the reserved one is freed)"}. Staying on it confirms it; tap another green bed if not.
          </FieldDescription>
        ) : null}
        {siblingNote ? <FieldDescription>{siblingNote}</FieldDescription> : null}
      </Field>
      {newcomer && !bedsLoading && !beds.length && !exception.on ? (
        <Button type="button" variant="outline" className="w-fit" onClick={() => setPlanning(true)}>
          No bed fits the rules: suggest a bed plan
        </Button>
      ) : null}
      <BedRuleException blocked={blocked} value={exception} onChange={onException} />
      {planning && newcomer ? <BedPlanDialog newcomer={newcomer} onClose={() => setPlanning(false)} onApplied={(u) => u && onBed(u)} /> : null}
    </>
  );
}

export function StayDatesFields({
  checkInAt,
  onCheckInAt,
  expectedCheckoutAt,
  onExpectedCheckoutAt,
  arrival,
  onArrival,
}: {
  checkInAt: string;
  onCheckInAt: (date: string) => void;
  expectedCheckoutAt: string;
  onExpectedCheckoutAt: (date: string) => void;
  arrival: ArrivalDraft;
  onArrival: (next: ArrivalDraft) => void;
}) {
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="checkInAt">Arrived on</FieldLabel>
          <Input id="checkInAt" type="date" max={todayIso()} value={checkInAt} onChange={(e) => onCheckInAt(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="expectedCheckoutAt">Expected check-out (optional)</FieldLabel>
          <Input id="expectedCheckoutAt" type="date" min={checkInAt} value={expectedCheckoutAt} onChange={(e) => onExpectedCheckoutAt(e.target.value)} />
        </Field>
      </div>
      <ArrivalFields value={arrival} onChange={onArrival} arrivalDate={checkInAt} />
    </>
  );
}

/** Writes a sibling link (familyLink); the first failure, or null. */
export async function linkSibling(
  updatePatient: (id: string, patch: { familyId: string }) => Promise<{ ok: true } | { ok: false; error: string }>,
  child: { id: string; familyId?: string } | undefined,
  sibling: { id: string; familyId?: string },
  newFamilyId: string
): Promise<string | null> {
  for (const u of familyLink(child, sibling, () => newFamilyId).updates) {
    const r = await updatePatient(u.id, { familyId: u.familyId });
    if (!r.ok) return r.error;
  }
  return null;
}
