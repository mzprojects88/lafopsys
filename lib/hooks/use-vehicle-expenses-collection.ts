"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import { todayIso } from "@/lib/utils/date";

export type MutationResult = { ok: true } | { ok: false; error: string };

export interface ExpenseKind {
  id: string;
  name: string;
}

/** One fill-up or expense (0077). */
export interface VehicleExpense {
  id: string;
  vehicleId: string;
  date: string;
  kind: string;
  amount: number;
  litres: number | null;
  fullTank: boolean | null;
  odometer: number | null;
  vendor: string | null;
  notes: string | null;
  paidBy: "laf" | "driver";
  paidByStaffId: string | null;
  loggedBy: string | null;
  loggedAt: string;
  voidedAt: string | null;
  voidReason: string | null;
}

export type ExpenseInput = Omit<VehicleExpense, "id" | "loggedBy" | "loggedAt" | "voidedAt" | "voidReason">;

interface Row {
  id: string;
  vehicle_id: string;
  expense_date: string;
  kind: string;
  amount: number;
  litres: number | null;
  full_tank: boolean | null;
  odometer: number | null;
  vendor: string | null;
  notes: string | null;
  paid_by: "laf" | "driver";
  paid_by_staff_id: string | null;
  logged_by: string | null;
  logged_at: string;
  voided_at: string | null;
  void_reason: string | null;
}

export const expenseKindsStore = createCollection<ExpenseKind[]>({
  key: "ops.vehicle_expense_kinds",
  empty: [],
  tables: [{ schema: "ops", table: "vehicle_expense_kinds" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("ops").from("vehicle_expense_kinds").select("id, name").order("name");
    if (error) throw new Error(error.message);
    return (data ?? []) as ExpenseKind[];
  },
});

// ponytail: the last 92 days, enough for this quarter's list; the Fuel Monitoring totals (phase D) read their own period.
export const vehicleExpensesStore = createCollection<VehicleExpense[]>({
  key: "ops.vehicle_expenses",
  empty: [],
  tables: [{ schema: "ops", table: "vehicle_expenses" }],
  fetch: async () => {
    const since = new Date(`${todayIso()}T00:00:00Z`);
    since.setUTCDate(since.getUTCDate() - 92);
    const { data, error } = await createClient()
      .schema("ops")
      .from("vehicle_expenses")
      .select("id, vehicle_id, expense_date, kind, amount, litres, full_tank, odometer, vendor, notes, paid_by, paid_by_staff_id, logged_by, logged_at, voided_at, void_reason")
      .gte("expense_date", since.toISOString().slice(0, 10))
      .order("expense_date", { ascending: false })
      .order("logged_at", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as Row[]).map((r) => ({
      id: r.id,
      vehicleId: r.vehicle_id,
      date: r.expense_date,
      kind: r.kind,
      amount: Number(r.amount),
      litres: r.litres == null ? null : Number(r.litres),
      fullTank: r.full_tank,
      odometer: r.odometer,
      vendor: r.vendor,
      notes: r.notes,
      paidBy: r.paid_by,
      paidByStaffId: r.paid_by_staff_id,
      loggedBy: r.logged_by,
      loggedAt: r.logged_at,
      voidedAt: r.voided_at,
      voidReason: r.void_reason,
    }));
  },
});

function toRow(e: ExpenseInput) {
  const fuel = e.kind === "fuel";
  return {
    vehicle_id: e.vehicleId,
    expense_date: e.date,
    kind: e.kind,
    amount: e.amount,
    litres: fuel ? e.litres : null,
    full_tank: fuel ? (e.fullTank ?? false) : null,
    odometer: e.odometer,
    vendor: e.vendor?.trim() || null,
    notes: e.notes?.trim() || null,
    paid_by: e.paidBy,
    paid_by_staff_id: e.paidBy === "driver" ? e.paidByStaffId : null,
  };
}

async function done(error: { message: string } | null): Promise<MutationResult> {
  if (error) return { ok: false, error: error.message };
  await vehicleExpensesStore.refetch();
  return { ok: true };
}

export function useVehicleExpenses() {
  const { data: expenses, loading } = useCollection(vehicleExpensesStore);
  const { data: kinds } = useCollection(expenseKindsStore);
  const ops = () => createClient().schema("ops");
  return {
    expenses,
    kinds,
    loading,
    kindName: (id: string) => kinds.find((k) => k.id === id)?.name ?? id,
    /** Resolves to the new entry's id, for its receipt. The database stamps who logged it. */
    logExpense: async (e: ExpenseInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> => {
      const { data, error } = await ops().from("vehicle_expenses").insert(toRow(e)).select("id").single();
      if (error) return { ok: false, error: error.message };
      await vehicleExpensesStore.refetch();
      return { ok: true, id: data.id as string };
    },
    /** Same day by whoever logged it; later, the Super Admin with a reason (kept in the change history). */
    editExpense: async (id: string, e: ExpenseInput, reason?: string) =>
      done((await ops().from("vehicle_expenses").update({ ...toRow(e), change_reason: reason?.trim() || null }).eq("id", id)).error),
    voidExpense: async (id: string, reason: string) =>
      done((await ops().from("vehicle_expenses").update({ voided_at: new Date().toISOString(), void_reason: reason.trim() }).eq("id", id)).error),
  };
}
