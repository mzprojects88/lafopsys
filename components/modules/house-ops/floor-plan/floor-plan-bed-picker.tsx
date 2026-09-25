"use client";

import * as React from "react";
import { toast } from "sonner";
import { useHouseLayout } from "@/lib/hooks/use-house-layout-collection";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";
import { useBedReservations } from "@/lib/hooks/use-bed-reservations";
import { useRole } from "@/lib/rbac/use-role";
import { canSeeClinicalDetail } from "@/lib/rbac/roles";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AssignableBed } from "@/lib/utils/beds";
import { buildBedViews } from "./bed-view";
import { FloorPlanCanvas } from "./floor-plan-canvas";

const noop = () => undefined;
const noDraft = () => undefined;

/**
 * Choose a bed on the house's floor plan (user, 2026-09-25: check-in and bed
 * assignment go through the plan). Tap a green bed to take it; an occupied
 * or locked bed says why not. `options` is the caller's list of beds this
 * admission may take (lib/utils/beds.ts assignableBeds), so the rules stay
 * in one place. The list below the plan covers beds not yet drawn on it.
 */
export function FloorPlanBedPicker({ value, onChange, options }: { value: string; onChange: (unitId: string) => void; options: AssignableBed[] }) {
  const { rooms, units, bedPositions, labels } = useHouseLayout();
  const { patients, carers, stays } = usePatientsData();
  const { role } = useRole();
  const { reservations } = useBedReservations();
  const beds = React.useMemo(
    () => buildBedViews({ units, rooms, bedPositions, stays, patients, carers, draftFor: noDraft, holds: reservations }),
    [units, rooms, bedPositions, stays, patients, carers, reservations]
  );
  const placed = beds.filter((b) => b.x !== null && b.y !== null);
  const allowed = React.useMemo(() => new Set(options.map((o) => o.unit.id)), [options]);
  const chosen = options.find((o) => o.unit.id === value);
  const unplaced = options.filter((o) => o.unit.x === null || o.unit.y === null).length;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-theme-xs text-muted-foreground">
        {options.length ? "Tap a green bed on the plan." : "No bed is free."}
        {chosen ? (
          <>
            {" "}
            Chosen: <b className="text-foreground">{chosen.label}</b>.
          </>
        ) : null}
      </p>
      {/* The plan is tall (portrait); inside a dialog it scrolls rather than stretching the dialog. */}
      <div className="max-h-[55vh] overflow-y-auto rounded-lg">
        <FloorPlanCanvas
          rooms={rooms}
          beds={placed}
          labels={labels}
          dirtyLabelIds={new Set()}
          selection={value ? { kind: "bed", id: value } : null}
          editing={false}
          canSeeClinical={canSeeClinicalDetail(role)}
          onSelect={(sel) => {
            if (sel?.kind !== "bed") return;
            if (allowed.has(sel.id)) return onChange(sel.id);
            const bed = beds.find((b) => b.id === sel.id);
            if (!bed) return;
            toast.info(`Bed ${bed.code} is not free${bed.bedStatus === "occupied" ? ": someone is in it" : bed.bedStatus === "reserved" ? `: reserved for ${bed.holds.map((h) => h.reservedFor).join(", ")}` : bed.bedStatus === "available" ? "" : `: ${bed.bedStatus}`}.`);
          }}
          onMove={noop}
          onDrop={noop}
          onResize={noop}
          onRotate={noop}
          onRetireRequest={noop}
          onMoveLabel={noop}
          onRotateLabel={noop}
          onDeleteLabel={noop}
          previews={false}
        />
      </div>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full" aria-label="Bed">
          <SelectValue placeholder={options.length ? "Or choose from the list" : "No beds available"} />
        </SelectTrigger>
        <SelectContent>
          {options.map((b) => (
            <SelectItem key={b.unit.id} value={b.unit.id}>
              {b.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {unplaced > 0 ? (
        <p className="text-theme-xs text-muted-foreground">
          {unplaced} free {unplaced === 1 ? "bed is" : "beds are"} not drawn on the plan yet; pick {unplaced === 1 ? "it" : "them"} from the list.
        </p>
      ) : null}
    </div>
  );
}
