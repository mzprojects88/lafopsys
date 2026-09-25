"use client";

import * as React from "react";
import type { FloorPlanLabel } from "@/lib/types/house-ops";
import { PLAN_H, PLAN_W } from "@/lib/utils/floor-plan-geometry";
import { PLAN_INK, PLAN_PAPER } from "./bed-view";

interface LabelGlyphProps {
  label: FloorPlanLabel;
  selected: boolean;
  editing: boolean;
  dirty: boolean;
  dragging: boolean;
  onPointerDown: (e: React.PointerEvent<SVGGElement>) => void;
  onPointerMove: (e: React.PointerEvent<SVGGElement>) => void;
  onPointerUp: (e: React.PointerEvent<SVGGElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<SVGGElement>) => void;
  onClick: () => void;
}

/**
 * Free text on the plan (0048): bold, dark, with a white halo so it reads
 * over walls. In read mode it takes no pointer events at all, so a label
 * never steals a bed's hover card; in edit mode it drags like a bed.
 */
export const LabelGlyph = React.forwardRef<SVGGElement, LabelGlyphProps>(function LabelGlyph(
  { label, selected, editing, dirty, dragging, onPointerDown, onPointerMove, onPointerUp, onKeyDown, onClick },
  ref
) {
  const cx = label.x * PLAN_W;
  const cy = label.y * PLAN_H;
  // rough text box for the selection outline (no getBBox during render)
  const boxW = label.text.length * label.fontSize * 0.62 + 12;
  const boxH = label.fontSize * 1.4 + 8;
  return (
    <g
      ref={ref}
      transform={`translate(${cx} ${cy}) rotate(${label.rotationDeg})`}
      tabIndex={editing ? 0 : -1}
      role={editing ? "button" : undefined}
      aria-label={`Label ${label.text}`}
      data-label-id={label.id}
      pointerEvents={editing ? "bounding-box" : "none"}
      className={editing ? "cursor-move outline-none" : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      onClick={onClick}
      style={{ opacity: dragging ? 0.85 : 1 }}
    >
      {editing && selected && (
        <rect
          x={-boxW / 2}
          y={-boxH / 2}
          width={boxW}
          height={boxH}
          rx={4}
          fill="none"
          stroke={PLAN_INK}
          strokeWidth={2}
          strokeDasharray={dirty ? "6 4" : undefined}
        />
      )}
      <text
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={label.fontSize}
        fontWeight={700}
        fill={PLAN_INK}
        stroke={PLAN_PAPER}
        strokeWidth={Math.max(2, label.fontSize / 5)}
        strokeLinejoin="round"
        paintOrder="stroke"
      >
        {label.text}
      </text>
    </g>
  );
});
