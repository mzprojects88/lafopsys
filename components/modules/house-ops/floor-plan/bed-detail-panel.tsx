"use client";

import * as React from "react";
import { Lock, LockOpen, RotateCw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import type { Room } from "@/lib/types/house-ops";
import type { BedView } from "./bed-view";
import { BedSummary } from "./bed-summary";

const UNPLACED = "__unplaced__";

interface BedDetailPanelProps {
  bed: BedView | null;
  rooms: Room[];
  editing: boolean;
  canLock: boolean;
  canEdit: boolean;
  canSeeClinical: boolean;
  onClose: () => void;
  onLock: (bed: BedView) => void;
  onUnlock: (bed: BedView) => Promise<void>;
  onRotate: (bed: BedView, deltaDeg: number) => void;
  onSetRotation: (bed: BedView, deg: number) => void;
  onSetRoom: (bed: BedView, roomId: string | null) => void;
  onSetCapacity: (bed: BedView, capacity: number) => void;
  onRetire: (bed: BedView) => void;
}

/**
 * The selected bed, with the actions a role may take. Inline beside the
 * plan on desktop; a bottom sheet on phones, where hover does not exist.
 */
export function BedDetailPanel(props: BedDetailPanelProps) {
  const isMobile = useIsMobile();
  const { bed, onClose } = props;

  if (isMobile) {
    return (
      <Sheet open={!!bed} onOpenChange={(open) => !open && onClose()}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
          <SheetHeader className="sr-only">
            <SheetTitle>Bed {bed?.code}</SheetTitle>
            <SheetDescription>Bed details and actions</SheetDescription>
          </SheetHeader>
          {bed && <PanelBody {...props} bed={bed} />}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <aside className="flex flex-col gap-3 rounded-lg border p-4">
      {bed ? (
        <>
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Selected bed</span>
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
              <X className="size-4" />
            </Button>
          </div>
          <PanelBody {...props} bed={bed} />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Hover a bed for who is in it; click one for its details and actions.
        </p>
      )}
    </aside>
  );
}

function PanelBody({
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
  onSetRoom,
  onSetCapacity,
  onRetire,
}: BedDetailPanelProps & { bed: BedView }) {
  const [unlocking, setUnlocking] = React.useState(false);
  const [rotationText, setRotationText] = React.useState(String(bed.rotationDeg));

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirrors the bed's rotation into the field when it changes elsewhere (R key, drag)
    setRotationText(String(bed.rotationDeg));
  }, [bed.id, bed.rotationDeg]);

  function commitRotation() {
    const n = Number(rotationText);
    if (Number.isFinite(n)) onSetRotation(bed, n);
    else setRotationText(String(bed.rotationDeg));
  }

  return (
    <div className="flex flex-col gap-4">
      <BedSummary bed={bed} canSeeClinical={canSeeClinical} linkPatients />

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
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRotation();
                }}
                disabled={bed.x === null}
              />
            </Field>
            <Button variant="outline" size="sm" onClick={() => onRotate(bed, 90)} disabled={bed.x === null} title="Rotate 90° (R)">
              <RotateCw className="size-3.5" /> 90°
            </Button>
          </div>
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
