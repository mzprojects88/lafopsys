"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RANGE_KINDS, periodLabel, resolveRange, shiftAnchor, type DayWindow, type PeriodKind, type RangeKind } from "@/lib/utils/period";
import { cn } from "@/lib/utils";

export interface PeriodState {
  kind: RangeKind;
  /** The day the calendar period is built around (ignored for custom). */
  anchor: string;
  /** Custom from/to; the window for every other kind comes from the anchor. */
  from?: string;
  to?: string;
}

/** The window a PeriodState describes. */
export function periodStateWindow(s: PeriodState): DayWindow {
  return resolveRange(s.kind, s.anchor, s.from, s.to);
}

/**
 * The one period picker every report uses (Nov 2026): Day / Week / Month /
 * Quarter / Year / Custom, previous-next arrows and the range as words. The
 * page owns the state (usually in the URL) and gets the next state back.
 */
export function PeriodPicker({ value, onChange, kinds, className }: { value: PeriodState; onChange: (next: PeriodState) => void; kinds?: RangeKind[]; className?: string }) {
  const window = periodStateWindow(value);
  const options = kinds ? RANGE_KINDS.filter((k) => kinds.includes(k.value)) : RANGE_KINDS;
  return (
    <div className={cn("flex flex-wrap items-center gap-2 print:hidden", className)}>
      <Select value={value.kind} onValueChange={(v) => onChange({ ...value, kind: v as RangeKind, from: v === "custom" ? value.from ?? window.from : value.from, to: v === "custom" ? value.to ?? window.to : value.to })}>
        <SelectTrigger className="w-28" aria-label="Period">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((k) => (
            <SelectItem key={k.value} value={k.value}>
              {k.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value.kind === "custom" ? (
        <span className="flex items-center gap-2">
          <Input type="date" aria-label="From" className="w-40" value={window.from} max={window.to} onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value, to: window.to })} />
          <span className="text-theme-sm text-muted-foreground">to</span>
          <Input type="date" aria-label="To" className="w-40" value={window.to} min={window.from} onChange={(e) => e.target.value && onChange({ ...value, from: window.from, to: e.target.value })} />
        </span>
      ) : (
        <span className="flex items-center gap-1">
          <Button type="button" size="icon-sm" variant="outline" aria-label="Previous period" onClick={() => onChange({ ...value, anchor: shiftAnchor(value.kind as PeriodKind, value.anchor, -1) })}>
            <ChevronLeft />
          </Button>
          <Button type="button" size="icon-sm" variant="outline" aria-label="Next period" onClick={() => onChange({ ...value, anchor: shiftAnchor(value.kind as PeriodKind, value.anchor, 1) })}>
            <ChevronRight />
          </Button>
        </span>
      )}
      <span className="text-theme-sm font-medium">{periodLabel(value.kind, window)}</span>
    </div>
  );
}
