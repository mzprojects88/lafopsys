"use client";

import * as React from "react";
import { Gift, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/utils/date";

interface GoodsRow {
  drawn_on: string;
  item: string;
  quantity: number | string;
  uom: string | null;
  card_scanned: boolean;
}

/**
 * What the child's family received from LAF Inventory as GIK Distributions (Inventory 0078,
 * inventory.goods_for_patient: Patients viewers), newest first, and whether the family's Patient ID
 * card was scanned when it was given.
 */
export function GoodsReceived({ patientId }: { patientId: string }) {
  const [rows, setRows] = React.useState<GoodsRow[] | null>(null);
  const [all, setAll] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    void createClient()
      .schema("inventory")
      .rpc("goods_for_patient", { p_patient_id: patientId })
      .then(({ data, error }) => live && setRows(error ? [] : ((data as GoodsRow[] | null) ?? [])));
    return () => {
      live = false;
    };
  }, [patientId]);

  if (!rows || rows.length === 0) return null;
  const shown = all ? rows : rows.slice(0, 5);
  return (
    <div className="mb-3 flex flex-col gap-2 rounded-2xl border border-border bg-card p-4">
      <span className="flex items-center gap-2 text-theme-sm font-semibold">
        <Gift className="size-4 text-muted-foreground" />
        Goods received ({rows.length})
      </span>
      <ul className="flex flex-col divide-y divide-border text-theme-sm">
        {shown.map((r, i) => (
          <li key={`${r.drawn_on}-${i}`} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
            <span>
              {r.item} · {Number(r.quantity)}
              {r.uom ? ` ${r.uom}` : ""}
            </span>
            <span className="flex items-center gap-1.5 text-theme-xs text-muted-foreground">
              {formatDate(r.drawn_on)}
              {r.card_scanned ? (
                <span className="flex items-center gap-1 font-medium text-success-foreground dark:text-success">
                  <ScanLine className="size-3" /> card scanned
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {rows.length > 5 ? (
        <Button variant="ghost" size="sm" className="w-fit px-1" onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show all ${rows.length}`}
        </Button>
      ) : null}
    </div>
  );
}
