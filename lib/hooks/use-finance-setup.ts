"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection, type Collection } from "@/lib/data/collection-store";

/**
 * Financial Settings (0133): the chart of accounts, the T codes, expense types, the general settings, the
 * approval authority, cash funds, withholding rates and payees, as the database holds them (snake_case rows),
 * plus the change log and the setup checklist. Writes go straight to the tables; the database allows them
 * only to holders of "Sets up Finance" and logs each one.
 */
export type SetupTable = "coa_accounts" | "fin_codes" | "expense_types" | "finance_settings" | "voucher_authority" | "cash_funds" | "ewt_rates" | "payees";
export type SetupRow = Record<string, unknown> & { id?: string; review_note?: string | null };

const ORDER: Record<SetupTable, string> = {
  coa_accounts: "sort",
  fin_codes: "sort",
  expense_types: "sort",
  finance_settings: "id",
  voucher_authority: "min_amount",
  cash_funds: "name",
  ewt_rates: "atc",
  payees: "name",
};
const KEY: Partial<Record<SetupTable, string>> = { ewt_rates: "atc" };
export const keyOf = (table: SetupTable, row: SetupRow) => String(row[KEY[table] ?? "id"]);

const stores = Object.fromEntries(
  (Object.keys(ORDER) as SetupTable[]).map((table) => [
    table,
    createCollection<SetupRow[]>({
      key: `ops.${table}`,
      empty: [],
      tables: [{ schema: "ops", table }],
      fetch: async () => {
        const { data, error } = await createClient().schema("ops").from(table).select("*").order(ORDER[table]);
        if (error) throw new Error(error.message);
        return (data ?? []) as SetupRow[];
      },
    }),
  ])
) as Record<SetupTable, Collection<SetupRow[]>>;

export function useSetupRows(table: SetupTable) {
  return useCollection(stores[table]);
}

type Result = { ok: true } | { ok: false; error: string };

/** The database's refusals in plain words; anything else as it came. */
function plain(error: { code?: string; message: string }): string {
  if (error.code === "23505") return "Two rows would share a code: give one a new code first (for example one of the two 5204s).";
  if (error.code === "23503") return "It is still used elsewhere (an expense type, a fund, a payee or a signer): change those first.";
  if (error.code === "23514" && /coa_accounts_check/.test(error.message)) return "A row without a code can't be settled: give it a code, or remove it.";
  return error.message;
}

/** Adds a row (no key) or changes it. */
export async function saveSetupRow(table: SetupTable, key: string | null, values: SetupRow): Promise<Result> {
  const q = createClient().schema("ops").from(table);
  const { error } = key ? await q.update(values).eq(KEY[table] ?? "id", key) : await q.insert(values);
  if (error) return { ok: false, error: plain(error) };
  await stores[table].refetch();
  return { ok: true };
}

export async function removeSetupRow(table: SetupTable, key: string): Promise<Result> {
  const { error } = await createClient().schema("ops").from(table).delete().eq(KEY[table] ?? "id", key);
  if (error) return { ok: false, error: plain(error) };
  await stores[table].refetch();
  return { ok: true };
}

/** Clears the open review notes of these rows at once (a card's "Settle all" button). */
export async function settleAll(table: SetupTable, keys: string[]): Promise<Result> {
  const { error } = await createClient().schema("ops").from(table).update({ review_note: null }).in(KEY[table] ?? "id", keys);
  if (error) return { ok: false, error: plain(error) };
  await stores[table].refetch();
  return { ok: true };
}

export interface SetupChecklist {
  ready: boolean;
  items: { key: string; label: string; done: boolean; detail: string }[];
}

/** What is still open before the first payment request (ops.finance_setup_checklist). */
export const setupChecklistStore = createCollection<SetupChecklist | null>({
  key: "ops.finance_setup_checklist",
  empty: null,
  tables: [...(Object.keys(ORDER) as SetupTable[]).map((table) => ({ schema: "ops" as const, table })), { schema: "ops", table: "programs" }, { schema: "shared", table: "staff" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("ops").rpc("finance_setup_checklist");
    if (error) throw new Error(error.message);
    return data as SetupChecklist;
  },
});

export interface SetupLogRow {
  id: string;
  changed_at: string;
  changed_by: string | null;
  table_name: string;
  action: "INSERT" | "UPDATE" | "DELETE";
  before: SetupRow | null;
  after: SetupRow | null;
}

export const setupLogStore = createCollection<SetupLogRow[]>({
  key: "ops.finance_setup_log",
  empty: [],
  tables: [{ schema: "ops", table: "finance_setup_log" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("ops").from("finance_setup_log").select("*").order("changed_at", { ascending: false }).limit(100);
    if (error) throw new Error(error.message);
    return (data ?? []) as SetupLogRow[];
  },
});
