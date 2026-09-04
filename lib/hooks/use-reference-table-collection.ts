"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollectionFamily, useCollection } from "@/lib/data/collection-store";
import { newId } from "@/lib/utils/id";

export type MutationResult = { ok: true } | { ok: false; error: string };

export interface ReferenceRow {
  id: string;
  name: string;
  meta?: string;
}

/** Generic CRUD over a real ops.* reference table shaped like
 * `(id text pk, name text, <metaColumn> text)`. Used by the Settings >
 * Reference Data editor for provinces/treatment-phases/programs, where the
 * "meta" column is a free-text sibling column (region/description). Tables
 * with a constrained (check-enum) meta column, like diagnoses.category,
 * are NOT safe to write through this generic path -- see
 * use-diagnoses-reference-collection.ts instead. */
/** One store per (table, metaColumn) pair -- the meta column changes the row shape. */
function parseKey(key: string): { table: string; metaColumn?: string } {
  const sep = key.indexOf("|");
  return { table: key.slice(0, sep), metaColumn: key.slice(sep + 1) || undefined };
}

const referenceTables = createCollectionFamily<ReferenceRow[]>({
  key: "ops.reference",
  empty: [],
  tables: (key) => [{ schema: "ops", table: parseKey(key).table }],
  fetch: async (key) => {
    const { table, metaColumn } = parseKey(key);
    const { data, error } = await createClient().schema("ops").from(table).select("*").order("name");
    if (error) throw new Error(error.message);
    return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: row.id as string,
      name: row.name as string,
      meta: metaColumn ? ((row[metaColumn] as string | null) ?? undefined) : undefined,
    }));
  },
});

export function useReferenceTableData(table: string, idPrefix: string, metaColumn?: string) {
  const store = referenceTables.get(`${table}|${metaColumn ?? ""}`);
  const { data: rows, loading } = useCollection(store);

  async function addRow(name: string, meta?: string): Promise<MutationResult> {
    const supabase = createClient();
    const payload: Record<string, unknown> = { id: newId(idPrefix), name };
    if (metaColumn && meta) payload[metaColumn] = meta;
    const { error } = await supabase.schema("ops").from(table).insert(payload);
    if (error) return { ok: false, error: error.message };
    await store.refetch();
    return { ok: true };
  }

  async function deleteRow(id: string): Promise<MutationResult> {
    const supabase = createClient();
    const { error } = await supabase.schema("ops").from(table).delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    await store.refetch();
    return { ok: true };
  }

  return { rows, loading, addRow, deleteRow, refetch: store.refetch };
}
