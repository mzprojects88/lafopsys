"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { BedPosition, Unit } from "@/lib/types/house-ops";
import type { Patient, Stay } from "@/lib/types/patient";

interface HouseOccupancySummaryProps {
  units: Unit[];
  bedPositions: BedPosition[];
  stays: Stay[];
  patients: Patient[];
}

/**
 * Compact "at a glance" view of all 13 LAF House beds for the partner portal
 * dashboard — one tile per bed (not per room), so a hospital can see
 * occupancy without navigating to the full Bed Availability page.
 */
export function HouseOccupancySummary({ units, bedPositions, stays, patients }: HouseOccupancySummaryProps) {
  const rows = units.map((unit) => {
    const positions = bedPositions.filter((b) => b.unitId === unit.id);
    const activeStays = positions
      .map((pos) => stays.find((s) => s.bedPositionId === pos.id && (s.status === "in_house" || s.status === "overdue")))
      .filter((s): s is Stay => !!s);
    const occupant = activeStays[0] ? patients.find((p) => p.id === activeStays[0].patientId) : undefined;
    const extra = Math.max(0, activeStays.length - 1);
    const outOfService = unit.status === "maintenance" || unit.status === "blocked";
    return { unit, occupant, extra, outOfService };
  });

  const availableCount = rows.filter((r) => !r.occupant && !r.outOfService).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>LAF House Occupancy</CardTitle>
        <CardDescription>
          {availableCount} of {units.length} beds available right now
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-7 lg:grid-cols-[repeat(13,minmax(0,1fr))]">
          {rows.map(({ unit, occupant, extra, outOfService }, i) => (
            <div
              key={unit.id}
              title={outOfService ? "Out of service" : occupant ? `${occupant.firstName} ${occupant.lastName}` : "Available"}
              className={cn(
                "flex flex-col items-center gap-1 rounded-lg border p-2 text-center",
                outOfService
                  ? "border-amber-300 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10"
                  : occupant
                    ? "border-sky-300 bg-sky-50 dark:border-sky-500/30 dark:bg-sky-500/10"
                    : "border-emerald-300 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10"
              )}
            >
              <span className="text-xs font-semibold text-muted-foreground">{i + 1}</span>
              <span className="line-clamp-2 w-full text-[10px] font-medium break-words">
                {outOfService ? "Maintenance" : occupant ? `${occupant.firstName} ${occupant.lastName[0]}.` : "Available"}
              </span>
              {extra > 0 && <span className="text-[9px] text-muted-foreground">+{extra} more</span>}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
