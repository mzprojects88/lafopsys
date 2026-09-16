"use client";

import * as React from "react";
import { toast } from "sonner";
import { countLayoutChanges, useHouseLayout } from "@/lib/hooks/use-house-layout-collection";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";
import { useRole } from "@/lib/rbac/use-role";
import { canEditFloorPlan, canLockBeds, canSeeClinicalDetail } from "@/lib/rbac/roles";
import { bedCounts } from "@/lib/utils/beds";
import {
  PLAN_H,
  PLAN_W,
  clampCentre,
  clampSize,
  isTmpLabelId,
  normalizeRotation,
  nextBedCode,
  roomAtPoint,
  roomCentroid,
  round5,
  type Pt,
} from "@/lib/utils/floor-plan-geometry";
import type { FloorPlanLabel, UnitStatus } from "@/lib/types/house-ops";
import { buildBedViews, type BedView } from "./bed-view";
import { useFloorPlanEditor } from "./use-floor-plan-editor";
import { FloorPlanToolbar } from "./floor-plan-toolbar";
import { FloorPlanLegend } from "./floor-plan-legend";
import { UnplacedTray } from "./unplaced-tray";
import { FloorPlanCanvas, type Selection } from "./floor-plan-canvas";
import { DetailPanelShell } from "./detail-panel-shell";
import { BedDetailPanel } from "./bed-detail-panel";
import { LabelDetailPanel } from "./label-detail-panel";
import { LockBedDialog } from "./lock-bed-dialog";
import { AddBedDialog } from "./add-bed-dialog";
import { AddLabelDialog } from "./add-label-dialog";
import { RetireBedDialog } from "./retire-bed-dialog";

/**
 * House Operations > Floor Plan. The beds live in ops.units (0047) and the
 * captions in ops.floor_plan_labels (0048); who is in a bed comes from
 * ops.stays; all of it arrives live. Admins draw the layout in edit mode
 * and save it in one go; house staff lock beds; everyone hovers.
 */
export function FloorPlanView() {
  const { role } = useRole();
  const { rooms, units, bedPositions, labels, loading, saveLayout, setBedStatus, createBed, retireBed } = useHouseLayout();
  const { patients, carers, stays } = usePatientsData();
  const editor = useFloorPlanEditor();

  const [selection, setSelection] = React.useState<Selection>(null);
  const [saving, setSaving] = React.useState(false);
  const [lockTarget, setLockTarget] = React.useState<BedView | null>(null);
  const [retireTarget, setRetireTarget] = React.useState<BedView | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [addingLabel, setAddingLabel] = React.useState(false);

  const canEdit = canEditFloorPlan(role);
  const canLock = canLockBeds(role);
  const canSeeClinical = canSeeClinicalDetail(role);
  const editing = canEdit && editor.editing;

  const beds = React.useMemo(
    () => buildBedViews({ units, rooms, bedPositions, stays, patients, carers, draftFor: editor.draftFor }),
    [units, rooms, bedPositions, stays, patients, carers, editor.draftFor]
  );
  const drawnLabels = React.useMemo(() => editor.labelsFor(labels), [editor, labels]);
  const placed = beds.filter((b) => b.x !== null && b.y !== null);
  const unplaced = beds.filter((b) => b.x === null || b.y === null);
  const selectedBed = selection?.kind === "bed" ? (beds.find((b) => b.id === selection.id) ?? null) : null;
  const selectedLabel = selection?.kind === "label" ? (drawnLabels.find((l) => l.id === selection.id) ?? null) : null;
  const counts = React.useMemo(() => bedCounts(units, bedPositions, stays), [units, bedPositions, stays]);
  const changes = editor.changesFor(units, labels);
  const dirtyCount = countLayoutChanges(changes);
  const dirty = dirtyCount > 0;
  const dirtyLabelIds = React.useMemo(
    () => new Set([...changes.labels.insertTmpIds, ...changes.labels.updates.map((l) => l.id)]),
    [changes.labels.insertTmpIds, changes.labels.updates]
  );

  // Unsaved layout survives a refetch, not a page reload.
  React.useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // A selection that no longer exists (label deleted, bed retired) is dropped.
  React.useEffect(() => {
    if (!selection) return;
    const exists = selection.kind === "bed" ? beds.some((b) => b.id === selection.id) : drawnLabels.some((l) => l.id === selection.id);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reconciling the selection with data that changed underneath it
    if (!exists) setSelection(null);
  }, [selection, beds, drawnLabels]);

  function baseOf(bed: BedView) {
    return units.find((u) => u.id === bed.id);
  }

  // ---- beds ----

  function handleMove(bed: BedView, centre: Pt) {
    const base = baseOf(bed);
    if (base) editor.applyPatch(base, { x: centre.x, y: centre.y });
  }

  function handleDrop(bed: BedView, centre: Pt) {
    const base = baseOf(bed);
    if (!base) return;
    editor.applyPatch(base, { x: centre.x, y: centre.y, roomId: roomAtPoint(rooms, centre) });
  }

  function handleResize(bed: BedView, w: number, h: number, centre: Pt) {
    const base = baseOf(bed);
    if (base) editor.applyPatch(base, { w, h, x: centre.x, y: centre.y });
  }

  /** From the panel fields, in plan units. */
  function handleSetSize(bed: BedView, wPx: number, hPx: number) {
    const base = baseOf(bed);
    if (!base || bed.x === null || bed.y === null) return;
    const w = round5(clampSize(wPx / PLAN_W));
    const h = round5(clampSize(hPx / PLAN_H));
    const centre = clampCentre({ x: bed.x, y: bed.y }, w, h, bed.rotationDeg);
    editor.applyPatch(base, { w, h, x: centre.x, y: centre.y });
  }

  function handleRotate(bed: BedView, delta: number) {
    const base = baseOf(bed);
    if (base) editor.applyPatch(base, { rotationDeg: normalizeRotation(bed.rotationDeg + delta) });
  }

  function handleSetRotation(bed: BedView, deg: number) {
    const base = baseOf(bed);
    if (base) editor.applyPatch(base, { rotationDeg: normalizeRotation(deg) });
  }

  function handleSetRoom(bed: BedView, roomId: string | null) {
    const base = baseOf(bed);
    if (!base) return;
    if (roomId === null) {
      editor.applyPatch(base, { roomId: null, x: null, y: null });
      return;
    }
    const room = rooms.find((r) => r.id === roomId);
    const inRoom = bed.x !== null && bed.y !== null && roomAtPoint(rooms, { x: bed.x, y: bed.y }) === roomId;
    const centre = inRoom || !room?.bounds ? null : roomCentroid(room.bounds);
    editor.applyPatch(base, centre ? { roomId, x: centre.x, y: centre.y } : { roomId });
  }

  function handleSetCapacity(bed: BedView, capacity: number) {
    const base = baseOf(bed);
    if (base) editor.applyPatch(base, { capacity });
  }

  function handlePlace(bed: BedView) {
    const base = baseOf(bed);
    if (!base) return;
    const room = rooms.find((r) => r.bounds) ?? null;
    const centre = room?.bounds ? roomCentroid(room.bounds) : { x: 0.5, y: 0.5 };
    editor.applyPatch(base, { x: centre.x, y: centre.y, roomId: room?.id ?? null });
    setSelection({ kind: "bed", id: bed.id });
  }

  // ---- labels ----

  function handleAddLabel(text: string) {
    const room = rooms.find((r) => r.bounds) ?? null;
    const centre = room?.bounds ? roomCentroid(room.bounds) : { x: 0.5, y: 0.5 };
    const id = editor.addLabel(text, centre);
    setAddingLabel(false);
    setSelection({ kind: "label", id });
  }

  function handleMoveLabel(label: FloorPlanLabel, centre: Pt) {
    editor.patchLabel(label, { x: round5(centre.x), y: round5(centre.y) });
  }

  function handlePatchLabel(label: FloorPlanLabel, patch: Partial<Omit<FloorPlanLabel, "id">>) {
    editor.patchLabel(label, patch);
  }

  function handleRotateLabel(label: FloorPlanLabel, delta: number) {
    editor.patchLabel(label, { rotationDeg: normalizeRotation(label.rotationDeg + delta) });
  }

  function handleDeleteLabel(label: FloorPlanLabel) {
    editor.deleteLabel(label.id);
    if (selection?.kind === "label" && selection.id === label.id) setSelection(null);
  }

  // ---- save / discard ----

  async function handleSave() {
    setSaving(true);
    const result = await saveLayout(changes);
    setSaving(false);
    const allIds = [
      ...changes.beds.map((c) => c.id),
      ...changes.labels.insertTmpIds,
      ...changes.labels.updates.map((l) => l.id),
      ...changes.labels.deletes,
    ];
    const labelCount = changes.labels.inserts.length + changes.labels.updates.length + changes.labels.deletes.length;
    if (result.ok) {
      editor.markSaved(allIds);
      if (selection?.kind === "label" && isTmpLabelId(selection.id)) setSelection(null);
      toast.success(
        `Layout saved (${[
          changes.beds.length ? `${changes.beds.length} bed${changes.beds.length === 1 ? "" : "s"}` : null,
          labelCount ? `${labelCount} label${labelCount === 1 ? "" : "s"}` : null,
        ]
          .filter(Boolean)
          .join(", ")})`
      );
    } else {
      editor.markSaved(allIds.filter((id) => !result.failedIds.includes(id)));
      toast.error(`${result.failedIds.length} change${result.failedIds.length === 1 ? "" : "s"} not saved: ${result.error}`);
    }
  }

  function handleDiscard() {
    editor.discard();
    if (selection?.kind === "label" && isTmpLabelId(selection.id)) setSelection(null);
  }

  function handleToggleEdit() {
    if (editing && dirty && !window.confirm("Discard the unsaved layout changes?")) return;
    if (editing) handleDiscard();
    editor.setEditing(!editing);
  }

  // ---- locks, add, retire ----

  async function handleLock(status: Exclude<UnitStatus, "available">, reason: string) {
    if (!lockTarget) return;
    const result = await setBedStatus(lockTarget.id, status, reason);
    if (result.ok) {
      toast.success(`Bed ${lockTarget.code} locked`);
      setLockTarget(null);
    } else {
      toast.error(`Couldn't lock the bed: ${result.error}`);
    }
  }

  async function handleUnlock(bed: BedView) {
    const result = await setBedStatus(bed.id, "available", null);
    if (result.ok) toast.success(`Bed ${bed.code} is available again`);
    else toast.error(`Couldn't unlock the bed: ${result.error}`);
  }

  async function handleAdd(input: { code: string; roomId: string | null }) {
    const room = input.roomId ? rooms.find((r) => r.id === input.roomId) : undefined;
    const centre = room?.bounds ? roomCentroid(room.bounds) : null;
    const result = await createBed({ code: input.code, roomId: input.roomId, x: centre?.x ?? null, y: centre?.y ?? null });
    if (result.ok) {
      toast.success(`Bed ${input.code} added`);
      setAdding(false);
      if (result.id) setSelection({ kind: "bed", id: result.id });
    } else {
      toast.error(`Couldn't add the bed: ${result.error}`);
    }
  }

  async function handleRetire() {
    if (!retireTarget) return;
    const result = await retireBed(retireTarget.id);
    if (result.ok) {
      toast.success(`Bed ${retireTarget.code} retired`);
      if (selection?.kind === "bed" && selection.id === retireTarget.id) setSelection(null);
      setRetireTarget(null);
    } else {
      toast.error(`Couldn't retire the bed: ${result.error}`);
    }
  }

  const panelOpen = Boolean(selectedBed || selectedLabel);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FloorPlanLegend counts={counts} />
        <FloorPlanToolbar
          canEdit={canEdit}
          editing={editing}
          dirtyCount={dirtyCount}
          saving={saving}
          onToggleEdit={handleToggleEdit}
          onSave={handleSave}
          onDiscard={handleDiscard}
          onAddBed={() => setAdding(true)}
          onAddLabel={() => setAddingLabel(true)}
        />
      </div>

      {!loading && beds.length === 0 && <p className="text-sm text-muted-foreground">No beds on record yet.</p>}

      <UnplacedTray
        beds={unplaced}
        editing={editing}
        selectedId={selection?.kind === "bed" ? selection.id : null}
        onPlace={handlePlace}
        onSelect={(id) => setSelection({ kind: "bed", id })}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <FloorPlanCanvas
          rooms={rooms}
          beds={placed}
          labels={drawnLabels}
          dirtyLabelIds={dirtyLabelIds}
          selection={selection}
          editing={editing}
          canSeeClinical={canSeeClinical}
          onSelect={setSelection}
          onMove={handleMove}
          onDrop={handleDrop}
          onResize={handleResize}
          onRotate={handleRotate}
          onRetireRequest={(bed) => setRetireTarget(bed)}
          onMoveLabel={handleMoveLabel}
          onRotateLabel={handleRotateLabel}
          onDeleteLabel={handleDeleteLabel}
        />
        <DetailPanelShell
          open={panelOpen}
          title={selectedBed ? `Bed ${selectedBed.code}` : selectedLabel ? `Label ${selectedLabel.text}` : ""}
          kicker={selectedLabel ? "Selected label" : "Selected bed"}
          placeholder="Hover a bed for who is in it; click a bed or a label for its details and actions."
          onClose={() => setSelection(null)}
        >
          {selectedBed && (
            <BedDetailPanel
              bed={selectedBed}
              rooms={rooms}
              editing={editing}
              canLock={canLock}
              canEdit={canEdit}
              canSeeClinical={canSeeClinical}
              onLock={(bed) => setLockTarget(bed)}
              onUnlock={handleUnlock}
              onRotate={handleRotate}
              onSetRotation={handleSetRotation}
              onSetSize={handleSetSize}
              onSetRoom={handleSetRoom}
              onSetCapacity={handleSetCapacity}
              onRetire={(bed) => setRetireTarget(bed)}
            />
          )}
          {selectedLabel && (
            <LabelDetailPanel
              label={selectedLabel}
              editing={editing}
              dirty={dirtyLabelIds.has(selectedLabel.id)}
              onPatch={handlePatchLabel}
              onRotate={handleRotateLabel}
              onDelete={handleDeleteLabel}
            />
          )}
        </DetailPanelShell>
      </div>

      <LockBedDialog bed={lockTarget} onOpenChange={(open) => !open && setLockTarget(null)} onConfirm={handleLock} />
      <AddBedDialog
        open={adding}
        suggestedCode={nextBedCode(units.map((u) => u.code))}
        rooms={rooms}
        onOpenChange={setAdding}
        onConfirm={handleAdd}
      />
      <AddLabelDialog open={addingLabel} onOpenChange={setAddingLabel} onConfirm={handleAddLabel} />
      <RetireBedDialog bed={retireTarget} onOpenChange={(open) => !open && setRetireTarget(null)} onConfirm={handleRetire} />
    </div>
  );
}
