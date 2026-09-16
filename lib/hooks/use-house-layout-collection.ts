"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import type { MutationResult } from "@/lib/hooks/use-patients-collection";
import type { BedPosition, FloorPlanLabel, Room, Unit, UnitStatus } from "@/lib/types/house-ops";
import type { LabelChanges } from "@/lib/utils/floor-plan-geometry";

/**
 * The house's rooms, beds, positions and the admin's labels (0047, 0048),
 * live from ops.* -- the floor plan draws these, and the admission dialogs
 * offer the beds. Occupancy is not here: lib/utils/beds.ts derives it from
 * ops.stays.
 */

interface RoomRow {
  id: string;
  name: string;
  bounds: [number, number][] | null;
  sort_order: number;
}

interface UnitRow {
  id: string;
  code: string;
  room_id: string | null;
  status: UnitStatus;
  shared_unit: boolean;
  // numeric columns arrive as strings through PostgREST
  x: string | number | null;
  y: string | number | null;
  w: string | number;
  h: string | number;
  rotation_deg: number;
  capacity: number;
  active: boolean;
  retired_at: string | null;
  lock_reason: string | null;
  status_changed_at: string | null;
  status_changed_by: string | null;
}

interface BedPositionRow {
  id: string;
  unit_id: string;
  label: BedPosition["label"];
}

interface LabelRow {
  id: string;
  text: string;
  x: string | number;
  y: string | number;
  rotation_deg: number;
  font_size: number;
}

const num = (v: string | number | null): number | null => (v == null ? null : Number(v));

function toRoom(r: RoomRow): Room {
  return { id: r.id, name: r.name, bounds: r.bounds ?? null, sortOrder: r.sort_order };
}

function toUnit(r: UnitRow): Unit {
  return {
    id: r.id,
    code: r.code,
    roomId: r.room_id,
    status: r.status,
    sharedUnit: r.shared_unit,
    x: num(r.x),
    y: num(r.y),
    w: Number(r.w),
    h: Number(r.h),
    rotationDeg: r.rotation_deg,
    capacity: r.capacity,
    active: r.active,
    retiredAt: r.retired_at ?? undefined,
    lockReason: r.lock_reason ?? undefined,
    statusChangedAt: r.status_changed_at ?? undefined,
    statusChangedBy: r.status_changed_by ?? undefined,
  };
}

function toBedPosition(r: BedPositionRow): BedPosition {
  return { id: r.id, unitId: r.unit_id, label: r.label };
}

function toLabel(r: LabelRow): FloorPlanLabel {
  return { id: r.id, text: r.text, x: Number(r.x), y: Number(r.y), rotationDeg: r.rotation_deg, fontSize: r.font_size };
}

function labelToRow(l: Omit<FloorPlanLabel, "id">) {
  return { text: l.text, x: l.x, y: l.y, rotation_deg: l.rotationDeg, font_size: l.fontSize };
}

/** One bed's saved layout patch -- Save layout sends only these columns. */
export interface BedLayoutChange {
  id: string;
  x: number | null;
  y: number | null;
  w: number;
  h: number;
  rotationDeg: number;
  roomId: string | null;
  capacity: number;
}

function layoutChangeToRow(c: BedLayoutChange) {
  return { x: c.x, y: c.y, w: c.w, h: c.h, rotation_deg: c.rotationDeg, room_id: c.roomId, capacity: c.capacity };
}

/** Everything one "Save layout" writes: bed geometry and label inserts/updates/deletes. */
export interface LayoutChanges {
  beds: BedLayoutChange[];
  labels: LabelChanges<FloorPlanLabel>;
}

export function countLayoutChanges(c: LayoutChanges): number {
  return c.beds.length + c.labels.inserts.length + c.labels.updates.length + c.labels.deletes.length;
}

interface HouseLayoutData {
  rooms: Room[];
  units: Unit[];
  bedPositions: BedPosition[];
  labels: FloorPlanLabel[];
}

export const houseLayoutStore = createCollection<HouseLayoutData>({
  key: "ops.house_layout",
  empty: { rooms: [], units: [], bedPositions: [], labels: [] },
  tables: [
    { schema: "ops", table: "rooms" },
    { schema: "ops", table: "units" },
    { schema: "ops", table: "bed_positions" },
    { schema: "ops", table: "floor_plan_labels" },
  ],
  fetch: async () => {
    const supabase = createClient();
    const [roomsRes, unitsRes, positionsRes, labelsRes] = await Promise.all([
      supabase.schema("ops").from("rooms").select("*").order("sort_order"),
      // retired beds included: a patient's history still names them
      supabase.schema("ops").from("units").select("*"),
      supabase.schema("ops").from("bed_positions").select("*"),
      supabase.schema("ops").from("floor_plan_labels").select("*").order("created_at"),
    ]);
    const failed = [roomsRes, unitsRes, positionsRes, labelsRes].find((r) => r.error);
    if (failed?.error) throw new Error(failed.error.message);
    return {
      rooms: ((roomsRes.data ?? []) as RoomRow[]).map(toRoom),
      units: ((unitsRes.data ?? []) as UnitRow[]).map(toUnit),
      bedPositions: ((positionsRes.data ?? []) as BedPositionRow[]).map(toBedPosition),
      labels: ((labelsRes.data ?? []) as LabelRow[]).map(toLabel),
    };
  },
});

export type SaveLayoutResult = { ok: true } | { ok: false; error: string; failedIds: string[] };

export function useHouseLayout() {
  const {
    data: { rooms, units, bedPositions, labels },
    loading,
    error,
  } = useCollection(houseLayoutStore);
  const refetch = houseLayoutStore.refetch;

  /**
   * One PATCH per changed bed (an upsert would need the INSERT privilege
   * 0047 revokes), one bulk insert for new labels, one row each for label
   * edits and deletes, then one refetch. Not atomic on purpose: the editor
   * keeps whatever failed dirty and says which.
   */
  async function saveLayout(changes: LayoutChanges): Promise<SaveLayoutResult> {
    if (countLayoutChanges(changes) === 0) return { ok: true };
    const db = createClient().schema("ops");
    const { beds, labels: lc } = changes;
    const results = await Promise.all([
      ...beds.map(async (c) => ({ ids: [c.id], error: (await db.from("units").update(layoutChangeToRow(c)).eq("id", c.id)).error })),
      ...(lc.inserts.length
        ? [(async () => ({ ids: lc.insertTmpIds, error: (await db.from("floor_plan_labels").insert(lc.inserts.map(labelToRow))).error }))()]
        : []),
      ...lc.updates.map(async (l) => ({ ids: [l.id], error: (await db.from("floor_plan_labels").update(labelToRow(l)).eq("id", l.id)).error })),
      ...lc.deletes.map(async (id) => ({ ids: [id], error: (await db.from("floor_plan_labels").delete().eq("id", id)).error })),
    ]);
    await refetch();
    const failed = results.filter((r) => r.error);
    if (failed.length) {
      return { ok: false, error: failed[0].error!.message, failedIds: failed.flatMap((r) => r.ids) };
    }
    return { ok: true };
  }

  /** The lock. The guard trigger stamps who and when; 'available' clears the reason. */
  async function setBedStatus(id: string, status: UnitStatus, reason: string | null): Promise<MutationResult> {
    const supabase = createClient();
    const { error } = await supabase
      .schema("ops")
      .from("units")
      .update({ status, lock_reason: status === "available" ? null : reason })
      .eq("id", id);
    if (error) return { ok: false, error: error.message };
    await refetch();
    return { ok: true };
  }

  async function createBed(input: {
    code: string;
    roomId: string | null;
    x: number | null;
    y: number | null;
    rotationDeg?: number;
  }): Promise<MutationResult & { id?: string }> {
    const supabase = createClient();
    const { data, error } = await supabase.schema("ops").rpc("create_bed", {
      p_code: input.code,
      p_room_id: input.roomId,
      p_x: input.x,
      p_y: input.y,
      p_rotation_deg: input.rotationDeg ?? 0,
    });
    if (error) return { ok: false, error: error.message };
    await refetch();
    return { ok: true, id: typeof data === "string" ? data : undefined };
  }

  async function retireBed(id: string): Promise<MutationResult> {
    const supabase = createClient();
    const { error } = await supabase.schema("ops").rpc("retire_bed", { p_unit_id: id });
    if (error) return { ok: false, error: error.message };
    await refetch();
    return { ok: true };
  }

  /** Admin only (guard_room_columns); no UI for it yet -- the seeded polygons come from the plan. */
  async function updateRoomBounds(roomId: string, bounds: [number, number][]): Promise<MutationResult> {
    const supabase = createClient();
    const { error } = await supabase.schema("ops").from("rooms").update({ bounds }).eq("id", roomId);
    if (error) return { ok: false, error: error.message };
    await refetch();
    return { ok: true };
  }

  return { rooms, units, bedPositions, labels, loading, error, saveLayout, setBedStatus, createBed, retireBed, updateRoomBounds, refetch };
}
