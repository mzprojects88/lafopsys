"use client";

import * as React from "react";
import { toast } from "sonner";
import { useHouseLayout } from "@/lib/hooks/use-house-layout-collection";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";
import { useBedReservations } from "@/lib/hooks/use-bed-reservations";
import { useRole } from "@/lib/rbac/use-role";
import { canSeeClinicalDetail } from "@/lib/rbac/roles";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AssignableBed } from "@/lib/utils/beds";
import { occupantsOf, roomSex, type BlockedBed } from "@/lib/utils/bed-rules";
import { cn } from "@/lib/utils";
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
 * `blocked` are free beds the bed rules keep this person off (0070): tapping
 * one says why; the rooms line says who each room is for right now.
 * On a phone the list comes first and the plan opens on a tap: the plan's
 * beds are too small to hit there (walkthrough, 2026-09-28).
 */
export function FloorPlanBedPicker({
  value,
  onChange,
  options,
  blocked = [],
}: {
  value: string;
  onChange: (unitId: string) => void;
  options: AssignableBed[];
  blocked?: BlockedBed[];
}) {
  const { rooms, units, bedPositions, labels, loading: layoutLoading } = useHouseLayout();
  const { patients, carers, stays, loading: patientsLoading } = usePatientsData();
  const { roles } = useRole();
  const { reservations, loading: holdsLoading } = useBedReservations();
  const loading = layoutLoading || patientsLoading || holdsLoading;
  const [showPlan, setShowPlan] = React.useState(false);
  const beds = React.useMemo(
    () => buildBedViews({ units, rooms, bedPositions, stays, patients, carers, draftFor: noDraft, holds: reservations }),
    [units, rooms, bedPositions, stays, patients, carers, reservations]
  );
  const placed = beds.filter((b) => b.x !== null && b.y !== null);
  const allowed = React.useMemo(() => new Set(options.map((o) => o.unit.id)), [options]);
  const chosen = options.find((o) => o.unit.id === value);
  const unplaced = options.filter((o) => o.unit.x === null || o.unit.y === null).length;
  const roomsNow = React.useMemo(() => {
    const occ = occupantsOf(units, bedPositions, stays, carers, patients, reservations);
    return [...rooms].sort((a, b) => a.sortOrder - b.sortOrder).map((r) => ({ room: r, sex: roomSex(r.id, occ) }));
  }, [rooms, units, bedPositions, stays, carers, patients, reservations]);

  if (loading) return <p className="rounded-lg bg-muted/60 px-3 py-6 text-center text-theme-xs text-muted-foreground">Loading the floor plan…</p>;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-theme-xs text-muted-foreground">
        {options.length ? <span className="hidden sm:inline">Tap a green bed on the plan, or choose from the list.</span> : "No bed is free."}
        {chosen ? (
          <>
            {" "}
            Chosen: <b className="text-foreground">{chosen.label}</b>.
          </>
        ) : null}
      </p>
      <Button type="button" variant="outline" size="sm" className="w-fit sm:hidden" onClick={() => setShowPlan((v) => !v)}>
        {showPlan ? "Hide the floor plan" : "Show the floor plan"}
      </Button>
      {/* Inside a dialog the plan scrolls rather than stretching the dialog. */}
      <div className={cn("max-h-[55vh] overflow-y-auto rounded-lg", showPlan ? "block" : "hidden sm:block")}>
        <FloorPlanCanvas
          rooms={rooms}
          beds={placed}
          labels={labels}
          dirtyLabelIds={new Set()}
          selection={value ? { kind: "bed", id: value } : null}
          editing={false}
          canSeeClinical={canSeeClinicalDetail(roles)}
          onSelect={(sel) => {
            if (sel?.kind !== "bed") return;
            if (allowed.has(sel.id)) return onChange(sel.id);
            const rule = blocked.find((b) => b.unit.id === sel.id);
            if (rule) return toast.info(`Bed ${rule.unit.code}: ${rule.reason}.`);
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
      <p className="flex flex-wrap gap-1.5 text-theme-xs">
        {roomsNow.map(({ room, sex }) => (
          <span
            key={room.id}
            className={cn(
              "rounded-full px-2 py-0.5",
              sex === "mixed" ? "bg-warning/15 text-warning-foreground dark:text-warning" : "bg-muted text-muted-foreground"
            )}
          >
            {room.name} · {sex === "F" ? "Women's" : sex === "M" ? "Men's" : sex === "mixed" ? "Mixed" : "Open"}
          </span>
        ))}
      </p>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="order-first w-full sm:order-none" aria-label="Bed">
          <SelectValue placeholder={options.length ? "Choose a bed from the list" : "No beds available"} />
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
