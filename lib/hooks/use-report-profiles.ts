"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import { createCollection } from "@/lib/data/collection-store";
import type { DayWindow } from "@/lib/utils/period";

export type ChartStyle = "chart" | "rank" | "table" | "figures";
export type Comparison = "previous" | "ytd" | "goal";

/** A saved report design (0150). */
export interface ReportProfile {
  id: string;
  name: string;
  description: string;
  sections: string[];
  charts: Record<string, ChartStyle>;
  comparisons: Comparison[];
  columnsMode: "total" | "columns";
  period: string;
  fundCode: string | null;
  includeAi: boolean;
  builtIn: boolean;
  sort: number;
}

export const reportProfilesStore = createCollection<ReportProfile[]>({
  key: "ops.report_profiles",
  empty: [],
  tables: [{ schema: "ops", table: "report_profiles" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("ops").from("report_profiles").select("*").order("sort").order("name");
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      id: String(r.id),
      name: String(r.name),
      description: String(r.description ?? ""),
      sections: (r.sections ?? []) as string[],
      charts: (r.charts ?? {}) as Record<string, ChartStyle>,
      comparisons: (r.comparisons ?? []) as Comparison[],
      columnsMode: r.columns_mode === "columns" ? "columns" : "total",
      period: String(r.period),
      fundCode: (r.fund_code as string | null) ?? null,
      includeAi: Boolean(r.include_ai),
      builtIn: Boolean(r.built_in),
      sort: Number(r.sort ?? 0),
    }));
  },
});

export type ProfileInput = Omit<ReportProfile, "id" | "builtIn">;

/** Saves a profile (new when id is null); the database decides who may (the Super Admin, the CEO, Finance). Gives
 * the profile's id, or the error. */
export async function saveReportProfile(id: string | null, p: ProfileInput): Promise<{ id: string } | { error: string }> {
  const row = { name: p.name.trim(), description: p.description.trim(), sections: p.sections, charts: p.charts, comparisons: p.comparisons, columns_mode: p.columnsMode, period: p.period, fund_code: p.fundCode || null, include_ai: p.includeAi, sort: p.sort };
  const t = createClient().schema("ops").from("report_profiles");
  const { data, error } = id ? await t.update(row).eq("id", id).select("id").single() : await t.insert(row).select("id").single();
  await reportProfilesStore.refetch();
  if (error || !data) return { error: error?.code === "23505" ? "A profile with that name exists already." : (error?.message ?? "Not saved.") };
  return { id: String(data.id) };
}

export async function deleteReportProfile(id: string): Promise<string | null> {
  const { error } = await createClient().schema("ops").from("report_profiles").delete().eq("id", id);
  await reportProfilesStore.refetch();
  return error?.message ?? null;
}

/** What ops.report_extra returns (0150): occupancy always; expenses only for a profile with the Expenses card. */
export interface ReportExtra {
  occupancy: { beds: number; regular_beds: number; days: number; family_nights: number; busiest: { night: string; families: number } | null; empty_nights: number };
  expenses?: { total: number; vouchers: number; budget: number | null; by_account: { code: string; name: string; amount: number }[]; by_fund: { code: string; name: string; amount: number }[] };
}

/** The new sections' figures for a range (and one fund for the expenses), computed on request. */
export function useReportExtra(window: DayWindow, fund: string | null, enabled = true) {
  const key = `${window.from}|${window.to}|${fund ?? ""}`;
  const [state, setState] = React.useState<{ key: string; data: ReportExtra | null; error: string | null } | null>(null);
  React.useEffect(() => {
    if (!enabled) return;
    let live = true;
    void createClient()
      .schema("ops")
      .rpc("report_extra", { p_from: window.from, p_to: window.to, p_fund: fund })
      .then(({ data, error }) => live && setState({ key, data: (data as ReportExtra | null) ?? null, error: error?.message ?? null }));
    return () => {
      live = false;
    };
  }, [window.from, window.to, fund, key, enabled]);
  if (!enabled) return { data: null, error: null, loading: false };
  return state?.key === key ? { data: state.data, error: state.error, loading: false } : { data: null, error: null, loading: true };
}
