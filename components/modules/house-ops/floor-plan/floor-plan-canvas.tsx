"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { Room } from "@/lib/types/house-ops";
import {
  GRID_PX,
  PLAN_H,
  PLAN_W,
  clampCentre,
  roomAtPoint,
  roomCentroid,
  snapPx,
  toNorm,
  toPx,
  type Pt,
} from "@/lib/utils/floor-plan-geometry";
import type { BedView } from "./bed-view";
import { BedGlyph } from "./bed-glyph";

export const PLAN_IMAGE = "/floor-plan/actual-floor-plan.png";

interface FloorPlanCanvasProps {
  rooms: Room[];
  beds: BedView[];
  selectedId: string | null;
  editing: boolean;
  canSeeClinical: boolean;
  onSelect: (id: string | null) => void;
  /** Edit mode: the bed's centre moved (normalised, snapped, clamped). */
  onMove: (bed: BedView, centre: Pt) => void;
  /** Edit mode: a drag ended -- the room under the centre is decided here. */
  onDrop: (bed: BedView, centre: Pt) => void;
  onRotate: (bed: BedView, deltaDeg: number) => void;
  onRetireRequest: (bed: BedView) => void;
}

function clientToSvg(svg: SVGSVGElement, clientX: number, clientY: number): Pt {
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

interface DragState {
  id: string;
  pointerId: number;
  startPointer: Pt; // svg px
  startCentre: Pt; // svg px
  moved: boolean;
}

/**
 * The plan image with the room polygons and one glyph per placed bed, in
 * the image's own pixel space (viewBox = 1087 x 1447). Pointer positions are
 * mapped back through the SVG's screen matrix, so dragging is exact at any
 * rendered width.
 */
export function FloorPlanCanvas({
  rooms,
  beds,
  selectedId,
  editing,
  canSeeClinical,
  onSelect,
  onMove,
  onDrop,
  onRotate,
  onRetireRequest,
}: FloorPlanCanvasProps) {
  const svgRef = React.useRef<SVGSVGElement>(null);
  const glyphRefs = React.useRef(new Map<string, SVGGElement>());
  const [drag, setDrag] = React.useState<DragState | null>(null);
  const [hoverRoom, setHoverRoom] = React.useState<string | null>(null);

  const setGlyphRef = React.useCallback(
    (id: string) => (el: SVGGElement | null) => {
      if (el) glyphRefs.current.set(id, el);
      else glyphRefs.current.delete(id);
    },
    []
  );

  // Selecting a bed in edit mode also focuses it, so the keyboard works at once.
  React.useEffect(() => {
    if (!editing || !selectedId) return;
    const el = glyphRefs.current.get(selectedId);
    if (el && document.activeElement !== el) el.focus({ preventScroll: true });
  }, [editing, selectedId]);

  function moveTo(bed: BedView, centrePx: Pt) {
    const snapped = { x: snapPx(centrePx.x), y: snapPx(centrePx.y) };
    const centre = clampCentre(toNorm(snapped), bed.w, bed.h, bed.rotationDeg);
    setHoverRoom(roomAtPoint(rooms, centre));
    onMove(bed, centre);
    return centre;
  }

  function handlePointerDown(bed: BedView) {
    return (e: React.PointerEvent<SVGGElement>) => {
      if (!editing || e.button !== 0 || bed.x === null || bed.y === null || !svgRef.current) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({
        id: bed.id,
        pointerId: e.pointerId,
        startPointer: clientToSvg(svgRef.current, e.clientX, e.clientY),
        startCentre: toPx({ x: bed.x, y: bed.y }),
        moved: false,
      });
      onSelect(bed.id);
    };
  }

  function handlePointerMove(bed: BedView) {
    return (e: React.PointerEvent<SVGGElement>) => {
      if (!drag || drag.id !== bed.id || drag.pointerId !== e.pointerId || !svgRef.current) return;
      const p = clientToSvg(svgRef.current, e.clientX, e.clientY);
      const dx = p.x - drag.startPointer.x;
      const dy = p.y - drag.startPointer.y;
      if (!drag.moved && Math.hypot(dx, dy) < 3) return;
      if (!drag.moved) setDrag({ ...drag, moved: true });
      moveTo(bed, { x: drag.startCentre.x + dx, y: drag.startCentre.y + dy });
    };
  }

  function handlePointerUp(bed: BedView) {
    return (e: React.PointerEvent<SVGGElement>) => {
      if (!drag || drag.id !== bed.id) return;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      if (drag.moved && bed.x !== null && bed.y !== null) {
        onDrop(bed, { x: bed.x, y: bed.y });
      }
      setDrag(null);
      setHoverRoom(null);
    };
  }

  function handleKeyDown(bed: BedView) {
    return (e: React.KeyboardEvent<SVGGElement>) => {
      if (e.key === "Escape") {
        onSelect(null);
        (e.currentTarget as SVGGElement).blur();
        return;
      }
      if (!editing || bed.x === null || bed.y === null) return;
      const step = (e.shiftKey ? 5 : 1) * GRID_PX;
      const px = toPx({ x: bed.x, y: bed.y });
      let handled = true;
      switch (e.key) {
        case "ArrowUp":
          onDrop(bed, moveTo(bed, { x: px.x, y: px.y - step }));
          break;
        case "ArrowDown":
          onDrop(bed, moveTo(bed, { x: px.x, y: px.y + step }));
          break;
        case "ArrowLeft":
          onDrop(bed, moveTo(bed, { x: px.x - step, y: px.y }));
          break;
        case "ArrowRight":
          onDrop(bed, moveTo(bed, { x: px.x + step, y: px.y }));
          break;
        case "r":
        case "R":
          onRotate(bed, e.shiftKey ? -90 : 90);
          break;
        case "Delete":
        case "Backspace":
          onRetireRequest(bed);
          break;
        default:
          handled = false;
      }
      if (handled) e.preventDefault();
      setHoverRoom(null);
    };
  }

  return (
    <div className="relative overflow-hidden rounded-lg border bg-white">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${PLAN_W} ${PLAN_H}`}
        className={cn("block h-auto w-full select-none", editing && "touch-none")}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) onSelect(null);
        }}
      >
        <image href={PLAN_IMAGE} x={0} y={0} width={PLAN_W} height={PLAN_H} preserveAspectRatio="none" />
        <rect x={0} y={0} width={PLAN_W} height={PLAN_H} fill="transparent" onPointerDown={() => onSelect(null)} />

        {rooms.map((room) => {
          if (!room.bounds) return null;
          const points = room.bounds.map(([x, y]) => `${x * PLAN_W},${y * PLAN_H}`).join(" ");
          const c = toPx(roomCentroid(room.bounds));
          const active = hoverRoom === room.id;
          return (
            <g key={room.id} pointerEvents="none">
              <polygon
                points={points}
                fill={active ? "rgba(59,130,246,0.16)" : "rgba(59,130,246,0.05)"}
                stroke={active ? "#2563eb" : "rgba(37,99,235,0.55)"}
                strokeWidth={active ? 3 : 2}
                strokeDasharray="8 5"
              />
              <text x={c.x} y={c.y - 8} textAnchor="middle" fontSize={16} fontWeight={700} fill="rgba(30,64,175,0.7)">
                {room.name.toUpperCase()}
              </text>
            </g>
          );
        })}

        {beds.map((bed) => (
          <BedGlyph
            key={bed.id}
            ref={setGlyphRef(bed.id)}
            bed={bed}
            selected={bed.id === selectedId}
            editing={editing}
            dragging={drag?.id === bed.id && drag.moved}
            canSeeClinical={canSeeClinical}
            onPointerDown={handlePointerDown(bed)}
            onPointerMove={handlePointerMove(bed)}
            onPointerUp={handlePointerUp(bed)}
            onKeyDown={handleKeyDown(bed)}
            onClick={() => onSelect(bed.id)}
          />
        ))}
      </svg>
    </div>
  );
}
