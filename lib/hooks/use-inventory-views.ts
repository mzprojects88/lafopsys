"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import type {
  ConsumptionDailyRow,
  ExpiringLotRow,
  LotOnHandRow,
  StockSummaryRow,
  StorageLocationRow,
  WasteRow,
} from "@/lib/types/inventory-views";

/**
 * Reads one of laf-inventory's published views (see lib/types/inventory-views.ts).
 * Numeric columns arrive from PostgREST as strings (Postgres `numeric`), so
 * every hook below coerces them once here; pages get real numbers.
 *
 * No realtime and no writes: this is HQ reporting. Anything that changes
 * stock happens in the LAF Inventory app itself.
 */
function useView<T>(view: string, mapRow: (row: Record<string, unknown>) => T, order?: { column: string; ascending?: boolean }) {
  const [rows, setRows] = React.useState<T[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const refetch = React.useCallback(async () => {
    let query = createClient().schema("inventory").from(view).select("*");
    if (order) query = query.order(order.column, { ascending: order.ascending ?? true });
    const { data, error } = await query;
    if (error) {
      setError(error.message);
      setRows([]);
    } else {
      setError(null);
      setRows(((data ?? []) as Record<string, unknown>[]).map(mapRow));
    }
    setLoading(false);
    // mapRow/order are stable per hook below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from Supabase, an external system
    refetch();
  }, [refetch]);

  return { rows, loading, error, refetch };
}

const num = (v: unknown) => (v == null ? 0 : Number(v));
const numOrNull = (v: unknown) => (v == null ? null : Number(v));

export function useStockSummary() {
  return useView<StockSummaryRow>(
    "v_stock_summary",
    (r) => ({ ...(r as unknown as StockSummaryRow), on_hand_qty: num(r.on_hand_qty), stock_value: num(r.stock_value), reorder_point: num(r.reorder_point) }),
    { column: "name" }
  );
}

export function useExpiringLots() {
  return useView<ExpiringLotRow>(
    "v_expiring",
    (r) => ({ ...(r as unknown as ExpiringLotRow), days_left: num(r.days_left), qty_remaining: num(r.qty_remaining), value_at_risk: num(r.value_at_risk) }),
    { column: "expiry_date" }
  );
}

export function useLotsOnHand() {
  return useView<LotOnHandRow>(
    "v_lots_on_hand",
    (r) => ({
      ...(r as unknown as LotOnHandRow),
      days_left: numOrNull(r.days_left),
      qty_remaining: num(r.qty_remaining),
      unit_cost: num(r.unit_cost),
      value: num(r.value),
    }),
    { column: "received_at", ascending: false }
  );
}

export function useConsumptionDaily() {
  return useView<ConsumptionDailyRow>(
    "v_consumption_daily",
    (r) => ({ ...(r as unknown as ConsumptionDailyRow), qty_issued: num(r.qty_issued), cost: num(r.cost) }),
    { column: "date", ascending: false }
  );
}

export function useWasteLog() {
  return useView<WasteRow>(
    "v_waste",
    (r) => ({ ...(r as unknown as WasteRow), qty: num(r.qty), value: num(r.value) }),
    { column: "date", ascending: false }
  );
}

export function useStorageLocations() {
  return useView<StorageLocationRow>("v_storage_locations", (r) => ({ ...(r as unknown as StorageLocationRow), depth: num(r.depth) }), { column: "path" });
}
