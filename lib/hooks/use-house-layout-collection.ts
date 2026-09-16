"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import type { MutationResult } from "@/lib/hooks/use-patients-collection";
import type { BedPosition, Room, Unit, UnitStatus } from "@/lib/types/house-ops";

/**
 * The house's rooms, beds and positions (0047), live from ops.* -- the
 * floor plan draws these, and the admission dialogs offer them. Occupancy
 * is not here: lib/utils/beds.ts derives it from ops.stays.
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

/** One bed's saved layout patch -- Save layout sends only these columns. */
export interface BedLayoutChange {
  id: string;
  x: number | null;
  y: number | null;
  rotationDeg: number;
  roomId: string | null;
  capacity?: number;
  w?: number;
  h?: number;
}

function layoutChangeToRow(c: BedLayoutChange) {
  const row: Record<string, unknown> = { x: c.x, y: c.y, rotation_deg: c.rotationDeg, room_id: c.roomId };
  if (c.capacity !== undefined) row.capacity = c.capacity;
  if (c.w !== undefined) row.w = c.w;
  if (c.h !== undefined) row.h = c.h;
  return row;
}

interface HouseLayoutData {
  rooms: Room[];
  units: Unit[];
  bedPositions: BedPosition[];
}

export const houseLayoutStore = createCollection<HouseLayoutData>({
  key: "ops.house_layout",
  empty: { rooms: [], units: [], bedPositions: [] },
  tables: [
    { schema: "ops", table: "rooms" },
    { schema: "ops", table: "units" },
    { schema: "ops", table: "bed_positions" },
  ],
  fetch: async () => {
    const supabase = createClient();
    const [roomsRes, unitsRes, positionsRes] = await Promise.all([
      supabase.schema("ops").from("rooms").select("*").order("sort_order"),
      // retired beds included: a patient's history still names them
      supabase.schema("ops").from("units").select("*"),
      supabase.schema("ops").from("bed_positions").select("*"),
    ]);
    const failed = [roomsRes, unitsRes, positionsRes].find((r) => r.error);
    if (failed?.error) throw new Error(failed.error.message);
    return {
      rooms: ((roomsRes.data ?? []) as RoomRow[]).map(toRoom),
      units: ((unitsRes.data ?? []) as UnitRow[]).map(toUnit),
      bedPositions: ((positionsRes.data ?? []) as BedPositionRow[]).map(toBedPosition),
    };
  },
});

export type SaveLayoutResult = { ok: true } | { ok: false; error: string; failedIds: string[] };

export function useHouseLayout() {
  const {
    data: { rooms, units, bedPositions },
    loading,
    error,
  } = useCollection(houseLayoutStore);
  const refetch = houseLayoutStore.refetch;

  /**
   * One PATCH per changed bed (an upsert would need the INSERT privilege
   * 0047 revokes), then one refetch. Not atomic on purpose: the editor keeps
   * the beds that failed dirty and says which.
   */
  async function saveLayout(changes: BedLayoutChange[]): Promise<SaveLayoutResult> {
    if (changes.length === 0) return { ok: true };
    const supabase = createClient();
    const results = await Promise.all(
      changes.map(async (c) => {
        const { error } = await supabase.schema("ops").from("units").update(layoutChangeToRow(c)).eq("id", c.id);
        return { id: c.id, error };
      })
    );
    await refetch();
    const failed = results.filter((r) => r.error);
    if (failed.length) {
      return { ok: false, error: failed[0].error!.message, failedIds: failed.map((r) => r.id) };
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

  return { rooms, units, bedPositions, loading, error, saveLayout, setBedStatus, createBed, retireBed, updateRoomBounds, refetch };
}
