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
 * kept upright whatever the rotation; every inner measure follows the bed's
 * size, so a small bed still reads. In read mode it carries a hover card;
 * in edit mode the detail panel does that job, so dragging never fights a
 * popover, and the selected bed shows a corner handle for resizing.
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
  const small = Math.min(w, h);
  const inset = Math.max(3, Math.min(8, small / 10));
  const codeSize = Math.max(10, Math.min(20, small / 4));
  const badgeR = Math.max(5, Math.min(10, small / 8));
  const primary = bed.occupants[0]?.patient;
  const subtitle = w >= 60 && h >= 60 && primary ? primary.lastName : undefined;

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
        rx={Math.min(8, small / 6)}
        fill={STATUS_FILL[bed.bedStatus]}
        stroke={selected ? "#0f172a" : STATUS_STROKE[bed.bedStatus]}
        strokeWidth={selected ? 4 : 2.5}
        strokeDasharray={bed.dirty && editing ? "8 5" : undefined}
      />
      {/* pillow at the head */}
      <rect
        x={-w / 2 + inset}
        y={-h / 2 + inset}
        width={w - 2 * inset}
        height={h * 0.2}
        rx={Math.min(5, inset)}
        fill="#ffffff"
        fillOpacity={0.9}
        stroke={STATUS_STROKE[bed.bedStatus]}
        strokeWidth={1}
      />
      <g transform={`rotate(${-bed.rotationDeg})`}>
        <text textAnchor="middle" dominantBaseline="middle" fontSize={codeSize} fontWeight={700} fill="#0f172a" y={subtitle ? -codeSize * 0.3 : 2}>
          {bed.code}
        </text>
        {subtitle && (
          <text textAnchor="middle" dominantBaseline="middle" fontSize={12} fontWeight={500} fill="#1e3a8a" y={codeSize * 0.7}>
            {subtitle.length > 12 ? `${subtitle.slice(0, 11)}…` : subtitle}
          </text>
        )}
      </g>
      {bed.status !== "available" && (
        <g transform={`translate(${w / 2 - badgeR - 2} ${h / 2 - badgeR - 2})`}>
          <circle r={badgeR} fill={STATUS_STROKE[bed.bedStatus]} />
          <text textAnchor="middle" dominantBaseline="middle" fontSize={badgeR * 1.2} fontWeight={700} fill="#ffffff" y={1}>
            !
          </text>
        </g>
      )}
      {bed.occupants.length > 0 && bed.status === "available" && (
        <circle cx={w / 2 - badgeR - 2} cy={h / 2 - badgeR - 2} r={badgeR * 0.6} fill={STATUS_STROKE.occupied} />
      )}
      {editing && selected && (
        <g data-handle="resize" transform={`translate(${w / 2} ${h / 2})`} className="cursor-nwse-resize">
          <rect x={-12} y={-12} width={24} height={24} fill="transparent" />
          <rect x={-7} y={-7} width={14} height={14} rx={2} fill="#ffffff" stroke="#0f172a" strokeWidth={2} />
        </g>
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
