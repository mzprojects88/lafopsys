"use client";

import { PageHeader } from "@/components/patterns/page-header";
import { FloorPlanBoard } from "@/components/modules/house-ops/floor-plan-board";
import { rooms, units, bedPositions } from "@/lib/mock-data";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";

export default function FloorPlanPage() {
  const { patients, stays } = usePatientsData();

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Floor Plan"
        description="13 units across 3 rooms, 4 sleeping positions per unit. Placeholder layout — confirm against the physical house before treating this as pixel-faithful (see LAF House Beds Layout.jfif)."
      />
      <FloorPlanBoard rooms={rooms} units={units} bedPositions={bedPositions} stays={stays} patients={patients} />
    </div>
  );
}
