"use client";

import { Fuel } from "lucide-react";
import { cn } from "@/lib/utils";
import { gaugeTone } from "@/lib/utils/fuel";

const FILL = { success: "bg-success", warning: "bg-warning", destructive: "bg-destructive" } as const;
const TEXT = { success: "text-success", warning: "text-warning", destructive: "text-destructive" } as const;

/**
 * The fuel gauge, after a car's instrument panel (Fuel Monitoring, 0079): F at the top, E at
 * the bottom, a tick at each quarter, and the pump with an arrow to the side the fuel cap is
 * on. The bar is green with plenty, amber under half, red under a quarter. Sits on the dark
 * instrument panel (bg-instrument) in either theme.
 */
export function FuelGauge({ level, doorSide, className }: { level: number | null; doorSide: "left" | "right" | null; className?: string }) {
  const tone = level == null ? null : gaugeTone(level);
  const label = level == null ? "Fuel level not known yet" : `Fuel about ${Math.round(level * 100)}%`;
  return (
    <div className={cn("flex items-stretch gap-3", className)} role="img" aria-label={label}>
      <div className="flex flex-col items-center justify-between py-0.5 text-instrument-muted">
        <span className="text-lg leading-none font-bold">F</span>
        <span className={cn("flex items-center gap-0.5", tone ? TEXT[tone] : "text-instrument-muted")}>
          {doorSide === "left" && <span aria-hidden className="text-[10px] leading-none">◀</span>}
          <Fuel className="size-5" strokeWidth={2} />
          {doorSide === "right" && <span aria-hidden className="text-[10px] leading-none">▶</span>}
        </span>
        <span className="text-lg leading-none font-bold">E</span>
      </div>
      <div className="relative h-36 w-10 rounded-md p-1 ring-2 ring-instrument-muted/70 sm:h-40 sm:w-12">
        {[0.25, 0.5, 0.75].map((q) => (
          <span key={q} aria-hidden className="absolute -left-2 h-0.5 w-2 rounded-full bg-instrument-muted/70" style={{ bottom: `${q * 100}%` }} />
        ))}
        <div className="relative h-full w-full overflow-hidden rounded-sm bg-white/5">
          {tone && (
            <div
              className={cn("absolute inset-x-0 bottom-0 transition-[height] duration-700 ease-out motion-reduce:transition-none", FILL[tone])}
              style={{ height: `${Math.max(level! * 100, level! > 0 ? 3 : 0)}%` }}
            >
              {/* The dot texture of a segmented display. */}
              <span aria-hidden className="absolute inset-0 bg-[radial-gradient(rgb(0_0_0/0.18)_1px,transparent_1.2px)] [background-size:4px_4px]" />
            </div>
          )}
          {level == null && <span className="absolute inset-0 flex items-center justify-center text-lg font-bold text-instrument-muted">?</span>}
        </div>
      </div>
    </div>
  );
}
