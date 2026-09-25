"use client";

import Link from "next/link";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { Lock, MapPinOff, UserRound, Users } from "lucide-react";
import { StatusBadge } from "@/components/patterns/status-badge";
import { useDiagnosesReferenceData } from "@/lib/hooks/use-diagnoses-reference-collection";
import { useStaffRoster } from "@/lib/hooks/use-staff-roster";
import { computeAge } from "@/lib/utils/age";
import { formatDate, todayIso } from "@/lib/utils/date";
import type { BedView } from "./bed-view";
import { STATUS_LABEL } from "./bed-view";

interface BedSummaryProps {
  bed: BedView;
  /** Finance and Board never see diagnosis or a carer's number. */
  canSeeClinical: boolean;
  /** Patient names link to the record (the hover card keeps them plain). */
  linkPatients?: boolean;
}

/** What a bed says about itself -- the hover card and the detail panel share it. */
export function BedSummary({ bed, canSeeClinical, linkPatients = false }: BedSummaryProps) {
  const { rows: diagnoses } = useDiagnosesReferenceData();
  const { staff } = useStaffRoster();
  const lockedBy = bed.statusChangedBy ? staff.find((s) => s.id === bed.statusChangedBy) : undefined;
  const today = todayIso();
  const locked = bed.status !== "available";

  return (
    <div className="flex flex-col gap-2.5 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-base font-semibold">Bed {bed.code}</span>
          <span className="text-xs text-muted-foreground">
            {bed.room ? bed.room.name : "Not yet placed on the plan"}
            {bed.capacity > 1 ? ` · ${bed.capacity} slots` : ""}
          </span>
        </div>
        <StatusBadge domain="unit" status={bed.bedStatus} label={STATUS_LABEL[bed.bedStatus]} />
      </div>

      {locked && (
        <div className="flex flex-col gap-0.5 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs dark:border-amber-500/30 dark:bg-amber-500/10">
          <span className="flex items-center gap-1 font-medium">
            <Lock className="size-3" /> {STATUS_LABEL[bed.status]}
          </span>
          {bed.lockReason && <span>{bed.lockReason}</span>}
          {bed.statusChangedAt && (
            <span className="text-muted-foreground">
              Since {formatDate(bed.statusChangedAt)}
              {lockedBy ? ` · ${lockedBy.firstName} ${lockedBy.lastName}` : ""}
            </span>
          )}
          {bed.occupants.length > 0 && (
            <span className="text-amber-800 dark:text-amber-300">Still checked in; transfer or discharge to free the bed.</span>
          )}
        </div>
      )}

      {bed.holds.map((h) => (
        <p key={h.id} className="rounded-md border border-violet-200 bg-violet-50 p-2 text-xs dark:border-violet-500/30 dark:bg-violet-500/10">
          Reserved for <b>{h.reservedFor}</b>, expected {formatDate(h.expectedOn)}. Not checked in yet.
        </p>
      ))}

      {bed.occupants.length === 0 && bed.holds.length === 0 && !locked && (
        <p className="text-xs text-muted-foreground">Ready for admission.</p>
      )}

      {bed.occupants.map(({ stay, patient, carer }) => {
        const name = patient ? `${patient.firstName} ${patient.lastName}` : "Unknown patient";
        const age = patient?.birthDate ? computeAge(patient.birthDate, today) : undefined;
        const diagnosis = patient?.diagnosisIds
          .map((id) => diagnoses.find((d) => d.id === id)?.name)
          .filter(Boolean)
          .join(", ");
        const days = Math.max(0, differenceInCalendarDays(parseISO(today), parseISO(stay.checkInAt)));
        return (
          <div key={stay.id} className="flex flex-col gap-1 rounded-md border p-2">
            <div className="flex items-start gap-2">
              <UserRound className="mt-0.5 size-3.5 shrink-0 text-blue-600" />
              <div className="flex min-w-0 flex-col">
                {linkPatients && patient ? (
                  <Link href={`/patients/${patient.id}`} className="truncate font-medium hover:underline">
                    {name}
                  </Link>
                ) : (
                  <span className="truncate font-medium">{name}</span>
                )}
                <span className="text-xs text-muted-foreground">
                  {[patient?.patientNumber, age !== undefined ? `${age} y/o` : null, patient?.sex].filter(Boolean).join(" · ")}
                </span>
                {canSeeClinical && diagnosis && <span className="text-xs text-muted-foreground">{diagnosis}</span>}
              </div>
            </div>
            {carer && (
              <div className="flex items-start gap-2">
                <Users className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate">{carer.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {[carer.relationship, canSeeClinical ? carer.mobileNumber : null].filter(Boolean).join(" · ") || "Carer"}
                  </span>
                </div>
              </div>
            )}
            <span className="text-xs text-muted-foreground">
              In since {formatDate(stay.checkInAt)} · {days} day{days === 1 ? "" : "s"}
              {stay.expectedCheckoutAt ? ` · out ${formatDate(stay.expectedCheckoutAt)}` : ""}
              {stay.status === "overdue" ? " · overdue" : ""}
            </span>
          </div>
        );
      })}

      {bed.x === null && (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <MapPinOff className="size-3" /> An admin places this bed from the Unplaced tray.
        </p>
      )}
    </div>
  );
}
