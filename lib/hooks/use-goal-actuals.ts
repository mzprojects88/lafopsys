"use client";

import * as React from "react";
import { useGoals, type Goal } from "@/lib/hooks/use-budgets";
import { useProgramImpact } from "@/lib/hooks/use-program-impact";
import { useProgramsData } from "@/lib/hooks/use-programs-collection";
import { useDonorsData } from "@/lib/hooks/use-donors-collection";
import { useVouchers } from "@/lib/hooks/use-vouchers";
import { measureTotal, type GoalMeasure, type Measure } from "@/lib/utils/budgets";
import { countedDay, settledAdvances } from "@/lib/utils/vouchers";

export const moneyGoal = (m: GoalMeasure) => m === "donations" || m === "spending";

/**
 * The goals (0137) and what ArkOS counts against each, by year: one rule for Executive › Goals and the dashboard's
 * Goals card. Programs from the Program Impact lines (the app's figure, else the sheet's); money raised from every
 * gift on the donor ledger; spending from the vouchers on the day Finance prepared them (Budgets' rule), a program's
 * goal counting the spending coded to its program (T3). `onlyYear` (the card) reads just that year.
 */
export function useGoalActuals(onlyYear?: number) {
  const { goals, targets, loading: goalsLoading } = useGoals();
  const { programs } = useProgramsData();
  const { donations, loading: donorsLoading } = useDonorsData();
  const { vouchers, lines, events, loading: vouchersLoading, linesLoading } = useVouchers();
  const years = goals.flatMap((g) => Array.from({ length: g.horizon }, (_, i) => g.startYear + i));
  const from = onlyYear ?? (years.length ? Math.min(...years) : new Date().getFullYear());
  const to = onlyYear ?? (years.length ? Math.max(...years) : from);
  const impact = useProgramImpact({ from: `${from}-01-01`, to: `${to}-12-31` }, "month", 0, goals.length > 0);
  // The year each voucher line counts in, worked out once per change of the vouchers.
  const yearOf = React.useMemo(() => {
    const preparedOn = new Map(events.filter((e) => e.action === "prepare").map((e) => [e.voucherId, e.at]));
    const settled = settledAdvances(vouchers);
    return new Map(vouchers.map((v) => [v.id, countedDay(v, preparedOn.get(v.id), settled)?.slice(0, 4) ?? null]));
  }, [vouchers, events]);

  const actual = (g: Goal, year: number): number | null => {
    if (g.measure === "none") return null;
    if (g.measure === "donations") return donations.filter((d) => String(d.date ?? "").startsWith(String(year))).reduce((s, d) => s + Number(d.totalValue ?? 0), 0);
    if (g.measure === "spending") {
      const t3 = g.programId ? (programs.find((p) => p.id === g.programId)?.t3Id ?? null) : null;
      return lines.filter((l) => yearOf.get(l.voucherId) === String(year) && (!g.programId || l.t3Id === t3)).reduce((s, l) => s + l.amount, 0);
    }
    return measureTotal(impact.rows.filter((r) => r.bucket.startsWith(String(year))), g.measure as Measure);
  };
  const target = (g: Goal, year: number) => targets.find((t) => t.goalId === g.id && t.year === year)?.target ?? null;
  return {
    goals,
    targets,
    /** The goals themselves (the page shows them, and its empty state, as soon as they load). */
    goalsLoading,
    /** Everything the figures need (the card scores nothing before this). */
    loading: goalsLoading || donorsLoading || vouchersLoading || linesLoading || impact.loading,
    error: impact.error,
    actual,
    target,
  };
}
