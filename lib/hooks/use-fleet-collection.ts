"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import { todayIso } from "@/lib/utils/date";
import { dayKey } from "@/lib/utils/dtr";
import { efficiencyDropped, estimateFuelLevel, measuredKmPerLitre, serviceDue, type FuelFill, type KmPerLitreInterval, type LevelCheck, type ServiceDue } from "@/lib/utils/fuel";
import { useVehicles, type Vehicle } from "@/lib/hooks/use-vehicles-collection";
import { expenseKindsStore, vehicleExpensesStore } from "@/lib/hooks/use-vehicle-expenses-collection";

export type MutationResult = { ok: true } | { ok: false; error: string };

export interface ServiceRuleRow {
  vehicleId: string;
  kind: string;
  everyKm: number | null;
  everyMonths: number | null;
}

interface FleetData {
  fills: (FuelFill & { vehicleId: string })[];
  services: { vehicleId: string; kind: string; date: string; odometer: number | null }[];
  rules: ServiceRuleRow[];
  checks: (LevelCheck & { vehicleId: string; checkedAt: string })[];
  efficiencyPct: Map<string, number>;
}

const daysAgo = (n: number) => {
  const d = new Date(`${todayIso()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

/** What the gauge and the service reminders need: a year of fill-ups, services, LAF's intervals, recent gauge readings (0079). */
export const fleetStore = createCollection<FleetData>({
  key: "ops.fleet",
  empty: { fills: [], services: [], rules: [], checks: [], efficiencyPct: new Map() },
  tables: [
    { schema: "ops", table: "vehicle_expenses" },
    { schema: "ops", table: "vehicle_service_rules" },
    { schema: "ops", table: "fuel_level_checks" },
    { schema: "ops", table: "vehicles" },
  ],
  fetch: async () => {
    const ops = createClient().schema("ops");
    const [fills, services, rules, checks, vehicles] = await Promise.all([
      ops.from("vehicle_expenses").select("vehicle_id, expense_date, odometer, litres, full_tank").eq("kind", "fuel").is("voided_at", null).gte("expense_date", daysAgo(400)),
      ops.from("vehicle_expenses").select("vehicle_id, kind, expense_date, odometer").neq("kind", "fuel").is("voided_at", null).gte("expense_date", daysAgo(1100)),
      ops.from("vehicle_service_rules").select("vehicle_id, kind, every_km, every_months"),
      ops.from("fuel_level_checks").select("vehicle_id, level, odometer, checked_at").gte("checked_at", daysAgo(60)),
      ops.from("vehicles").select("id, efficiency_alert_pct"),
    ]);
    for (const r of [fills, services, rules, checks, vehicles]) if (r.error) throw new Error(r.error.message);
    return {
      fills: (fills.data ?? []).map((f) => ({ vehicleId: f.vehicle_id, date: f.expense_date, odometer: f.odometer, litres: Number(f.litres), fullTank: !!f.full_tank })),
      services: (services.data ?? []).map((s) => ({ vehicleId: s.vehicle_id, kind: s.kind, date: s.expense_date, odometer: s.odometer })),
      rules: (rules.data ?? []).map((r) => ({ vehicleId: r.vehicle_id, kind: r.kind, everyKm: r.every_km, everyMonths: r.every_months })),
      checks: (checks.data ?? []).map((c) => ({ vehicleId: c.vehicle_id, level: Number(c.level), odometer: c.odometer, date: dayKey(c.checked_at), checkedAt: c.checked_at })),
      efficiencyPct: new Map((vehicles.data ?? []).map((v) => [v.id as string, v.efficiency_alert_pct as number])),
    };
  },
});

export interface VehicleStatus {
  vehicle: Vehicle;
  /** Measured full-to-full, else the vehicle's starting figure. */
  kmPerLitre: number | null;
  measured: boolean;
  intervals: KmPerLitreInterval[];
  /** 0..1, or null when it can't be estimated yet. */
  level: number | null;
  efficiencyDrop: boolean;
  efficiencyPct: number;
  services: { kind: string; kindName: string; rule: ServiceRuleRow; last: { date: string; odometer: number | null } | null; due: ServiceDue }[];
}

/** Each vehicle's gauge, km per litre and services, live. */
export function useFleetStatus(): { statuses: VehicleStatus[]; loading: boolean } {
  const { vehicles, loading: vLoading } = useVehicles();
  const { data, loading } = useCollection(fleetStore);
  const { data: kinds } = useCollection(expenseKindsStore);
  const statuses = React.useMemo(() => {
    const today = todayIso();
    return vehicles
      .filter((v) => v.active)
      .map((v) => {
        const fills = data.fills.filter((f) => f.vehicleId === v.id);
        const measured = measuredKmPerLitre(fills);
        const kmPerLitre = measured.kmPerLitre ?? v.defaultKmPerLitre;
        const pct = data.efficiencyPct.get(v.id) ?? 20;
        const services = data.rules
          .filter((r) => r.vehicleId === v.id)
          .map((rule) => {
            const done = data.services.filter((s) => s.vehicleId === v.id && s.kind === rule.kind).sort((a, b) => b.date.localeCompare(a.date))[0];
            const last = done ? { date: done.date, odometer: done.odometer } : null;
            return {
              kind: rule.kind,
              kindName: kinds.find((k) => k.id === rule.kind)?.name ?? rule.kind,
              rule,
              last,
              due: serviceDue(rule, last, { day: today, odometer: v.lastReading }),
            };
          });
        return {
          vehicle: v,
          kmPerLitre,
          measured: measured.kmPerLitre != null,
          intervals: measured.intervals,
          level: estimateFuelLevel({
            tankLitres: v.tankLitres,
            kmPerLitre,
            currentOdometer: v.lastReading,
            fills,
            checks: data.checks.filter((c) => c.vehicleId === v.id),
          }),
          efficiencyDrop: efficiencyDropped(measured.intervals, pct),
          efficiencyPct: pct,
          services,
        };
      });
  }, [vehicles, data, kinds]);
  return { statuses, loading: loading || vLoading };
}

/** The driver reads the fuel gauge (0079); stamped by the database. */
export async function recordFuelLevel(vehicleId: string, level: number, odometer: number | null): Promise<MutationResult> {
  const { error } = await createClient().schema("ops").from("fuel_level_checks").insert({ vehicle_id: vehicleId, level, odometer });
  if (error) return { ok: false, error: error.message };
  await fleetStore.refetch();
  return { ok: true };
}

/** Settings, Super Admin only (RLS): a vehicle's service intervals, one row per expense type; empty removes it. */
export async function saveServiceRules(vehicleId: string, rules: { kind: string; everyKm: number | null; everyMonths: number | null }[]): Promise<MutationResult> {
  const ops = createClient().schema("ops");
  const keep = rules.filter((r) => r.everyKm != null || r.everyMonths != null);
  const drop = rules.filter((r) => r.everyKm == null && r.everyMonths == null).map((r) => r.kind);
  if (keep.length) {
    const { error } = await ops
      .from("vehicle_service_rules")
      .upsert(keep.map((r) => ({ vehicle_id: vehicleId, kind: r.kind, every_km: r.everyKm, every_months: r.everyMonths })));
    if (error) return { ok: false, error: error.message };
  }
  if (drop.length) {
    const { error } = await ops.from("vehicle_service_rules").delete().eq("vehicle_id", vehicleId).in("kind", drop);
    if (error) return { ok: false, error: error.message };
  }
  await fleetStore.refetch();
  return { ok: true };
}

export interface PeriodTrip {
  id: string;
  vehicleId: string;
  date: string;
  status: "scheduled" | "in_progress" | "completed";
  direction: string;
  destination: string | null;
  departedAt: string | null;
  odometerStart: number | null;
  odometerEnd: number | null;
  /** What the AI read from the photos behind the readings (0078). */
  aiStart: number | null;
  aiEnd: number | null;
  startPhotoId: string | null;
  endPhotoId: string | null;
}

export interface PeriodExpense {
  vehicleId: string;
  date: string;
  kind: string;
  amount: number;
  litres: number | null;
  paidBy: "laf" | "driver";
}

/** One period's trips and (unvoided) expenses, fetched when the period changes and again when either changes. */
export function usePeriodData(from: string, to: string): { trips: PeriodTrip[]; expenses: PeriodExpense[]; loading: boolean; error: string | null } {
  // The live stores move whenever a trip or an expense does; their data is the refetch signal.
  const { vehicles } = useVehicles();
  const { data: recentExpenses } = useCollection(vehicleExpensesStore);
  const [state, setState] = React.useState<{ trips: PeriodTrip[]; expenses: PeriodExpense[]; loading: boolean; error: string | null }>({ trips: [], expenses: [], loading: true, error: null });

  React.useEffect(() => {
    let live = true;
    (async () => {
      const ops = createClient().schema("ops");
      const [trips, expenses] = await Promise.all([
        ops
          .from("trips")
          .select("id, vehicle_id, date, status, direction, destination, departed_at, odometer_start, odometer_end, start_photo_id, end_photo_id, start:odometer_photos!trips_start_photo_id_fkey(ai_reading), end:odometer_photos!trips_end_photo_id_fkey(ai_reading)")
          .not("vehicle_id", "is", null)
          .gte("date", from)
          .lte("date", to),
        ops.from("vehicle_expenses").select("vehicle_id, expense_date, kind, amount, litres, paid_by").is("voided_at", null).gte("expense_date", from).lte("expense_date", to),
      ]);
      if (!live) return;
      const error = trips.error?.message ?? expenses.error?.message ?? null;
      const one = (x: unknown) => (Array.isArray(x) ? x[0] : x) as { ai_reading: number | null } | null | undefined;
      setState({
        loading: false,
        error,
        trips: (trips.data ?? []).map((t) => ({
          id: t.id,
          vehicleId: t.vehicle_id,
          date: t.date,
          status: t.status,
          direction: t.direction,
          destination: t.destination,
          departedAt: t.departed_at,
          odometerStart: t.odometer_start,
          odometerEnd: t.odometer_end,
          aiStart: one(t.start)?.ai_reading ?? null,
          aiEnd: one(t.end)?.ai_reading ?? null,
          startPhotoId: t.start_photo_id,
          endPhotoId: t.end_photo_id,
        })),
        expenses: (expenses.data ?? []).map((e) => ({
          vehicleId: e.vehicle_id,
          date: e.expense_date,
          kind: e.kind,
          amount: Number(e.amount),
          litres: e.litres == null ? null : Number(e.litres),
          paidBy: e.paid_by,
        })),
      });
    })();
    return () => {
      live = false;
    };
  }, [from, to, vehicles, recentExpenses]);
  return state;
}
