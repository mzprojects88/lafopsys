"use client";

import * as React from "react";
import { ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";
import { useHouseLayout } from "@/lib/hooks/use-house-layout-collection";
import { useStaffRoster } from "@/lib/hooks/use-staff-roster";
import { todayIso } from "@/lib/utils/date";

interface BedMove {
  id: string;
  stayId: string;
  fromUnitId: string | null;
  toUnitId: string;
  reason: string;
  movedBy: string;
  at: string;
}

/** Today's approved bed moves (ops.bed_moves, 0071), newest first. */
const bedMovesTodayStore = createCollection<BedMove[]>({
  key: "ops.bed_moves.today",
  empty: [],
  tables: [{ schema: "ops", table: "bed_moves" }],
  fetch: async () => {
    const { data, error } = await createClient()
      .schema("ops")
      .from("bed_moves")
      .select("id, stay_id, from_unit_id, to_unit_id, reason, moved_by, created_at")
      .gte("created_at", `${todayIso()}T00:00:00+08:00`)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({ id: r.id, stayId: r.stay_id, fromUnitId: r.from_unit_id, toUnitId: r.to_unit_id, reason: r.reason, movedBy: r.moved_by, at: r.created_at }));
  },
});

/** House Today: who was moved today, to which bed, and who approved it (bed plan polish, 2026-10-15). */
export function BedMovesToday() {
  const { data: moves } = useCollection(bedMovesTodayStore);
  const { stays, patients } = usePatientsData();
  const { units } = useHouseLayout();
  const { staff } = useStaffRoster();
  if (!moves.length) return null;
  const code = (id: string | null) => units.find((u) => u.id === id)?.code ?? "—";
  const whose = (stayId: string) => {
    const p = patients.find((x) => x.id === stays.find((s) => s.id === stayId)?.patientId);
    return p ? `${p.lastName}, ${p.firstName}` : "A family";
  };
  const by = (id: string) => {
    const s = staff.find((x) => x.id === id);
    return s ? `${s.firstName} ${s.lastName}` : "staff";
  };
  const time = (iso: string) => new Date(iso).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" });
  return (
    <div className="flex flex-col gap-1 px-5 py-3">
      <span className="text-theme-xs font-medium text-muted-foreground">Bed moves today ({moves.length})</span>
      {moves.map((m) => (
        <span key={m.id} className="flex flex-wrap items-center gap-1 text-theme-xs text-muted-foreground">
          <b className="font-medium text-foreground">{whose(m.stayId)}</b> {code(m.fromUnitId)} <ArrowRight className="size-3" /> {code(m.toUnitId)} · approved by {by(m.movedBy)} at {time(m.at)}
        </span>
      ))}
    </div>
  );
}
