"use client";

import { PageHeader } from "@/components/patterns/page-header";
import { FloorPlanView } from "@/components/modules/house-ops/floor-plan/floor-plan-view";

export default function FloorPlanPage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Floor Plan"
        description="The beds drawn over the house plan. Hover or tap a bed for who is in it; the beds here are what admissions can take."
      />
      <FloorPlanView />
    </div>
  );
}
