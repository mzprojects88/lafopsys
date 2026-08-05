"use client";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { rooms, units, bedPositions, stays, patients } from "@/lib/mock-data";
import type { UnitStatus } from "@/lib/types/house-ops";

const UNIT_STATUS_CLASSES: Record<UnitStatus, string> = {
  available: "border-emerald-300 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10",
  occupied: "border-sky-300 bg-sky-50 dark:border-sky-500/30 dark:bg-sky-500/10",
  maintenance: "border-amber-300 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10",
  blocked: "border-red-300 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10",
};

export function FloorPlanBoard() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        {(Object.keys(UNIT_STATUS_CLASSES) as UnitStatus[]).map((status) => (
          <div key={status} className="flex items-center gap-1.5">
            <span className={cn("size-3 rounded-sm border", UNIT_STATUS_CLASSES[status])} />
            <span className="capitalize">{status}</span>
          </div>
        ))}
      </div>

      {rooms.map((room) => {
        const roomUnits = units.filter((u) => u.roomId === room.id);
        return (
          <div key={room.id} className="flex flex-col gap-2 rounded-lg border p-4">
            <span className="text-sm font-semibold">{room.name}</span>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {roomUnits.map((unit) => {
                const positions = bedPositions.filter((b) => b.unitId === unit.id);
                return (
                  <div key={unit.id} className={cn("flex flex-col gap-2 rounded-md border p-2.5", UNIT_STATUS_CLASSES[unit.status])}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{unit.code}</span>
                      {unit.sharedUnit && (
                        <Badge variant="outline" className="h-4 px-1 text-[9px]">Shared</Badge>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-1">
                      {positions.map((pos) => {
                        const activeStay = stays.find(
                          (s) => s.bedPositionId === pos.id && (s.status === "in_house" || s.status === "overdue")
                        );
                        const patient = activeStay ? patients.find((p) => p.id === activeStay.patientId) : undefined;
                        return (
                          <div
                            key={pos.id}
                            title={patient ? `${patient.firstName} ${patient.lastName}` : "Empty"}
                            className={cn(
                              "flex h-8 items-center justify-center rounded-sm border bg-background text-[10px] font-medium",
                              patient ? "text-foreground" : "text-muted-foreground"
                            )}
                          >
                            {pos.label}
                            {patient ? "•" : ""}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
