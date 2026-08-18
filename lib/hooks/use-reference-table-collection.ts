"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
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
export function useReferenceTableData(table: string, idPrefix: string, metaColumn?: string) {
  const [rows, setRows] = React.useState<ReferenceRow[]>([]);
  const [loading, setLoading] = React.useState(true);

  const refetch = React.useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.schema("ops").from(table).select("*").order("name");
    setRows(
      ((data ?? []) as Record<string, unknown>[]).map((row) => ({
        id: row.id as string,
        name: row.name as string,
        meta: metaColumn ? ((row[metaColumn] as string | null) ?? undefined) : undefined,
      }))
    );
    setLoading(false);
  }, [table, metaColumn]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from Supabase, an external system
    refetch();
  }, [refetch]);

  async function addRow(name: string, meta?: string): Promise<MutationResult> {
    const supabase = createClient();
    const payload: Record<string, unknown> = { id: newId(idPrefix), name };
    if (metaColumn && meta) payload[metaColumn] = meta;
    const { error } = await supabase.schema("ops").from(table).insert(payload);
    if (error) return { ok: false, error: error.message };
    await refetch();
    return { ok: true };
  }

  async function deleteRow(id: string): Promise<MutationResult> {
    const supabase = createClient();
    const { error } = await supabase.schema("ops").from(table).delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    await refetch();
    return { ok: true };
  }

  return { rows, loading, addRow, deleteRow, refetch };
}
