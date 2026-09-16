/**
 * Geometry for the floor plan (0047). Beds and rooms are stored NORMALISED
 * (0..1 on each axis of the plan image); the SVG draws in the image's own
 * pixel space, so everything here converts between the two and keeps a bed
 * on the sheet. Pure functions, relative imports only: tests/ runs this
 * file directly under node --test.
 */

/** The plan image's pixel size (public/floor-plan/actual-floor-plan.png). */
export const PLAN_W = 1087;
export const PLAN_H = 1447;

/** Snap grid for dragging and nudging, in plan pixels. */
export const GRID_PX = 8;

export interface Pt {
  x: number;
  y: number;
}

export type Polygon = [number, number][];

export function toPx(n: Pt): Pt {
  return { x: n.x * PLAN_W, y: n.y * PLAN_H };
}

export function toNorm(p: Pt): Pt {
  return { x: p.x / PLAN_W, y: p.y / PLAN_H };
}

export function snapPx(v: number, step: number = GRID_PX): number {
  return Math.round(v / step) * step;
}

export function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** 0..359, so -90 reads 270 and 450 reads 90. */
export function normalizeRotation(deg: number): number {
  return ((Math.round(deg) % 360) + 360) % 360;
}

/** Half extents (in plan pixels) of a bed's axis-aligned bounding box once rotated. */
function halfExtentsPx(w: number, h: number, rotationDeg: number): Pt {
  const rad = (rotationDeg * Math.PI) / 180;
  const wPx = w * PLAN_W;
  const hPx = h * PLAN_H;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  return { x: (wPx * cos + hPx * sin) / 2, y: (wPx * sin + hPx * cos) / 2 };
}

/** Keeps the bed's rotated bounding box inside the plan for any rotation. */
export function clampCentre(c: Pt, w: number, h: number, rotationDeg: number): Pt {
  const half = halfExtentsPx(w, h, rotationDeg);
  const px = toPx(c);
  const x = Math.min(PLAN_W - half.x, Math.max(half.x, px.x));
  const y = Math.min(PLAN_H - half.y, Math.max(half.y, px.y));
  return toNorm({ x, y });
}

/** Ray casting; works for the L-shaped rooms (a T&B notch is outside). */
export function pointInPolygon(p: Pt, poly: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const crosses = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function roomAtPoint(rooms: { id: string; bounds: Polygon | null }[], p: Pt): string | null {
  for (const room of rooms) {
    if (room.bounds && pointInPolygon(p, room.bounds)) return room.id;
  }
  return null;
}

/** Vertex average -- where a tray bed lands when it is first placed. */
export function roomCentroid(bounds: Polygon): Pt {
  let x = 0;
  let y = 0;
  for (const [px, py] of bounds) {
    x += px;
    y += py;
  }
  return { x: x / bounds.length, y: y / bounds.length };
}

/** Natural order: B2 before B10. */
export function compareBedCodes(a: string, b: string): number {
  const na = Number(a.replace(/\D/g, ""));
  const nb = Number(b.replace(/\D/g, ""));
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a.localeCompare(b);
}

/** The code after the highest one in use: ["B1", "B13"] -> "B14". */
export function nextBedCode(codes: string[]): string {
  let max = 0;
  for (const code of codes) {
    const n = Number(code.replace(/\D/g, ""));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `B${max + 1}`;
}

// ---- bed size (0047 columns w/h; the editor resizes them, increment 2) ----

export const BED_MIN_SIZE = 0.03; // normalised; ~33 x 43 plan px
export const BED_MAX_SIZE = 0.4;
export const BED_DEFAULT_SIZE = { w: 0.08, h: 0.12 } as const;

export function clampSize(v: number): number {
  return Math.min(BED_MAX_SIZE, Math.max(BED_MIN_SIZE, v));
}

/** The columns are numeric(6,5); rounding keeps a re-read row equal to what was drafted. */
export function round5(v: number): number {
  return Math.round(v * 1e5) / 1e5;
}

/**
 * Pointer (plan px) -> the bed's local frame -> a new size, for any rotation.
 * The dragged corner is the bottom-right in the bed's own frame; |local|
 * keeps it symmetric, so dragging past the centre never yields a negative
 * size. Snapped to the grid, then clamped (so the minimum wins over the snap).
 */
export function resizeFromPointer(centre: Pt, rotationDeg: number, pointerPx: Pt): { w: number; h: number } {
  const c = toPx(centre);
  const rad = (-rotationDeg * Math.PI) / 180;
  const dx = pointerPx.x - c.x;
  const dy = pointerPx.y - c.y;
  const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
  const wPx = snapPx(2 * Math.abs(lx));
  const hPx = snapPx(2 * Math.abs(ly));
  return { w: round5(clampSize(wPx / PLAN_W)), h: round5(clampSize(hPx / PLAN_H)) };
}

/** Where the resize handle sits: the bottom-right corner in the bed's rotated frame (plan px). */
export function resizeHandleLocal(w: number, h: number): Pt {
  return { x: (w * PLAN_W) / 2, y: (h * PLAN_H) / 2 };
}

// ---- custom labels (ops.floor_plan_labels, 0048) ----

export interface FloorPlanLabelLike {
  id: string;
  text: string;
  x: number;
  y: number;
  rotationDeg: number;
  fontSize: number;
}

export interface LabelChanges<L extends FloorPlanLabelLike = FloorPlanLabelLike> {
  inserts: Omit<L, "id">[];
  /** The draft ids of `inserts`, in the same order, so a failed insert can stay dirty. */
  insertTmpIds: string[];
  updates: L[];
  deletes: string[];
}

export function isTmpLabelId(id: string): boolean {
  return id.startsWith("tmp-");
}

export function sameLabel(a: FloorPlanLabelLike, b: FloorPlanLabelLike): boolean {
  return a.text === b.text && a.x === b.x && a.y === b.y && a.rotationDeg === b.rotationDeg && a.fontSize === b.fontSize;
}

/**
 * What the canvas draws while editing: the live rows with the draft laid
 * over them, deleted ones hidden, added (tmp) ones appended. A draft edit
 * of a label that is no longer live is dropped, never resurrected.
 */
export function mergeLabels<L extends FloorPlanLabelLike>(live: L[], draft: Map<string, L>, deleted: Set<string>): L[] {
  const out: L[] = [];
  for (const l of live) {
    if (deleted.has(l.id)) continue;
    out.push(draft.get(l.id) ?? l);
  }
  for (const [id, l] of draft) {
    if (isTmpLabelId(id) && !deleted.has(id)) out.push(l);
  }
  return out;
}

/** What Save layout must write for the labels. */
export function diffLabels<L extends FloorPlanLabelLike>(live: L[], draft: Map<string, L>, deleted: Set<string>): LabelChanges<L> {
  const inserts: Omit<L, "id">[] = [];
  const insertTmpIds: string[] = [];
  const updates: L[] = [];
  for (const [id, l] of draft) {
    if (deleted.has(id)) continue;
    if (isTmpLabelId(id)) {
      const { id: _drop, ...rest } = l;
      void _drop;
      inserts.push(rest);
      insertTmpIds.push(id);
      continue;
    }
    const base = live.find((b) => b.id === id);
    if (base && !sameLabel(base, l)) updates.push(l);
  }
  const deletes = [...deleted].filter((id) => live.some((b) => b.id === id));
  return { inserts, insertTmpIds, updates, deletes };
}
