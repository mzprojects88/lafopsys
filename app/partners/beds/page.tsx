"use client";

import { BedDouble, DoorOpen, Wrench } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { FloorPlanBoard } from "@/components/modules/house-ops/floor-plan-board";
import { rooms, units, bedPositions } from "@/lib/mock-data";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";

export default function PartnerBedsPage() {
  const { patients, stays } = usePatientsData();

  const occupiedPositionIds = new Set(
    stays.filter((s) => s.status === "in_house" || s.status === "overdue").map((s) => s.bedPositionId)
  );
  const outOfService = units.filter((u) => u.status === "maintenance" || u.status === "blocked").length;
  const availableCount = bedPositions.filter((pos) => {
    const unit = units.find((u) => u.id === pos.unitId);
    if (!unit || unit.status === "maintenance" || unit.status === "blocked") return false;
    return !occupiedPositionIds.has(pos.id);
  }).length;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Bed Availability"
        description="Current LAF House occupancy — reflects the latest confirmed admissions."
      />

      <KpiGrid>
        <KpiCard label="Available Beds" value={availableCount} icon={DoorOpen} color="green" />
        <KpiCard label="Total Beds" value={bedPositions.length} icon={BedDouble} color="blue" />
        <KpiCard label="Units Out of Service" value={outOfService} icon={Wrench} color="amber" />
      </KpiGrid>

      <FloorPlanBoard rooms={rooms} units={units} bedPositions={bedPositions} stays={stays} patients={patients} />
    </div>
  );
}
