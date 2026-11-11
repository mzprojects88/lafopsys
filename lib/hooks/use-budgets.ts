"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection, type Collection } from "@/lib/data/collection-store";
import type { GoalMeasure, Measure } from "@/lib/utils/budgets";

/**
 * Goals and budgets (0137), as the database lets the person read them: goals for the CEO, the Trustees and the
 * Super Admin; budgets for Finance, the CEO, the Trustees and the Super Admin. Drafts are written directly (the
 * database allows it only on drafts, to their editors); approving and revising go through its functions.
 */
export interface Goal {
  id: string;
  title: string;
  horizon: 1 | 3 | 5;
  startYear: number;
  programId: string | null;
  measure: GoalMeasure;
  narrative: string | null;
  status: "active" | "achieved" | "dropped";
  sort: number;
}
export interface GoalTarget {
  goalId: string;
  year: number;
  target: number;
}
export interface Budget {
  id: string;
  year: number;
  version: number;
  status: "draft" | "approved" | "superseded";
  note: string | null;
  revisionReason: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
}
export interface BudgetItem {
  id: string;
  budgetId: string;
  t3Id: string | null;
  label: string;
  unit: string | null;
  measure: Measure | null;
  accountId: string | null;
  sort: number;
}
export interface BudgetValue {
  itemId: string;
  month: number;
  quantity: number | null;
  amount: number | null;
}

type Row = Record<string, unknown>;
const n = (v: unknown) => (v == null ? null : Number(v));
const s = (v: unknown) => (v == null ? null : String(v));
const store = <T>(table: string, order: string, map: (r: Row) => T): Collection<T[]> =>
  createCollection<T[]>({
    key: `ops.${table}`,
    empty: [],
    tables: [{ schema: "ops", table }],
    fetch: async () => {
      const { data, error } = await createClient().schema("ops").from(table).select("*").order(order);
      if (error) throw new Error(error.message);
      return ((data ?? []) as Row[]).map(map);
    },
  });

export const goalsStore = store<Goal>("goals", "sort", (r) => ({
  id: String(r.id), title: String(r.title), horizon: Number(r.horizon) as Goal["horizon"], startYear: Number(r.start_year), programId: s(r.program_id),
  measure: r.measure as GoalMeasure, narrative: s(r.narrative), status: r.status as Goal["status"], sort: Number(r.sort ?? 0),
}));
export const goalTargetsStore = store<GoalTarget>("goal_targets", "year", (r) => ({ goalId: String(r.goal_id), year: Number(r.year), target: Number(r.target) }));
export const budgetsStore = store<Budget>("budgets", "version", (r) => ({
  id: String(r.id), year: Number(r.year), version: Number(r.version), status: r.status as Budget["status"], note: s(r.note), revisionReason: s(r.revision_reason),
  approvedBy: s(r.approved_by), approvedAt: s(r.approved_at),
}));
export const budgetItemsStore = store<BudgetItem>("budget_items", "sort", (r) => ({
  id: String(r.id), budgetId: String(r.budget_id), t3Id: s(r.t3_id), label: String(r.label), unit: s(r.unit), measure: (r.measure as Measure | null) ?? null, accountId: s(r.account_id), sort: Number(r.sort ?? 0),
}));
export const budgetValuesStore = store<BudgetValue>("budget_values", "month", (r) => ({ itemId: String(r.item_id), month: Number(r.month), quantity: n(r.quantity), amount: n(r.amount) }));

export function useGoals() {
  const { data: goals, loading } = useCollection(goalsStore);
  const { data: targets } = useCollection(goalTargetsStore);
  return { goals, targets, loading };
}
export function useBudgets() {
  const { data: budgets, loading } = useCollection(budgetsStore);
  const { data: items } = useCollection(budgetItemsStore);
  const { data: values } = useCollection(budgetValuesStore);
  return { budgets, items, values, loading };
}

type Result<T = null> = { ok: true; value: T } | { ok: false; error: string };
const ops = () => createClient().schema("ops");
const done = async <T>(r: { data: unknown; error: { message: string } | null }, stores: Collection<unknown[]>[]): Promise<Result<T>> => {
  if (r.error) return { ok: false, error: r.error.message };
  await Promise.all(stores.map((x) => x.refetch()));
  return { ok: true, value: r.data as T };
};

/** Saves a goal and its yearly targets (the targets replace the goal's earlier ones). */
export async function saveGoal(id: string | null, goal: Omit<Goal, "id">, targets: { year: number; target: number }[]): Promise<Result<string>> {
  const row = { title: goal.title, horizon: goal.horizon, start_year: goal.startYear, program_id: goal.programId, measure: goal.measure, narrative: goal.narrative, status: goal.status, sort: goal.sort };
  const saved = id ? await ops().from("goals").update(row).eq("id", id).select("id").single() : await ops().from("goals").insert(row).select("id").single();
  if (saved.error) return { ok: false, error: saved.error.message };
  const goalId = String((saved.data as Row).id);
  const del = await ops().from("goal_targets").delete().eq("goal_id", goalId);
  if (del.error) return { ok: false, error: del.error.message };
  if (targets.length) {
    const ins = await ops().from("goal_targets").insert(targets.map((t) => ({ goal_id: goalId, year: t.year, target: t.target })));
    if (ins.error) return { ok: false, error: ins.error.message };
  }
  await Promise.all([goalsStore.refetch(), goalTargetsStore.refetch()]);
  return { ok: true, value: goalId };
}
export const removeGoal = async (id: string) => done(await ops().from("goals").delete().eq("id", id), [goalsStore, goalTargetsStore]);

export const startBudget = async (year: number) => done<{ id: string }>(await ops().from("budgets").insert({ year }).select("id").single(), [budgetsStore]);
/** Adds or changes an item of a draft and sets its 12 months (quantity and/or amount, null where it doesn't apply). */
export async function saveBudgetItem(id: string | null, item: Omit<BudgetItem, "id">, months: { quantity: number | null; amount: number | null }[]): Promise<Result<string>> {
  const row = { budget_id: item.budgetId, t3_id: item.t3Id, label: item.label, unit: item.unit, measure: item.measure, account_id: item.accountId, sort: item.sort };
  const saved = id ? await ops().from("budget_items").update(row).eq("id", id).select("id").single() : await ops().from("budget_items").insert(row).select("id").single();
  if (saved.error) return { ok: false, error: saved.error.message };
  const itemId = String((saved.data as Row).id);
  const up = await ops().from("budget_values").upsert(months.map((m, i) => ({ item_id: itemId, month: i + 1, quantity: m.quantity, amount: m.amount })), { onConflict: "item_id,month" });
  if (up.error) return { ok: false, error: up.error.message };
  await Promise.all([budgetItemsStore.refetch(), budgetValuesStore.refetch()]);
  return { ok: true, value: itemId };
}
export const removeBudgetItem = async (id: string) => done(await ops().from("budget_items").delete().eq("id", id), [budgetItemsStore, budgetValuesStore]);
export const approveBudget = async (id: string) => done(await ops().rpc("budget_approve", { p_id: id }), [budgetsStore]);
export const reviseBudget = async (id: string, reason: string) => done<string>(await ops().rpc("budget_revise", { p_id: id, p_reason: reason }), [budgetsStore, budgetItemsStore, budgetValuesStore]);
