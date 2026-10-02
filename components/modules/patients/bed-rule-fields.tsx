"use client";

import * as React from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useHouseLayout } from "@/lib/hooks/use-house-layout-collection";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";
import { useBedReservations } from "@/lib/hooks/use-bed-reservations";
import { useRole } from "@/lib/rbac/use-role";
import { canAllowBedException } from "@/lib/rbac/roles";
import { bedChoices, occupantsOf, roomBreaches, type BlockedBed, type Sex, type Sleeper } from "@/lib/utils/bed-rules";
import type { AssignableBed } from "@/lib/utils/beds";

/** The carer's sex: it decides which room they (and the child) sleep in (0070). */
export function CarerSexField({ id, value, onChange, hint }: { id: string; value: Sex | ""; onChange: (sex: Sex) => void; hint?: string }) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>Carer is a</FieldLabel>
      <Select value={value} onValueChange={(v) => onChange(v as Sex)}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder="Woman or man" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="F">Woman</SelectItem>
          <SelectItem value="M">Man</SelectItem>
        </SelectContent>
      </Select>
      <FieldDescription>{hint ?? "Rooms are for women carers or men carers, so this decides which beds are offered."}</FieldDescription>
    </Field>
  );
}

export interface ExceptionDraft {
  on: boolean;
  reason: string;
}
export const NO_EXCEPTION: ExceptionDraft = { on: false, reason: "" };

/**
 * Beds this person may take and the free beds the rules keep them off, from
 * the live house (lib/utils/bed-rules.ts), plus -- for an admin or the
 * social worker, admin or inventory lead who ticks the exception -- those blocked beds too.
 */
export function useBedChoices(
  opts: { who: Sleeper; excludeUnitId?: string; forHoldId?: string; ignoreStayId?: string; patientId?: string | null },
  exception: ExceptionDraft = NO_EXCEPTION
): { options: AssignableBed[]; blocked: BlockedBed[]; isException: (unitId: string) => boolean; loading: boolean } {
  const { rooms, units, bedPositions, loading: layoutLoading } = useHouseLayout();
  const { patients, carers, stays, loading: patientsLoading } = usePatientsData();
  const { reservations, loading: holdsLoading } = useBedReservations();
  const { sex, familyId } = opts.who;
  const { excludeUnitId, forHoldId, ignoreStayId, patientId } = opts;
  const { allowed, blocked } = React.useMemo(
    () =>
      bedChoices(units, bedPositions, stays, rooms, { carers, patients }, {
        who: { sex, familyId },
        excludeUnitId,
        forHoldId,
        ignoreStayId,
        patientId,
        holds: reservations,
      }),
    [units, bedPositions, stays, rooms, carers, patients, reservations, sex, familyId, excludeUnitId, forHoldId, ignoreStayId, patientId]
  );
  const blockedIds = React.useMemo(() => new Set(blocked.map((b) => b.unit.id)), [blocked]);
  return {
    options: exception.on ? [...allowed, ...blocked] : allowed,
    blocked,
    isException: (unitId) => exception.on && blockedIds.has(unitId),
    // Until the house is in, "no bed" means "not loaded yet", not "full".
    loading: layoutLoading || patientsLoading || holdsLoading,
  };
}

/**
 * When no allowed bed fits (a full house, a family of the other sex): an
 * social worker, an admin or the inventory lead may place them outside the rules (0072), saying why.
 * The database logs it and it shows as a breach until the family moves.
 */
export function BedRuleException({ blocked, value, onChange }: { blocked: BlockedBed[]; value: ExceptionDraft; onChange: (next: ExceptionDraft) => void }) {
  const { roles } = useRole();
  if (!blocked.length || !canAllowBedException(roles)) return null;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3">
      <label className="flex items-start gap-2 text-theme-sm text-foreground">
        <Checkbox className="mt-0.5" checked={value.on} onCheckedChange={(v) => onChange({ ...value, on: v === true })} />
        <span>
          Place outside the bed rules
          <span className="block text-theme-xs text-muted-foreground">
            Only when no allowed bed works. Offers the {blocked.length} bed{blocked.length === 1 ? "" : "s"} the rules keep them off; it is logged and shows as a breach until they move.
          </span>
        </span>
      </label>
      {value.on ? (
        <Textarea aria-label="Why the rules are set aside" placeholder="Why, e.g. house full tonight, moving them tomorrow morning" value={value.reason} onChange={(e) => onChange({ ...value, reason: e.target.value })} />
      ) : null}
    </div>
  );
}

/** The reason to send with the bed, when the chosen bed is outside the rules. */
export function exceptionFor(isException: boolean, draft: ExceptionDraft): string | null {
  return isException ? draft.reason.trim() || null : null;
}

/** Rooms breaking the single-sex rule right now (0070): an allowed exception,
 * or a family placed before the rules. Shown until someone moves. */
export function BedRuleBreaches() {
  const { rooms, units, bedPositions } = useHouseLayout();
  const { patients, carers, stays } = usePatientsData();
  const { reservations } = useBedReservations();
  const breaches = React.useMemo(
    () => roomBreaches(rooms, occupantsOf(units, bedPositions, stays, carers, patients, reservations)),
    [rooms, units, bedPositions, stays, carers, patients, reservations]
  );
  if (!breaches.length) return null;
  return (
    <p role="status" className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-2.5 text-theme-sm text-warning-foreground dark:text-warning">
      {breaches.map((r) => r.name).join(", ")} {breaches.length === 1 ? "has" : "have"} women and men carers who are not one family. Move them when a bed in the right room frees up.
    </p>
  );
}
