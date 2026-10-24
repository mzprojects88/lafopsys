"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";

/** One meal LAF Inventory's kitchen recorded (ops.house_meals, 0102). */
export interface KitchenMeal {
  date: string;
  mealType: string;
  patients: number;
  carers: number;
  others: number;
  served: number;
  dish: string | null;
  notes: string | null;
  /** Value of the stock drawn for this meal; null when none was linked. */
  drawValue: number | null;
}

/** One Care Cart run recorded in LAF Inventory (ops.house_care_cart, 0102). */
export interface CareCartRun {
  date: string;
  timeSlot: string | null;
  status: string;
  served: number | null;
  source: string | null;
  sponsor: string | null;
  volunteers: number | null;
  volunteerNames: string | null;
  location: string | null;
  dishes: string | null;
  drawValue: number | null;
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

const MAP = {
  house_meals: (r: Record<string, unknown>): KitchenMeal => ({
    date: String(r.date),
    mealType: String(r.meal_type),
    patients: Number(r.patients),
    carers: Number(r.carers),
    others: Number(r.others),
    served: Number(r.served),
    dish: (r.dish as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    drawValue: num(r.draw_value),
  }),
  house_care_cart: (r: Record<string, unknown>): CareCartRun => ({
    date: String(r.date),
    timeSlot: (r.time_slot as string | null) ?? null,
    status: String(r.status),
    served: num(r.served),
    source: (r.source as string | null) ?? null,
    sponsor: (r.sponsor as string | null) ?? null,
    volunteers: num(r.volunteers),
    volunteerNames: (r.volunteer_names as string | null) ?? null,
    location: (r.location as string | null) ?? null,
    dishes: (r.dishes as string | null) ?? null,
    drawValue: num(r.draw_value),
  }),
};

/** One box of House Operations Stocks (ops.house_stock_status, 0106 over Inventory 0066). */
export interface HouseStockBox {
  groupId: string;
  groupName: string;
  lineId: string;
  name: string;
  minDays: number;
  items: number;
  onHand: number;
  uom: string | null;
  mixedUnits: boolean;
  draws: number;
  usedPerDay: number;
  daysLeft: number | null;
  status: "out" | "low" | "ok" | "no_forecast" | "no_items";
}

/** The boxes of critical items as LAF Inventory works them out; read only. `rows` is null while loading. */
export function useHouseStocks() {
  const [state, setState] = React.useState<{ rows: HouseStockBox[] | null; error: string | null }>({ rows: null, error: null });
  React.useEffect(() => {
    let live = true;
    void createClient()
      .schema("ops")
      .rpc("house_stock_status")
      .then(({ data, error }) => {
        if (!live) return;
        const rows = error
          ? null
          : ((data ?? []) as Record<string, unknown>[]).map((r) => ({
              groupId: String(r.group_id),
              groupName: String(r.group_name),
              lineId: String(r.line_id),
              name: String(r.line_name),
              minDays: Number(r.min_days),
              items: Number(r.items),
              onHand: Number(r.on_hand),
              uom: (r.uom as string | null) ?? null,
              mixedUnits: r.mixed_units === true,
              draws: Number(r.draws),
              usedPerDay: Number(r.used_per_day),
              daysLeft: num(r.days_left),
              status: String(r.status) as HouseStockBox["status"],
            }));
        setState({ rows, error: error?.message ?? null });
      });
    return () => {
      live = false;
    };
  }, []);
  return state;
}

type Rows<F extends keyof typeof MAP> = ReturnType<(typeof MAP)[F]>[];

/**
 * Meals or Care Cart runs for a date range, read from LAF Inventory through the House Ops
 * functions (0102); read only. `rows` is null while the range loads.
 */
export function useKitchenRecords<F extends keyof typeof MAP>(fn: F, from: string, to: string) {
  const [state, setState] = React.useState<{ key: string; rows: Rows<F> | null; error: string | null }>({ key: "", rows: null, error: null });
  const key = `${fn}|${from}|${to}`;
  React.useEffect(() => {
    let live = true;
    void createClient()
      .schema("ops")
      .rpc(fn, { p_from: from, p_to: to })
      .then(({ data, error }) => {
        const toRow = MAP[fn] as (r: Record<string, unknown>) => Rows<F>[number];
        if (live) setState({ key, rows: error ? null : ((data ?? []) as Record<string, unknown>[]).map(toRow), error: error?.message ?? null });
      });
    return () => {
      live = false;
    };
  }, [fn, from, to, key]);
  return state.key === key ? { rows: state.rows, error: state.error } : { rows: null, error: null };
}
