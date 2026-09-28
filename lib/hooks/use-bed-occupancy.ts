"use client";

import * as React from "react";
import { useHouseLayout } from "@/lib/hooks/use-house-layout-collection";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";
import { useBedReservations } from "@/lib/hooks/use-bed-reservations";
import { activeStaysForUnit, bedCounts } from "@/lib/utils/beds";

/**
 * Beds in use right now, from the floor plan and the stays (lib/utils/beds.ts)
 * -- what the House Ops and Analytics "Units Occupied" cards show. The daily
 * census rows never carried it (units_occupied is empty in every row).
 * `shared`: beds holding more than one family.
 */
export function useBedOccupancy() {
  const { units, bedPositions, loading: layoutLoading } = useHouseLayout();
  const { stays } = usePatientsData();
  const { reservations } = useBedReservations();
  return React.useMemo(() => {
    const counts = bedCounts(units, bedPositions, stays, reservations);
    const shared = units.filter((u) => u.active && activeStaysForUnit(u, bedPositions, stays).length > 1).length;
    return {
      loading: layoutLoading,
      occupied: counts.occupied,
      total: counts.total,
      shared,
      utilization: counts.total ? Math.round((counts.occupied / counts.total) * 100) : undefined,
    };
  }, [units, bedPositions, stays, reservations, layoutLoading]);
}
