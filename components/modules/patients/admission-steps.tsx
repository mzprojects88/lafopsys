"use client";

import * as React from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { arrivalGroup, type ArrivalDraft } from "@/components/modules/patients/arrival-fields";
import { closeReservation, type BedReservation } from "@/lib/hooks/use-bed-reservations";
import { recordGroupOrientation, useGroupOrientations } from "@/lib/hooks/use-group-orientations";
import { useOrientationTopics } from "@/lib/hooks/use-orientation-topics";
import { useStaffRoster } from "@/lib/hooks/use-staff-roster";

/**
 * The shared end of an admission (user, 2026-09-25), used by Check in and by
 * Admit new child: the next appointment typed in when NCH's sheet has none,
 * and the house rules -- the last step before a child is checked in, heard
 * alone or once with the group that arrived together (0065).
 */

// ---------------------------------------------------------------------------
// Next appointment
// ---------------------------------------------------------------------------

export interface AppointmentDraft {
  date: string;
  time: string;
  clinic: string;
  needsTransport: boolean;
}
export const EMPTY_APPOINTMENT: AppointmentDraft = { date: "", time: "08:00", clinic: "", needsTransport: true };
export const appointmentReady = (a: AppointmentDraft) => !a.date || !!a.clinic.trim();

export function NextAppointmentFields({ value, onChange, note }: { value: AppointmentDraft; onChange: (next: AppointmentDraft) => void; note?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <span className="text-sm font-medium">Next hospital appointment (optional)</span>
      {note ? <span className="text-xs text-muted-foreground">{note}</span> : null}
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel htmlFor="apptDate">Date</FieldLabel>
          <Input id="apptDate" type="date" value={value.date} onChange={(e) => onChange({ ...value, date: e.target.value })} />
        </Field>
        <Field>
          <FieldLabel htmlFor="apptTime">Time</FieldLabel>
          <Input id="apptTime" type="time" value={value.time} onChange={(e) => onChange({ ...value, time: e.target.value })} />
        </Field>
      </div>
      {value.date ? (
        <>
          <Field>
            <FieldLabel htmlFor="apptClinic">Clinic</FieldLabel>
            <Input id="apptClinic" placeholder="e.g. NCH Pediatric Oncology" value={value.clinic} onChange={(e) => onChange({ ...value, clinic: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={value.needsTransport} onCheckedChange={(v) => onChange({ ...value, needsTransport: !!v })} />
            Needs a ride (goes on the transport manifest)
          </label>
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// House rules
// ---------------------------------------------------------------------------

export interface RulesDraft {
  discussed: boolean;
  /** First of a group: record that the whole group heard them. */
  asGroup: boolean;
}
export const EMPTY_RULES: RulesDraft = { discussed: false, asGroup: true };

/** The rules this family needs and whether their group already heard them. */
export function useHouseRules(firstStay: boolean, arrival: ArrivalDraft) {
  const { topics } = useOrientationTopics(undefined, firstStay);
  const { forGroup } = useGroupOrientations();
  const { staff } = useStaffRoster();
  const group = arrivalGroup(arrival);
  const groupTalk = group ? forGroup(group) : undefined;
  const heldBy = groupTalk?.heldBy ? staff.find((x) => x.id === groupTalk.heldBy) : undefined;
  return { topics, group, groupTalk, heldByName: heldBy ? `${heldBy.firstName} ${heldBy.lastName}` : null };
}

export function HouseRulesStep({
  name,
  firstStay,
  rules,
  value,
  onChange,
}: {
  name: string;
  firstStay: boolean;
  rules: ReturnType<typeof useHouseRules>;
  value: RulesDraft;
  onChange: (next: RulesDraft) => void;
}) {
  const { topics, group, groupTalk, heldByName } = rules;
  const groupName = group?.kind === "trip" ? "LAF HOPE pick-up" : "shared ride";
  return (
    <div className="flex flex-col gap-3">
      {group ? (
        groupTalk ? (
          <p className="rounded-md border border-emerald-200 bg-emerald-50/60 p-3 text-xs text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-500/10 dark:text-emerald-200">
            The rules were discussed with this {groupName} group at{" "}
            {new Date(groupTalk.heldAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" })}
            {heldByName ? ` by ${heldByName}` : ""}. If {name} and their carer were there, tick below.
          </p>
        ) : (
          <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
            <Checkbox className="mt-0.5" checked={value.asGroup} onCheckedChange={(v) => onChange({ ...value, asGroup: !!v })} />
            <span>
              Discussed with everyone who came on this {groupName}.
              <span className="block text-xs text-muted-foreground">The others in the group are then checked in on this talk.</span>
            </span>
          </label>
        )
      ) : null}

      {topics.length ? (
        <ol className="flex max-h-[45dvh] list-decimal flex-col gap-2 overflow-y-auto rounded-md border bg-muted/20 p-3 pl-8 text-sm">
          {topics.map((t) => (
            <li key={t.id}>
              {t.topic}
              {t.topicEn ? <span className="block text-xs text-muted-foreground">{t.topicEn}</span> : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-xs text-muted-foreground">No house rules are set up yet.</p>
      )}
      {!firstStay ? <p className="text-xs text-muted-foreground">A returning family: the shorter list.</p> : null}

      <label className="flex items-start gap-2 text-sm font-medium">
        <Checkbox className="mt-0.5" checked={value.discussed} onCheckedChange={(v) => onChange({ ...value, discussed: !!v })} />
        {groupTalk ? `${name} and their carer heard the rules with the group.` : `The house rules were discussed with ${name} and their carer.`}
      </label>
    </div>
  );
}

// ---------------------------------------------------------------------------
// After the stay exists
// ---------------------------------------------------------------------------

/**
 * What an admission records once the stay is saved: the typed-in
 * appointment (when asked), the group's talk (first of the group), and the
 * bed hold used. The rules are ticked by check_in itself (0068). Returns what could not be saved.
 */
export async function finishAdmission(input: {
  stayId: string;
  patientId: string;
  appointment: AppointmentDraft | null;
  rules: RulesDraft;
  group: ReturnType<typeof arrivalGroup>;
  groupTalkExists: boolean;
  arrived: { rideId: string | null; tripId: string | null } | null;
  hold: BedReservation | undefined;
  /** The bed they were checked into. */
  unitId: string;
}): Promise<string[]> {
  const ops = createClient().schema("ops");
  const problems: string[] = [];
  const a = input.appointment;
  if (a?.date) {
    const { error } = await ops.from("appointments").insert({
      id: crypto.randomUUID(),
      patient_id: input.patientId,
      date: a.date,
      time: a.time,
      clinic: a.clinic.trim(),
      purpose: "Follow-up",
      needs_transport: a.needsTransport,
      source: "manual",
    });
    if (error) problems.push(`the appointment (${error.message})`);
  }
  // The rules themselves are ticked on the stay by check_in (0068).
  if (input.group && input.rules.asGroup && !input.groupTalkExists) {
    const tripId = input.arrived?.tripId ?? input.group.tripId;
    const rideId = input.arrived?.rideId ?? input.group.rideId;
    const target = input.group.kind === "trip" ? { tripId } : { rideId };
    if (target.tripId || target.rideId) {
      await recordGroupOrientation(target).catch((e: Error) => problems.push(`the group's house rules (${e.message})`));
    }
  }
  if (input.hold) {
    const error = await closeReservation(input.hold, input.stayId, input.unitId);
    if (error) problems.push(`closing the bed reservation (${error}); release it on the floor plan`);
  }
  return problems;
}
