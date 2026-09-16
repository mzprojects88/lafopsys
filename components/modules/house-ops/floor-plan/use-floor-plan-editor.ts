"use client";

import * as React from "react";
import type { BedLayoutChange } from "@/lib/hooks/use-house-layout-collection";
import type { Unit } from "@/lib/types/house-ops";

/** The geometry an admin may change per bed while editing. */
export interface BedDraft {
  x: number | null;
  y: number | null;
  rotationDeg: number;
  roomId: string | null;
  capacity: number;
}

const DRAFT_KEYS: (keyof BedDraft)[] = ["x", "y", "rotationDeg", "roomId", "capacity"];

function draftOf(unit: Unit): BedDraft {
  return { x: unit.x, y: unit.y, rotationDeg: unit.rotationDeg, roomId: unit.roomId, capacity: unit.capacity };
}

function sameDraft(a: BedDraft, b: BedDraft): boolean {
  return DRAFT_KEYS.every((k) => a[k] === b[k]);
}

/**
 * Edit mode holds every change locally until "Save layout" -- a write per
 * drag would race the realtime echo. The draft is an overlay on the live
 * rows, so a refetch while editing never loses unsaved work.
 */
export function useFloorPlanEditor() {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState<Map<string, BedDraft>>(() => new Map());

  const applyPatch = React.useCallback((base: Unit, patch: Partial<BedDraft>) => {
    setDraft((prev) => {
      const next = new Map(prev);
      const current = prev.get(base.id) ?? draftOf(base);
      const merged = { ...current, ...patch };
      if (sameDraft(merged, draftOf(base))) next.delete(base.id);
      else next.set(base.id, merged);
      return next;
    });
  }, []);

  const draftFor = React.useCallback((unit: Unit): BedDraft | undefined => draft.get(unit.id), [draft]);

  const discard = React.useCallback(() => setDraft(new Map()), []);

  /** Only beds that still exist, are live, and actually differ from what is saved. */
  const changesFor = React.useCallback(
    (units: Unit[]): BedLayoutChange[] => {
      const out: BedLayoutChange[] = [];
      for (const [id, d] of draft) {
        const base = units.find((u) => u.id === id);
        if (!base || !base.active || sameDraft(d, draftOf(base))) continue;
        out.push({ id, x: d.x, y: d.y, rotationDeg: d.rotationDeg, roomId: d.roomId, capacity: d.capacity });
      }
      return out;
    },
    [draft]
  );

  const markSaved = React.useCallback((ids: string[]) => {
    setDraft((prev) => {
      const next = new Map(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, []);

  return { editing, setEditing, draft, draftFor, applyPatch, discard, changesFor, markSaved };
}
