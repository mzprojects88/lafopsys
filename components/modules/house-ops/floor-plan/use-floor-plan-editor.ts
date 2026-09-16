"use client";

import * as React from "react";
import type { LayoutChanges } from "@/lib/hooks/use-house-layout-collection";
import type { FloorPlanLabel, Unit } from "@/lib/types/house-ops";
import { LABEL_DEFAULTS } from "@/lib/types/house-ops";
import { diffLabels, isTmpLabelId, mergeLabels, sameLabel, type Pt } from "@/lib/utils/floor-plan-geometry";

/** The geometry an admin may change per bed while editing. */
export interface BedDraft {
  x: number | null;
  y: number | null;
  w: number;
  h: number;
  rotationDeg: number;
  roomId: string | null;
  capacity: number;
}

const DRAFT_KEYS: (keyof BedDraft)[] = ["x", "y", "w", "h", "rotationDeg", "roomId", "capacity"];

function draftOf(unit: Unit): BedDraft {
  return { x: unit.x, y: unit.y, w: unit.w, h: unit.h, rotationDeg: unit.rotationDeg, roomId: unit.roomId, capacity: unit.capacity };
}

function sameDraft(a: BedDraft, b: BedDraft): boolean {
  return DRAFT_KEYS.every((k) => a[k] === b[k]);
}

/**
 * Edit mode holds every change locally until "Save layout" -- a write per
 * drag would race the realtime echo. Beds and labels share one draft
 * lifecycle: the draft is an overlay on the live rows, so a refetch while
 * editing never loses unsaved work, and Discard drops all of it.
 */
export function useFloorPlanEditor() {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState<Map<string, BedDraft>>(() => new Map());
  const [labelDraft, setLabelDraft] = React.useState<Map<string, FloorPlanLabel>>(() => new Map());
  const [deletedLabelIds, setDeletedLabelIds] = React.useState<Set<string>>(() => new Set());

  // ---- beds ----

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

  // ---- labels ----

  const addLabel = React.useCallback((text: string, centre: Pt): string => {
    const id = `tmp-${crypto.randomUUID()}`;
    setLabelDraft((prev) => new Map(prev).set(id, { id, text, x: centre.x, y: centre.y, ...LABEL_DEFAULTS }));
    return id;
  }, []);

  const patchLabel = React.useCallback((base: FloorPlanLabel, patch: Partial<Omit<FloorPlanLabel, "id">>) => {
    setLabelDraft((prev) => {
      const next = new Map(prev);
      const merged = { ...(prev.get(base.id) ?? base), ...patch };
      if (!isTmpLabelId(base.id) && sameLabel(merged, base)) next.delete(base.id);
      else next.set(base.id, merged);
      return next;
    });
  }, []);

  const deleteLabel = React.useCallback((id: string) => {
    setLabelDraft((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    if (!isTmpLabelId(id)) setDeletedLabelIds((prev) => new Set(prev).add(id));
  }, []);

  /** What the canvas draws: live labels with the draft laid over, deleted hidden, added appended. */
  const labelsFor = React.useCallback(
    (live: FloorPlanLabel[]): FloorPlanLabel[] => mergeLabels(live, labelDraft, deletedLabelIds),
    [labelDraft, deletedLabelIds]
  );

  // ---- shared lifecycle ----

  const discard = React.useCallback(() => {
    setDraft(new Map());
    setLabelDraft(new Map());
    setDeletedLabelIds(new Set());
  }, []);

  /** Only what still exists, is live, and actually differs from what is saved. */
  const changesFor = React.useCallback(
    (units: Unit[], liveLabels: FloorPlanLabel[]): LayoutChanges => {
      const beds: LayoutChanges["beds"] = [];
      for (const [id, d] of draft) {
        const base = units.find((u) => u.id === id);
        if (!base || !base.active || sameDraft(d, draftOf(base))) continue;
        beds.push({ id, x: d.x, y: d.y, w: d.w, h: d.h, rotationDeg: d.rotationDeg, roomId: d.roomId, capacity: d.capacity });
      }
      return { beds, labels: diffLabels(liveLabels, labelDraft, deletedLabelIds) };
    },
    [draft, labelDraft, deletedLabelIds]
  );

  const markSaved = React.useCallback((ids: string[]) => {
    const gone = new Set(ids);
    setDraft((prev) => {
      const next = new Map(prev);
      for (const id of gone) next.delete(id);
      return next;
    });
    setLabelDraft((prev) => {
      const next = new Map(prev);
      for (const id of gone) next.delete(id);
      return next;
    });
    setDeletedLabelIds((prev) => {
      const next = new Set(prev);
      for (const id of gone) next.delete(id);
      return next;
    });
  }, []);

  return {
    editing,
    setEditing,
    draft,
    draftFor,
    applyPatch,
    addLabel,
    patchLabel,
    deleteLabel,
    labelsFor,
    discard,
    changesFor,
    markSaved,
  };
}
