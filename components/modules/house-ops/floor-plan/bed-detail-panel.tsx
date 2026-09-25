"use client";

import * as React from "react";
import { toast } from "sonner";
import { Lock, LockOpen, RotateCw, Trash2 } from "lucide-react";
import { useBedReservations } from "@/lib/hooks/use-bed-reservations";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Room } from "@/lib/types/house-ops";
import { BED_DEFAULT_SIZE, PLAN_H, PLAN_W } from "@/lib/utils/floor-plan-geometry";
import type { BedView } from "./bed-view";
import { BedSummary } from "./bed-summary";

const UNPLACED = "__unplaced__";

interface BedDetailPanelProps {
  bed: BedView;
  rooms: Room[];
  editing: boolean;
  canLock: boolean;
  canEdit: boolean;
  canSeeClinical: boolean;
  onLock: (bed: BedView) => void;
  onUnlock: (bed: BedView) => Promise<void>;
  onRotate: (bed: BedView, deltaDeg: number) => void;
  onSetRotation: (bed: BedView, deg: number) => void;
  /** Width and length in plan units (px of the plan image); the view normalises and clamps. */
  onSetSize: (bed: BedView, wPx: number, hPx: number) => void;
  onSetRoom: (bed: BedView, roomId: string | null) => void;
  onSetCapacity: (bed: BedView, capacity: number) => void;
  onRetire: (bed: BedView) => void;
}

/** The selected bed, with the actions a role may take. */
export function BedDetailPanel({
  bed,
  rooms,
  editing,
  canLock,
  canEdit,
  canSeeClinical,
  onLock,
  onUnlock,
  onRotate,
  onSetRotation,
  onSetSize,
  onSetRoom,
  onSetCapacity,
  onRetire,
}: BedDetailPanelProps) {
  const [unlocking, setUnlocking] = React.useState(false);
  const [rotationText, setRotationText] = React.useState(String(bed.rotationDeg));
  const [wText, setWText] = React.useState(String(Math.round(bed.w * PLAN_W)));
  const [hText, setHText] = React.useState(String(Math.round(bed.h * PLAN_H)));

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirrors the bed into the fields when it changes elsewhere (R key, drag, handle)
    setRotationText(String(bed.rotationDeg));
    setWText(String(Math.round(bed.w * PLAN_W)));
    setHText(String(Math.round(bed.h * PLAN_H)));
  }, [bed.id, bed.rotationDeg, bed.w, bed.h]);

  function commitRotation() {
    const n = Number(rotationText);
    if (Number.isFinite(n)) onSetRotation(bed, n);
    else setRotationText(String(bed.rotationDeg));
  }

  function commitSize() {
    const w = Number(wText);
    const h = Number(hText);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) onSetSize(bed, w, h);
    else {
      setWText(String(Math.round(bed.w * PLAN_W)));
      setHText(String(Math.round(bed.h * PLAN_H)));
    }
  }

  const enterCommits = (commit: () => void) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") commit();
  };

  const isStandard = bed.w === BED_DEFAULT_SIZE.w && bed.h === BED_DEFAULT_SIZE.h;

  return (
    <div className="flex flex-col gap-4">
      <BedSummary bed={bed} canSeeClinical={canSeeClinical} linkPatients />

      {/* Any open hold can be released here, even once its child has left NCH's sheet. */}
      {canLock && bed.holds.length > 0 ? <ReleaseHolds bed={bed} /> : null}

      {canLock && (
        <div className="flex flex-wrap gap-2">
          {bed.status === "available" ? (
            <Button variant="outline" size="sm" onClick={() => onLock(bed)}>
              <Lock className="size-3.5" /> Lock for maintenance
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={unlocking}
                onClick={async () => {
                  setUnlocking(true);
                  await onUnlock(bed);
                  setUnlocking(false);
                }}
              >
                <LockOpen className="size-3.5" /> {unlocking ? "Unlocking…" : "Unlock"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onLock(bed)}>
                Change reason
              </Button>
            </>
          )}
        </div>
      )}

      {canEdit && editing && (
        <div className="flex flex-col gap-3 border-t pt-3">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Layout</span>
          <div className="flex items-end gap-2">
            <Field className="flex-1">
              <FieldLabel htmlFor="bed-rotation">Rotation (°)</FieldLabel>
              <Input
                id="bed-rotation"
                inputMode="numeric"
                value={rotationText}
                onChange={(e) => setRotationText(e.target.value)}
                onBlur={commitRotation}
                onKeyDown={enterCommits(commitRotation)}
                disabled={bed.x === null}
              />
            </Field>
            <Button variant="outline" size="sm" onClick={() => onRotate(bed, 90)} disabled={bed.x === null} title="Rotate 90° (R)">
              <RotateCw className="size-3.5" /> 90°
            </Button>
          </div>
          <div className="flex items-end gap-2">
            <Field className="flex-1">
              <FieldLabel htmlFor="bed-w">Width</FieldLabel>
              <Input
                id="bed-w"
                inputMode="numeric"
                value={wText}
                onChange={(e) => setWText(e.target.value)}
                onBlur={commitSize}
                onKeyDown={enterCommits(commitSize)}
                disabled={bed.x === null}
              />
            </Field>
            <Field className="flex-1">
              <FieldLabel htmlFor="bed-h">Length</FieldLabel>
              <Input
                id="bed-h"
                inputMode="numeric"
                value={hText}
                onChange={(e) => setHText(e.target.value)}
                onBlur={commitSize}
                onKeyDown={enterCommits(commitSize)}
                disabled={bed.x === null}
              />
            </Field>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onSetSize(bed, BED_DEFAULT_SIZE.w * PLAN_W, BED_DEFAULT_SIZE.h * PLAN_H)}
              disabled={bed.x === null || isStandard}
              title={`${Math.round(BED_DEFAULT_SIZE.w * PLAN_W)} x ${Math.round(BED_DEFAULT_SIZE.h * PLAN_H)}`}
            >
              Standard
            </Button>
          </div>
          <FieldDescription className="-mt-2">Plan units; drag the corner handle on the bed to size it by eye.</FieldDescription>
          <Field>
            <FieldLabel htmlFor="bed-room-select">Room</FieldLabel>
            <Select value={bed.roomId ?? UNPLACED} onValueChange={(v) => onSetRoom(bed, v === UNPLACED ? null : v)}>
              <SelectTrigger id="bed-room-select" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {rooms.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
                <SelectItem value={UNPLACED}>Unplaced</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="bed-capacity">Admission slots</FieldLabel>
            <Select value={String(bed.capacity)} onValueChange={(v) => onSetCapacity(bed, Number(v))}>
              <SelectTrigger id="bed-capacity" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} {n === 1 ? "patient + carer" : "patients"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {bed.occupants.length > bed.capacity && (
              <span className="text-xs text-amber-700">More people are in this bed than it now holds; it shows as occupied.</span>
            )}
          </Field>
          <Button variant="destructive" size="sm" onClick={() => onRetire(bed)} className="self-start">
            <Trash2 className="size-3.5" /> Retire bed
          </Button>
        </div>
      )}
    </div>
  );
}

function ReleaseHolds({ bed }: { bed: BedView }) {
  const { release } = useBedReservations();
  const [busy, setBusy] = React.useState<string | null>(null);
  return (
    <div className="flex flex-wrap gap-2">
      {bed.holds.map((h) => (
        <Button
          key={h.id}
          variant="outline"
          size="sm"
          disabled={busy === h.id}
          onClick={async () => {
            setBusy(h.id);
            const r = await release(h.id);
            setBusy(null);
            if (r.ok) toast.success(`Bed ${bed.code} is free again.`);
            else toast.error(r.error);
          }}
        >
          Release {h.reservedFor}&apos;s reservation
        </Button>
      ))}
    </div>
  );
}
