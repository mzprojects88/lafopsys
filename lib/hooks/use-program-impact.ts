"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import type { ImpactLine, ImpactRow } from "@/lib/utils/program-impact";

/** The report rows for one year (ops.program_impact, 0112): computed on request from the live tables. */
export function useProgramImpact(year: number, refreshKey = 0) {
  const [state, setState] = React.useState<{ key: string; rows: ImpactRow[]; error: string | null } | null>(null);
  const key = `${year}|${refreshKey}`;
  React.useEffect(() => {
    let live = true;
    void createClient()
      .schema("ops")
      .rpc("program_impact", { p_year: year })
      .then(({ data, error }) => {
        if (!live) return;
        setState({
          key,
          rows: error ? [] : ((data ?? []) as Record<string, unknown>[]).map((r) => ({ line: String(r.line) as ImpactLine, month: Number(r.month), native: Number(r.native), fromSheet: Number(r.from_sheet) })),
          error: error?.message ?? null,
        });
      });
    return () => {
      live = false;
    };
  }, [year, key]);
  return state?.key === key ? { rows: state.rows, error: state.error, loading: false } : { rows: [] as ImpactRow[], error: null, loading: true };
}

export type HistoryLine = "housing" | "transportation" | "meals" | "center" | "care_cart";
export interface ProgramHistoryRow {
  year: number;
  line: HistoryLine;
  value: number;
}

export const programHistoryStore = createCollection<ProgramHistoryRow[]>({
  key: "ops.program_history",
  empty: [],
  tables: [{ schema: "ops", table: "program_history" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("ops").from("program_history").select("year, line, value").order("year");
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({ year: Number(r.year), line: r.line as HistoryLine, value: Number(r.value) }));
  },
});

/** The typed prior-year totals (the website's 2024 / 2025 columns); finance work or admin write them. */
export function useProgramHistory() {
  const { data: history, loading } = useCollection(programHistoryStore);
  const save = React.useCallback(async (rows: ProgramHistoryRow[]): Promise<{ ok: true } | { ok: false; error: string }> => {
    const { error } = await createClient().schema("ops").from("program_history").upsert(rows.map((r) => ({ year: r.year, line: r.line, value: r.value })), { onConflict: "year,line" });
    return error ? { ok: false, error: error.message } : { ok: true };
  }, []);
  return { history, loading, save };
}
