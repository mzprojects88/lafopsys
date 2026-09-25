"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { FloorPlanLabel, Room } from "@/lib/types/house-ops";
import {
  GRID_PX,
  PLAN_H,
  PLAN_W,
  clamp01,
  clampCentre,
  resizeFromPointer,
  roomAtPoint,
  snapPx,
  toNorm,
  toPx,
  type Pt,
} from "@/lib/utils/floor-plan-geometry";
import type { BedView } from "./bed-view";
import { BedGlyph } from "./bed-glyph";
import { LabelGlyph } from "./label-glyph";

export const PLAN_IMAGE = "/floor-plan/second-floor-plan.png";

export type Selection = { kind: "bed"; id: string } | { kind: "label"; id: string } | null;

interface FloorPlanCanvasProps {
  rooms: Room[];
  beds: BedView[];
  labels: FloorPlanLabel[];
  dirtyLabelIds: Set<string>;
  selection: Selection;
  editing: boolean;
  canSeeClinical: boolean;
  onSelect: (selection: Selection) => void;
  /** Edit mode: the bed's centre moved (normalised, snapped, clamped). */
  onMove: (bed: BedView, centre: Pt) => void;
  /** Edit mode: a drag ended -- the room under the centre is decided here. */
  onDrop: (bed: BedView, centre: Pt) => void;
  /** Edit mode: the corner handle was dragged; the centre is already re-clamped. */
  onResize: (bed: BedView, w: number, h: number, centre: Pt) => void;
  onRotate: (bed: BedView, deltaDeg: number) => void;
  onRetireRequest: (bed: BedView) => void;
  onMoveLabel: (label: FloorPlanLabel, centre: Pt) => void;
  onRotateLabel: (label: FloorPlanLabel, deltaDeg: number) => void;
  onDeleteLabel: (label: FloorPlanLabel) => void;
  /** Hover previews on beds (default on). The bed picker turns them off; touch screens never get them. */
  previews?: boolean;
}

/** A mouse or trackpad that can hover. A phone's tap would open a hover card half off the screen. */
function useCanHover(): boolean {
  return React.useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
      mq.addEventListener("change", notify);
      return () => mq.removeEventListener("change", notify);
    },
    () => window.matchMedia("(hover: hover) and (pointer: fine)").matches,
    () => true
  );
}

function clientToSvg(svg: SVGSVGElement, clientX: number, clientY: number): Pt {
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

interface DragState {
  kind: "bed" | "label";
  mode: "move" | "resize";
  id: string;
  pointerId: number;
  startPointer: Pt; // svg px
  startCentre: Pt; // svg px
  moved: boolean;
}

const refKey = (kind: "bed" | "label", id: string) => `${kind}:${id}`;

/**
 * The plan image with the room polygons, one glyph per placed bed and one
 * per label, in the image's own pixel space (viewBox = 1087 x 1447).
 * Pointer positions are mapped back through the SVG's screen matrix, so
 * dragging and resizing are exact at any rendered width.
 */
export function FloorPlanCanvas({
  rooms,
  beds,
  labels,
  dirtyLabelIds,
  selection,
  editing,
  canSeeClinical,
  onSelect,
  onMove,
  onDrop,
  onResize,
  onRotate,
  onRetireRequest,
  onMoveLabel,
  onRotateLabel,
  onDeleteLabel,
  previews = true,
}: FloorPlanCanvasProps) {
  const canHover = useCanHover();
  const svgRef = React.useRef<SVGSVGElement>(null);
  const glyphRefs = React.useRef(new Map<string, SVGGElement>());
  const [drag, setDrag] = React.useState<DragState | null>(null);
  const [hoverRoom, setHoverRoom] = React.useState<string | null>(null);

  const setGlyphRef = React.useCallback(
    (key: string) => (el: SVGGElement | null) => {
      if (el) glyphRefs.current.set(key, el);
      else glyphRefs.current.delete(key);
    },
    []
  );

  // Selecting something in edit mode also focuses it, so the keyboard works at once.
  React.useEffect(() => {
    if (!editing || !selection) return;
    const el = glyphRefs.current.get(refKey(selection.kind, selection.id));
    if (el && document.activeElement !== el) el.focus({ preventScroll: true });
  }, [editing, selection]);

  function moveBedTo(bed: BedView, centrePx: Pt) {
    const snapped = { x: snapPx(centrePx.x), y: snapPx(centrePx.y) };
    const centre = clampCentre(toNorm(snapped), bed.w, bed.h, bed.rotationDeg);
    setHoverRoom(roomAtPoint(rooms, centre));
    onMove(bed, centre);
    return centre;
  }

  function moveLabelTo(label: FloorPlanLabel, centrePx: Pt) {
    const snapped = toNorm({ x: snapPx(centrePx.x), y: snapPx(centrePx.y) });
    const centre = { x: clamp01(snapped.x), y: clamp01(snapped.y) };
    onMoveLabel(label, centre);
    return centre;
  }

  function beginDrag(kind: "bed" | "label", id: string, centre: Pt, e: React.PointerEvent<SVGGElement>) {
    if (!editing || e.button !== 0 || !svgRef.current) return;
    const mode: DragState["mode"] = (e.target as Element).closest("[data-handle='resize']") ? "resize" : "move";
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({
      kind,
      mode,
      id,
      pointerId: e.pointerId,
      startPointer: clientToSvg(svgRef.current, e.clientX, e.clientY),
      startCentre: toPx(centre),
      moved: false,
    });
    onSelect({ kind, id });
  }

  function pointerDelta(e: React.PointerEvent<SVGGElement>, d: DragState): Pt | null {
    if (!svgRef.current) return null;
    const p = clientToSvg(svgRef.current, e.clientX, e.clientY);
    const dx = p.x - d.startPointer.x;
    const dy = p.y - d.startPointer.y;
    if (!d.moved && Math.hypot(dx, dy) < 3) return null;
    if (!d.moved) setDrag({ ...d, moved: true });
    return { x: dx, y: dy };
  }

  function endDrag(e: React.PointerEvent<SVGGElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setDrag(null);
    setHoverRoom(null);
  }

  // ---- beds ----

  const bedPointerDown = (bed: BedView) => (e: React.PointerEvent<SVGGElement>) => {
    if (bed.x === null || bed.y === null) return;
    beginDrag("bed", bed.id, { x: bed.x, y: bed.y }, e);
  };

  const bedPointerMove = (bed: BedView) => (e: React.PointerEvent<SVGGElement>) => {
    if (!drag || drag.kind !== "bed" || drag.id !== bed.id || drag.pointerId !== e.pointerId || bed.x === null || bed.y === null) return;
    if (drag.mode === "resize") {
      if (!svgRef.current) return;
      if (!drag.moved) setDrag({ ...drag, moved: true });
      const p = clientToSvg(svgRef.current, e.clientX, e.clientY);
      const size = resizeFromPointer({ x: bed.x, y: bed.y }, bed.rotationDeg, p);
      const centre = clampCentre({ x: bed.x, y: bed.y }, size.w, size.h, bed.rotationDeg);
      onResize(bed, size.w, size.h, centre);
      return;
    }
    const d = pointerDelta(e, drag);
    if (!d) return;
    moveBedTo(bed, { x: drag.startCentre.x + d.x, y: drag.startCentre.y + d.y });
  };

  const bedPointerUp = (bed: BedView) => (e: React.PointerEvent<SVGGElement>) => {
    if (!drag || drag.kind !== "bed" || drag.id !== bed.id) return;
    if (drag.mode === "move" && drag.moved && bed.x !== null && bed.y !== null) onDrop(bed, { x: bed.x, y: bed.y });
    endDrag(e);
  };

  const bedKeyDown = (bed: BedView) => (e: React.KeyboardEvent<SVGGElement>) => {
    if (e.key === "Escape") {
      onSelect(null);
      e.currentTarget.blur();
      return;
    }
    if (!editing || bed.x === null || bed.y === null) return;
    const step = (e.shiftKey ? 5 : 1) * GRID_PX;
    const px = toPx({ x: bed.x, y: bed.y });
    let handled = true;
    switch (e.key) {
      case "ArrowUp":
        onDrop(bed, moveBedTo(bed, { x: px.x, y: px.y - step }));
        break;
      case "ArrowDown":
        onDrop(bed, moveBedTo(bed, { x: px.x, y: px.y + step }));
        break;
      case "ArrowLeft":
        onDrop(bed, moveBedTo(bed, { x: px.x - step, y: px.y }));
        break;
      case "ArrowRight":
        onDrop(bed, moveBedTo(bed, { x: px.x + step, y: px.y }));
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

  // ---- labels ----

  const labelPointerDown = (label: FloorPlanLabel) => (e: React.PointerEvent<SVGGElement>) => {
    beginDrag("label", label.id, { x: label.x, y: label.y }, e);
  };

  const labelPointerMove = (label: FloorPlanLabel) => (e: React.PointerEvent<SVGGElement>) => {
    if (!drag || drag.kind !== "label" || drag.id !== label.id || drag.pointerId !== e.pointerId) return;
    const d = pointerDelta(e, drag);
    if (!d) return;
    moveLabelTo(label, { x: drag.startCentre.x + d.x, y: drag.startCentre.y + d.y });
  };

  const labelPointerUp = (label: FloorPlanLabel) => (e: React.PointerEvent<SVGGElement>) => {
    if (!drag || drag.kind !== "label" || drag.id !== label.id) return;
    endDrag(e);
  };

  const labelKeyDown = (label: FloorPlanLabel) => (e: React.KeyboardEvent<SVGGElement>) => {
    if (e.key === "Escape") {
      onSelect(null);
      e.currentTarget.blur();
      return;
    }
    if (!editing) return;
    const step = (e.shiftKey ? 5 : 1) * GRID_PX;
    const px = toPx({ x: label.x, y: label.y });
    let handled = true;
    switch (e.key) {
      case "ArrowUp":
        moveLabelTo(label, { x: px.x, y: px.y - step });
        break;
      case "ArrowDown":
        moveLabelTo(label, { x: px.x, y: px.y + step });
        break;
      case "ArrowLeft":
        moveLabelTo(label, { x: px.x - step, y: px.y });
        break;
      case "ArrowRight":
        moveLabelTo(label, { x: px.x + step, y: px.y });
        break;
      case "r":
      case "R":
        onRotateLabel(label, e.shiftKey ? -90 : 90);
        break;
      case "Delete":
      case "Backspace":
        onDeleteLabel(label);
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-card">
      <svg ref={svgRef} viewBox={`0 0 ${PLAN_W} ${PLAN_H}`} className={cn("block h-auto w-full select-none", editing && "touch-none")}>
        <image href={PLAN_IMAGE} x={0} y={0} width={PLAN_W} height={PLAN_H} preserveAspectRatio="none" />
        <rect x={0} y={0} width={PLAN_W} height={PLAN_H} fill="transparent" onPointerDown={() => onSelect(null)} />

        {rooms.map((room) => {
          if (!room.bounds) return null;
          const points = room.bounds.map(([x, y]) => `${x * PLAN_W},${y * PLAN_H}`).join(" ");
          const active = hoverRoom === room.id;
          return (
            <polygon
              key={room.id}
              pointerEvents="none"
              points={points}
              style={{ fill: "var(--primary)", stroke: "var(--primary)" }}
              fillOpacity={active ? 0.16 : 0.05}
              strokeOpacity={active ? 1 : 0.55}
              strokeWidth={active ? 3 : 2}
              strokeDasharray="8 5"
            />
          );
        })}

        {labels.map((label) => (
          <LabelGlyph
            key={label.id}
            ref={setGlyphRef(refKey("label", label.id))}
            label={label}
            selected={selection?.kind === "label" && selection.id === label.id}
            editing={editing}
            dirty={dirtyLabelIds.has(label.id)}
            dragging={drag?.kind === "label" && drag.id === label.id && drag.moved}
            onPointerDown={labelPointerDown(label)}
            onPointerMove={labelPointerMove(label)}
            onPointerUp={labelPointerUp(label)}
            onKeyDown={labelKeyDown(label)}
            onClick={() => onSelect({ kind: "label", id: label.id })}
          />
        ))}

        {beds.map((bed) => (
          <BedGlyph
            key={bed.id}
            ref={setGlyphRef(refKey("bed", bed.id))}
            bed={bed}
            selected={selection?.kind === "bed" && selection.id === bed.id}
            editing={editing}
            dragging={drag?.kind === "bed" && drag.id === bed.id && drag.moved}
            canSeeClinical={canSeeClinical}
            onPointerDown={bedPointerDown(bed)}
            onPointerMove={bedPointerMove(bed)}
            onPointerUp={bedPointerUp(bed)}
            onKeyDown={bedKeyDown(bed)}
            onClick={() => onSelect({ kind: "bed", id: bed.id })}
            preview={previews && canHover}
          />
        ))}
      </svg>
    </div>
  );
}
