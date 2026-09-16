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
