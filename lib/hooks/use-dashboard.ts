"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import { createCollection } from "@/lib/data/collection-store";
import type { DayWindow } from "@/lib/utils/period";
import type { SavedLayout } from "@/lib/utils/dashboard-catalog";

/** What ops.dashboard_figures returns (0147): totals only; a money key is there only when the profile has it. */
export interface DashboardFigures {
  lines: Record<string, number>;
  unique_patients: number;
  enrolled: number;
  since_2024: number;
  prior_years: number;
  cash?: { amount: number; gifts: number };
  gifts?: { food: number; non_food: number; receipts: number };
  expenses?: { amount: number; vouchers: number };
  budget?: { year: number; approved: number; spent: number };
}

/** The dashboard's figures for a period, computed on request. */
export function useDashboardFigures(window: DayWindow) {
  const key = `${window.from}|${window.to}`;
  const [state, setState] = React.useState<{ key: string; data: DashboardFigures | null; error: string | null } | null>(null);
  React.useEffect(() => {
    let live = true;
    void createClient()
      .schema("ops")
      .rpc("dashboard_figures", { p_from: window.from, p_to: window.to })
      .then(({ data, error }) => live && setState({ key, data: (data as DashboardFigures | null) ?? null, error: error?.message ?? null }));
    return () => {
      live = false;
    };
  }, [window.from, window.to, key]);
  return state?.key === key ? { figures: state.data, error: state.error, loading: false } : { figures: null, error: null, loading: true };
}

/** Every role's dashboard profile: which cards it may have (the Super Admin sets them). */
export const dashboardProfilesStore = createCollection<{ role: string; card: string }[]>({
  key: "shared.role_dashboard_cards",
  empty: [],
  tables: [{ schema: "shared", table: "role_dashboard_cards" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("shared").from("role_dashboard_cards").select("role, card");
    if (error) throw new Error(error.message);
    return (data ?? []) as { role: string; card: string }[];
  },
});

/** The signed-in person's own saved dashboard, or null when they never customised it. */
export const myDashboardStore = createCollection<SavedLayout | null>({
  key: "shared.dashboard_layouts",
  empty: null,
  tables: [{ schema: "shared", table: "dashboard_layouts" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("shared").from("dashboard_layouts").select("cards, actions, period").maybeSingle();
    if (error) throw new Error(error.message);
    return (data as SavedLayout | null) ?? null;
  },
});

export async function saveMyDashboard(layout: SavedLayout | null): Promise<string | null> {
  const db = createClient().schema("shared").from("dashboard_layouts");
  const { data: auth } = await createClient().auth.getUser();
  const me = auth.user?.id;
  if (!me) return "Sign in first.";
  const { error } = layout
    ? await db.upsert({ staff_id: me, ...layout, updated_at: new Date().toISOString() })
    : await db.delete().eq("staff_id", me);
  await myDashboardStore.refetch();
  return error?.message ?? null;
}

export async function setProfileCard(role: string, card: string, on: boolean): Promise<string | null> {
  const db = createClient().schema("shared").from("role_dashboard_cards");
  const { error } = on ? await db.insert({ role, card }) : await db.delete().eq("role", role).eq("card", card);
  await dashboardProfilesStore.refetch();
  return error?.message ?? null;
}
