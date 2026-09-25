import type { BedCounts } from "@/lib/utils/beds";
import type { BedStatus } from "@/lib/types/house-ops";
import { STATUS_FILL, STATUS_LABEL, STATUS_STROKE } from "./bed-view";

const ORDER: BedStatus[] = ["available", "reserved", "occupied", "maintenance", "blocked"];

export function FloorPlanLegend({ counts }: { counts: BedCounts }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-theme-xs text-muted-foreground">
      {ORDER.map((status) => (
        <span key={status} className="flex items-center gap-1.5">
          <span
            className="inline-block size-3 rounded-sm border-2"
            style={{ backgroundColor: STATUS_FILL[status], borderColor: STATUS_STROKE[status] }}
          />
          {STATUS_LABEL[status]}
          <span className="font-semibold text-foreground">{counts[status]}</span>
        </span>
      ))}
      {counts.unplaced > 0 && (
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm border-2 border-dashed border-muted-foreground" />
          Unplaced <span className="font-semibold text-foreground">{counts.unplaced}</span>
        </span>
      )}
      <span className="ml-auto">
        {counts.total} bed{counts.total === 1 ? "" : "s"}
      </span>
    </div>
  );
}
