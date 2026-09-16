"use client";

import { MapPinOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { compareBedCodes } from "@/lib/utils/beds";
import type { BedView } from "./bed-view";
import { STATUS_FILL, STATUS_STROKE } from "./bed-view";

interface UnplacedTrayProps {
  beds: BedView[];
  editing: boolean;
  selectedId: string | null;
  onPlace: (bed: BedView) => void;
  onSelect: (id: string) => void;
}

/** Beds with no position yet. In edit mode a click drops the bed into the
 * first room so it can be dragged; otherwise a click opens its details. */
export function UnplacedTray({ beds, editing, selectedId, onPlace, onSelect }: UnplacedTrayProps) {
  if (beds.length === 0) return null;
  const sorted = beds.slice().sort((a, b) => compareBedCodes(a.code, b.code));
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <MapPinOff className="size-3.5" />
        Unplaced beds
        <span className="text-muted-foreground/70">
          — {editing ? "click one to put it on the plan, then drag it into place" : "not on the plan yet; still bookable"}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {sorted.map((bed) => (
          <button
            key={bed.id}
            type="button"
            onClick={() => (editing ? onPlace(bed) : onSelect(bed.id))}
            className={cn(
              "rounded-md border-2 px-3 py-1.5 text-sm font-semibold text-slate-900 transition hover:brightness-95",
              selectedId === bed.id && "ring-2 ring-slate-900 ring-offset-1"
            )}
            style={{ backgroundColor: STATUS_FILL[bed.bedStatus], borderColor: STATUS_STROKE[bed.bedStatus] }}
            title={editing ? `Place ${bed.code} on the plan` : `Bed ${bed.code}`}
          >
            {bed.code}
          </button>
        ))}
      </div>
    </div>
  );
}
