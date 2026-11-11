"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection, type Collection } from "@/lib/data/collection-store";
import { fetchAll } from "@/lib/supabase/fetch-all";
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
/** Every row, a page of 1,000 at a time (the API's cap), in an order that pages the same way each time. */
const store = <T>(table: string, order: string[], map: (r: Row) => T): Collection<T[]> =>
  createCollection<T[]>({
    key: `ops.${table}`,
    empty: [],
    tables: [{ schema: "ops", table }],
    fetch: async () => {
      const rows = await fetchAll<Row>((from, to) => order.reduce((q, col) => q.order(col), createClient().schema("ops").from(table).select("*")).range(from, to));
      return rows.map(map);
    },
  });

export const goalsStore = store<Goal>("goals", ["sort", "id"], (r) => ({
  id: String(r.id), title: String(r.title), horizon: Number(r.horizon) as Goal["horizon"], startYear: Number(r.start_year), programId: s(r.program_id),
  measure: r.measure as GoalMeasure, narrative: s(r.narrative), status: r.status as Goal["status"], sort: Number(r.sort ?? 0),
}));
export const goalTargetsStore = store<GoalTarget>("goal_targets", ["goal_id", "year"], (r) => ({ goalId: String(r.goal_id), year: Number(r.year), target: Number(r.target) }));
export const budgetsStore = store<Budget>("budgets", ["year", "version"], (r) => ({
  id: String(r.id), year: Number(r.year), version: Number(r.version), status: r.status as Budget["status"], note: s(r.note), revisionReason: s(r.revision_reason),
  approvedBy: s(r.approved_by), approvedAt: s(r.approved_at),
}));
export const budgetItemsStore = store<BudgetItem>("budget_items", ["sort", "id"], (r) => ({
  id: String(r.id), budgetId: String(r.budget_id), t3Id: s(r.t3_id), label: String(r.label), unit: s(r.unit), measure: (r.measure as Measure | null) ?? null, accountId: s(r.account_id), sort: Number(r.sort ?? 0),
}));
export const budgetValuesStore = store<BudgetValue>("budget_values", ["item_id", "month"], (r) => ({ itemId: String(r.item_id), month: Number(r.month), quantity: n(r.quantity), amount: n(r.amount) }));

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

/** Saves a goal and its yearly targets in one transaction (ops.goal_save; the targets replace the earlier ones). */
export const saveGoal = async (id: string | null, goal: Omit<Goal, "id">, targets: { year: number; target: number }[]) =>
  done<string>(await ops().rpc("goal_save", {
    p_id: id,
    p_goal: { title: goal.title, horizon: goal.horizon, start_year: goal.startYear, program_id: goal.programId, measure: goal.measure, narrative: goal.narrative, status: goal.status, sort: goal.sort },
    p_targets: targets,
  }), [goalsStore, goalTargetsStore]);
export const removeGoal = async (id: string) => done(await ops().from("goals").delete().eq("id", id), [goalsStore, goalTargetsStore]);

export const startBudget = async (year: number) => done<{ id: string }>(await ops().from("budgets").insert({ year }).select("id").single(), [budgetsStore]);
/** Adds or changes a draft's item with its 12 months in one transaction (ops.budget_save_item): all of it, or none. */
export const saveBudgetItem = async (id: string | null, item: Omit<BudgetItem, "id">, months: { quantity: number | null; amount: number | null }[]) =>
  done<string>(await ops().rpc("budget_save_item", {
    p_id: id,
    p_item: { budget_id: item.budgetId, t3_id: item.t3Id, label: item.label, unit: item.unit, measure: item.measure, account_id: item.accountId, sort: item.sort },
    p_months: months,
  }), [budgetItemsStore, budgetValuesStore]);
export const removeBudgetItem = async (id: string) => done(await ops().from("budget_items").delete().eq("id", id), [budgetItemsStore, budgetValuesStore]);
export const approveBudget = async (id: string) => done(await ops().rpc("budget_approve", { p_id: id }), [budgetsStore]);
export const reviseBudget = async (id: string, reason: string) => done<string>(await ops().rpc("budget_revise", { p_id: id, p_reason: reason }), [budgetsStore, budgetItemsStore, budgetValuesStore]);
