"use client";

import * as React from "react";
import { toast } from "sonner";
import { useHouseLayout } from "@/lib/hooks/use-house-layout-collection";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";
import { useRole } from "@/lib/rbac/use-role";
import { canEditFloorPlan, canLockBeds, canSeeClinicalDetail } from "@/lib/rbac/roles";
import { bedCounts } from "@/lib/utils/beds";
import { normalizeRotation, nextBedCode, roomAtPoint, roomCentroid, type Pt } from "@/lib/utils/floor-plan-geometry";
import type { UnitStatus } from "@/lib/types/house-ops";
import { buildBedViews, type BedView } from "./bed-view";
import { useFloorPlanEditor } from "./use-floor-plan-editor";
import { FloorPlanToolbar } from "./floor-plan-toolbar";
import { FloorPlanLegend } from "./floor-plan-legend";
import { UnplacedTray } from "./unplaced-tray";
import { FloorPlanCanvas } from "./floor-plan-canvas";
import { BedDetailPanel } from "./bed-detail-panel";
import { LockBedDialog } from "./lock-bed-dialog";
import { AddBedDialog } from "./add-bed-dialog";
import { RetireBedDialog } from "./retire-bed-dialog";

/**
 * House Operations > Floor Plan. The beds live in ops.units (0047); who is
 * in them comes from ops.stays; both arrive live. Admins draw the layout in
 * edit mode and save it in one go; house staff lock beds; everyone hovers.
 */
export function FloorPlanView() {
  const { role } = useRole();
  const { rooms, units, bedPositions, loading, saveLayout, setBedStatus, createBed, retireBed } = useHouseLayout();
  const { patients, carers, stays } = usePatientsData();
  const editor = useFloorPlanEditor();

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [lockTarget, setLockTarget] = React.useState<BedView | null>(null);
  const [retireTarget, setRetireTarget] = React.useState<BedView | null>(null);
  const [adding, setAdding] = React.useState(false);

  const canEdit = canEditFloorPlan(role);
  const canLock = canLockBeds(role);
  const canSeeClinical = canSeeClinicalDetail(role);
  const editing = canEdit && editor.editing;

  const beds = React.useMemo(
    () => buildBedViews({ units, rooms, bedPositions, stays, patients, carers, draftFor: editor.draftFor }),
    [units, rooms, bedPositions, stays, patients, carers, editor.draftFor]
  );
  const placed = beds.filter((b) => b.x !== null && b.y !== null);
  const unplaced = beds.filter((b) => b.x === null || b.y === null);
  const selected = beds.find((b) => b.id === selectedId) ?? null;
  const counts = React.useMemo(() => bedCounts(units, bedPositions, stays), [units, bedPositions, stays]);
  const changes = editor.changesFor(units);
  const dirty = changes.length > 0;

  // Unsaved layout survives a refetch, not a page reload.
  React.useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function baseOf(bed: BedView) {
    return units.find((u) => u.id === bed.id);
  }

  function handleMove(bed: BedView, centre: Pt) {
    const base = baseOf(bed);
    if (base) editor.applyPatch(base, { x: centre.x, y: centre.y });
  }

  function handleDrop(bed: BedView, centre: Pt) {
    const base = baseOf(bed);
    if (!base) return;
    editor.applyPatch(base, { x: centre.x, y: centre.y, roomId: roomAtPoint(rooms, centre) });
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
    setSelectedId(bed.id);
  }

  async function handleSave() {
    setSaving(true);
    const result = await saveLayout(changes);
    setSaving(false);
    if (result.ok) {
      editor.markSaved(changes.map((c) => c.id));
      toast.success(`Layout saved (${changes.length} bed${changes.length === 1 ? "" : "s"})`);
    } else {
      editor.markSaved(changes.map((c) => c.id).filter((id) => !result.failedIds.includes(id)));
      toast.error(`${result.failedIds.length} bed${result.failedIds.length === 1 ? "" : "s"} not saved: ${result.error}`);
    }
  }

  function handleDiscard() {
    editor.discard();
  }

  function handleToggleEdit() {
    if (editing && dirty && !window.confirm("Discard the unsaved layout changes?")) return;
    if (editing) editor.discard();
    editor.setEditing(!editing);
  }

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
      if (result.id) setSelectedId(result.id);
    } else {
      toast.error(`Couldn't add the bed: ${result.error}`);
    }
  }

  async function handleRetire() {
    if (!retireTarget) return;
    const result = await retireBed(retireTarget.id);
    if (result.ok) {
      toast.success(`Bed ${retireTarget.code} retired`);
      if (selectedId === retireTarget.id) setSelectedId(null);
      setRetireTarget(null);
    } else {
      toast.error(`Couldn't retire the bed: ${result.error}`);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FloorPlanLegend counts={counts} />
        <FloorPlanToolbar
          canEdit={canEdit}
          editing={editing}
          dirtyCount={changes.length}
          saving={saving}
          onToggleEdit={handleToggleEdit}
          onSave={handleSave}
          onDiscard={handleDiscard}
          onAddBed={() => setAdding(true)}
        />
      </div>

      {!loading && beds.length === 0 && (
        <p className="text-sm text-muted-foreground">No beds on record yet.</p>
      )}

      <UnplacedTray beds={unplaced} editing={editing} selectedId={selectedId} onPlace={handlePlace} onSelect={setSelectedId} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <FloorPlanCanvas
          rooms={rooms}
          beds={placed}
          selectedId={selectedId}
          editing={editing}
          canSeeClinical={canSeeClinical}
          onSelect={setSelectedId}
          onMove={handleMove}
          onDrop={handleDrop}
          onRotate={handleRotate}
          onRetireRequest={(bed) => setRetireTarget(bed)}
        />
        <BedDetailPanel
          bed={selected}
          rooms={rooms}
          editing={editing}
          canLock={canLock}
          canEdit={canEdit}
          canSeeClinical={canSeeClinical}
          onClose={() => setSelectedId(null)}
          onLock={(bed) => setLockTarget(bed)}
          onUnlock={handleUnlock}
          onRotate={handleRotate}
          onSetRotation={handleSetRotation}
          onSetRoom={handleSetRoom}
          onSetCapacity={handleSetCapacity}
          onRetire={(bed) => setRetireTarget(bed)}
        />
      </div>

      <LockBedDialog bed={lockTarget} onOpenChange={(open) => !open && setLockTarget(null)} onConfirm={handleLock} />
      <AddBedDialog
        open={adding}
        suggestedCode={nextBedCode(units.map((u) => u.code))}
        rooms={rooms}
        onOpenChange={setAdding}
        onConfirm={handleAdd}
      />
      <RetireBedDialog bed={retireTarget} onOpenChange={(open) => !open && setRetireTarget(null)} onConfirm={handleRetire} />
    </div>
  );
}
