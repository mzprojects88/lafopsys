"use client";

import * as React from "react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { PLAN_H, PLAN_W } from "@/lib/utils/floor-plan-geometry";
import type { BedView } from "./bed-view";
import { STATUS_FILL, STATUS_STROKE } from "./bed-view";
import { BedSummary } from "./bed-summary";

interface BedGlyphProps {
  bed: BedView;
  selected: boolean;
  editing: boolean;
  dragging: boolean;
  canSeeClinical: boolean;
  onPointerDown: (e: React.PointerEvent<SVGGElement>) => void;
  onPointerMove: (e: React.PointerEvent<SVGGElement>) => void;
  onPointerUp: (e: React.PointerEvent<SVGGElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<SVGGElement>) => void;
  onClick: () => void;
}

/**
 * One bed on the plan: a rounded rect with a pillow at the head and the code
 * kept upright whatever the rotation. In read mode it carries a hover card;
 * in edit mode the detail panel does that job, so dragging never fights a
 * popover.
 */
export const BedGlyph = React.forwardRef<SVGGElement, BedGlyphProps>(function BedGlyph(
  { bed, selected, editing, dragging, canSeeClinical, onPointerDown, onPointerMove, onPointerUp, onKeyDown, onClick },
  ref
) {
  if (bed.x === null || bed.y === null) return null;
  const cx = bed.x * PLAN_W;
  const cy = bed.y * PLAN_H;
  const w = bed.w * PLAN_W;
  const h = bed.h * PLAN_H;
  const primary = bed.occupants[0]?.patient;
  const subtitle = primary ? primary.lastName : undefined;

  const g = (
    <g
      ref={ref}
      transform={`translate(${cx} ${cy}) rotate(${bed.rotationDeg})`}
      tabIndex={0}
      role="button"
      aria-label={`Bed ${bed.code}, ${bed.bedStatus}`}
      data-bed-id={bed.id}
      className={editing ? "cursor-move outline-none" : "cursor-pointer outline-none"}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      onClick={onClick}
      style={{ opacity: dragging ? 0.85 : 1 }}
    >
      <rect
        x={-w / 2}
        y={-h / 2}
        width={w}
        height={h}
        rx={8}
        fill={STATUS_FILL[bed.bedStatus]}
        stroke={selected ? "#0f172a" : STATUS_STROKE[bed.bedStatus]}
        strokeWidth={selected ? 4 : 2.5}
        strokeDasharray={bed.dirty && editing ? "8 5" : undefined}
      />
      {/* pillow at the head */}
      <rect x={-w / 2 + 8} y={-h / 2 + 8} width={w - 16} height={h * 0.2} rx={5} fill="#ffffff" fillOpacity={0.9} stroke={STATUS_STROKE[bed.bedStatus]} strokeWidth={1} />
      <g transform={`rotate(${-bed.rotationDeg})`}>
        <text textAnchor="middle" dominantBaseline="middle" fontSize={20} fontWeight={700} fill="#0f172a" y={subtitle ? -6 : 2}>
          {bed.code}
        </text>
        {subtitle && (
          <text textAnchor="middle" dominantBaseline="middle" fontSize={12} fontWeight={500} fill="#1e3a8a" y={14}>
            {subtitle.length > 12 ? `${subtitle.slice(0, 11)}…` : subtitle}
          </text>
        )}
      </g>
      {bed.status !== "available" && (
        <g transform={`translate(${w / 2 - 12} ${h / 2 - 12})`}>
          <circle r={10} fill={STATUS_STROKE[bed.bedStatus]} />
          <text textAnchor="middle" dominantBaseline="middle" fontSize={12} fontWeight={700} fill="#ffffff" y={1}>
            !
          </text>
        </g>
      )}
      {bed.occupants.length > 0 && bed.status === "available" && (
        <circle cx={w / 2 - 12} cy={h / 2 - 12} r={6} fill={STATUS_STROKE.occupied} />
      )}
    </g>
  );

  if (editing) return g;

  return (
    <HoverCard openDelay={150} closeDelay={80}>
      <HoverCardTrigger asChild>{g}</HoverCardTrigger>
      <HoverCardContent side="right" align="start" className="w-72">
        <BedSummary bed={bed} canSeeClinical={canSeeClinical} />
      </HoverCardContent>
    </HoverCard>
  );
});
