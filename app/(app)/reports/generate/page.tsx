"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/patterns/page-header";
import { SectionCard } from "@/components/patterns/section-card";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { LoadingState } from "@/components/patterns/loading-state";
import { EmptyState } from "@/components/patterns/empty-state";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { PeriodPicker, periodStateWindow, type PeriodState } from "@/components/ui/period-picker";
import { AiAnalysisPanel, ReportToolbar, useReportAnalysis } from "@/components/modules/reports/report-ai";
import { createClient } from "@/lib/supabase/client";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import { useProgramImpact } from "@/lib/hooks/use-program-impact";
import { useDonorsData } from "@/lib/hooks/use-donors-collection";
import { useCafBills } from "@/lib/hooks/use-caf-billing";
import { useRole } from "@/context/role-provider";
import { holdsPower } from "@/lib/rbac/roles";
import { cafAmounts, cafMonthLabel } from "@/lib/utils/caf";
import { bucketsFor, type Grain } from "@/lib/utils/program-impact";
import { GENERATOR_SECTIONS, operationsReport, type Figure, type GeneratorExtras, type GeneratorSectionKey } from "@/lib/utils/operations-report";
import { naturalGrain, periodLabel, previousWindow, type DayWindow, type RangeKind } from "@/lib/utils/period";
import { bucketOf, bucketLabel } from "@/lib/utils/report-series";
import { todayIso } from "@/lib/utils/date";

/** The columns a period is broken into: a day stands alone, a week shows its days, a month its weeks, longer ranges their months. */
function grainFor(kind: RangeKind, window: DayWindow): Grain {
  if (kind === "today" || kind === "week") return "day";
  if (kind === "month") return "week";
  if (kind === "custom") return naturalGrain(window);
  return "month";
}

interface Extra {
  trips: { date: string; km: number; fuel: number }[];
  hours: { date: string; minutes: number; late: boolean }[];
  gifts: { date: string; food: number; nonFood: number }[];
}

/** Transport, staff hours and gifts in kind for a window, read with the viewer's own access. */
function useExtras(window: DayWindow, see: { transport: boolean; hours: boolean; donors: boolean }) {
  const [state, setState] = React.useState<{ key: string; data: Extra } | null>(null);
  const key = `${window.from}|${window.to}|${see.transport}|${see.hours}|${see.donors}`;
  React.useEffect(() => {
    let live = true;
    const ops = () => createClient().schema("ops");
    const none = Promise.resolve([] as never[]);
    void Promise.all([
      see.transport
        ? fetchAll<{ date: string; odometer_start: number | null; odometer_end: number | null; status: string }>((f, t) => ops().from("trips").select("date, odometer_start, odometer_end, status").gte("date", window.from).lte("date", window.to).order("date").range(f, t))
        : none,
      see.transport
        ? fetchAll<{ expense_date: string; amount: number; litres: number | null; voided_at: string | null }>((f, t) => ops().from("vehicle_expenses").select("expense_date, amount, litres, voided_at").gte("expense_date", window.from).lte("expense_date", window.to).order("expense_date").range(f, t))
        : none,
      see.hours ? fetchAll<{ date: string; total_minutes: number | null; flag: string | null }>((f, t) => ops().from("time_entries").select("date, total_minutes, flag").gte("date", window.from).lte("date", window.to).order("date").range(f, t)) : none,
      see.donors ? ops().rpc("gik_batches", { p_from: window.from, p_to: window.to }).then((r) => (r.data ?? []) as { date: string; food_value: number; nonfood_value: number }[]) : none,
    ]).then(([trips, expenses, hours, gifts]) => {
      if (!live) return;
      setState({
        key,
        data: {
          trips: [
            ...trips.filter((t) => t.status !== "cancelled").map((t) => ({ date: t.date, km: t.odometer_start != null && t.odometer_end != null ? Number(t.odometer_end) - Number(t.odometer_start) : 0, fuel: 0, trip: 1 })),
            ...expenses.filter((e) => !e.voided_at && Number(e.litres ?? 0) > 0).map((e) => ({ date: e.expense_date, km: 0, fuel: Number(e.amount), trip: 0 })),
          ],
          hours: hours.map((h) => ({ date: h.date, minutes: Number(h.total_minutes ?? 0), late: h.flag === "late" })),
          gifts: gifts.map((g) => ({ date: g.date, food: Number(g.food_value), nonFood: Number(g.nonfood_value) })),
        },
      });
    });
    return () => {
      live = false;
    };
  }, [window.from, window.to, see.transport, see.hours, see.donors, key]);
  return state?.key === key ? state.data : null;
}

/**
 * Reports > Generate (Nov 2026): one document for any range -- the programs by line, donations,
 * transport, staff hours, NCH billing and the gifts in kind received -- each figure beside the
 * previous range's, with the AI's comparison when kept. Shown first, then printed as the branded PDF.
 */
export default function GeneratePage() {
  return (
    <React.Suspense fallback={<LoadingState />}>
      <Generator />
    </React.Suspense>
  );
}

function Generator() {
  const router = useRouter();
  const params = useSearchParams();
  const today = todayIso();
  const state: PeriodState = React.useMemo(() => {
    const kind = (params.get("range") ?? "month") as RangeKind;
    return { kind: ["today", "week", "month", "quarter", "year", "custom"].includes(kind) ? kind : "month", anchor: params.get("at") ?? today, from: params.get("from") ?? undefined, to: params.get("to") ?? undefined };
  }, [params, today]);
  const setState = (next: PeriodState) => {
    const q = new URLSearchParams(params.toString());
    q.set("range", next.kind);
    q.delete("at");
    q.delete("from");
    q.delete("to");
    if (next.kind === "custom") {
      if (next.from) q.set("from", next.from);
      if (next.to) q.set("to", next.to);
    } else if (next.anchor !== today) q.set("at", next.anchor);
    router.replace(`/reports/generate?${q.toString()}`);
  };
  const window = periodStateWindow(state);
  const previous = previousWindow(state.kind, window);
  const grain = grainFor(state.kind, window);
  const buckets = bucketsFor(window, grain);
  const label = periodLabel(state.kind, window);
  const prevLabel = periodLabel(state.kind, previous);

  const access = useModuleAccess();
  const { roles } = useRole();
  const see = { reports: access.canView("reports"), transport: access.canView("transport"), donors: access.canView("donors"), hours: holdsPower(roles, "runs_hr") || holdsPower(roles, "finance_work"), caf: holdsPower(roles, "caf_billing_view") };
  const [picked, setPicked] = React.useState<Set<GeneratorSectionKey>>(() => new Set(GENERATOR_SECTIONS.map((s) => s.key)));
  const allowed = (k: GeneratorSectionKey) => (k === "donations" || k === "inventory" ? see.donors : k === "staff" ? see.hours : k === "caf" ? see.reports : see.reports);
  const sections = GENERATOR_SECTIONS.map((s) => s.key).filter((k) => picked.has(k) && allowed(k));

  const programs = useProgramImpact(window, grain);
  const programsBefore = useProgramImpact(previous, naturalGrain(previous) === "day" ? "day" : "month");
  const extras = useExtras(window, see);
  const extrasBefore = useExtras(previous, see);
  const { donations } = useDonorsData();
  const { bills } = useCafBills();
  const ai = useReportAnalysis();
  const clearAnalysis = ai.clear;
  React.useEffect(() => clearAnalysis(), [window.from, window.to, clearAnalysis]);

  const inBuckets = <T,>(rows: T[], dateOf: (r: T) => string, sum: (acc: Record<string, number>, r: T) => void) =>
    buckets.map((b) => {
      const acc: Record<string, number> = {};
      rows.filter((r) => bucketOf(dateOf(r), grain) === b.key).forEach((r) => sum(acc, r));
      return { label: b.label, ...acc };
    });
  const fig = (label: string, cur: number, prev: number, unit?: Figure["unit"]): Figure => ({ label, value: cur, previous: prev, unit });

  const cash = (w: DayWindow) => donations.filter((d) => d.kind === "cash" && d.currency === "PHP" && d.date >= w.from && d.date <= w.to);
  const built: GeneratorExtras = {};
  if (extras && extrasBefore) {
    const km = (x: Extra) => x.trips.reduce((s, t) => s + t.km, 0);
    const fuel = (x: Extra) => x.trips.reduce((s, t) => s + t.fuel, 0);
    const tripCount = (x: Extra) => x.trips.filter((t) => (t as { trip?: number }).trip === 1).length;
    built.transport = {
      figures: [fig("Trips", tripCount(extras), tripCount(extrasBefore)), fig("Kilometres", km(extras), km(extrasBefore), "km"), fig("Fuel spent", fuel(extras), fuel(extrasBefore), "PHP")],
      rows: inBuckets(extras.trips, (t) => t.date, (a, t) => {
        a.trips = (a.trips ?? 0) + ((t as { trip?: number }).trip ?? 0);
        a.km = (a.km ?? 0) + t.km;
        a.fuel = (a.fuel ?? 0) + t.fuel;
      }) as { label: string; trips: number; km: number; fuel: number }[],
    };
    const hoursOf = (x: Extra) => Math.round((x.hours.reduce((s, h) => s + h.minutes, 0) / 60) * 10) / 10;
    const lateOf = (x: Extra) => x.hours.filter((h) => h.late).length;
    built.staff = {
      figures: [fig("Hours worked", hoursOf(extras), hoursOf(extrasBefore), "h"), fig("Late arrivals", lateOf(extras), lateOf(extrasBefore))],
      rows: inBuckets(extras.hours, (h) => h.date, (a, h) => {
        a.hours = Math.round(((a.hours ?? 0) + h.minutes / 60) * 10) / 10;
        a.late = (a.late ?? 0) + (h.late ? 1 : 0);
      }) as { label: string; hours: number; late: number }[],
    };
    const food = (x: Extra) => x.gifts.reduce((s, g) => s + g.food, 0);
    const nonFood = (x: Extra) => x.gifts.reduce((s, g) => s + g.nonFood, 0);
    const cashOf = (w: DayWindow) => cash(w).reduce((s, d) => s + d.totalValue, 0);
    built.donations = {
      figures: [fig("Cash gifts", cashOf(window), cashOf(previous), "PHP"), fig("Gifts in kind", food(extras) + nonFood(extras), food(extrasBefore) + nonFood(extrasBefore), "PHP"), fig("Cash gifts (count)", cash(window).length, cash(previous).length)],
      rows: inBuckets([...extras.gifts.map((g) => ({ date: g.date, cash: 0, food: g.food, nonFood: g.nonFood })), ...cash(window).map((d) => ({ date: d.date, cash: d.totalValue, food: 0, nonFood: 0 }))], (r) => r.date, (a, r) => {
        a.cash = (a.cash ?? 0) + r.cash;
        a.food = (a.food ?? 0) + r.food;
        a.nonFood = (a.nonFood ?? 0) + r.nonFood;
      }) as { label: string; cash: number; food: number; nonFood: number }[],
    };
    built.inventory = {
      figures: [fig("Food received", food(extras), food(extrasBefore), "PHP"), fig("Non-food received", nonFood(extras), nonFood(extrasBefore), "PHP")],
      rows: inBuckets(extras.gifts, (g) => g.date, (a, g) => {
        a.food = (a.food ?? 0) + g.food;
        a.nonFood = (a.nonFood ?? 0) + g.nonFood;
      }) as { label: string; food: number; nonFood: number }[],
    };
  }
  if (see.caf) {
    const months = (w: DayWindow) =>
      bills
        .filter((b) => b.month >= `${w.from.slice(0, 7)}-01` && b.month <= w.to)
        .sort((a, b) => a.month.localeCompare(b.month))
        .map((b) => {
          const terms = { rate: b.rate, cap: b.cap, discountPct: b.discountPct };
          const amounts = b.lines.map((l) => cafAmounts(l, terms));
          const due = Math.round(amounts.reduce((s, a) => s + a.net, 0));
          return { label: cafMonthLabel(b.month), billed: due, paid: b.status === "paid" ? due : 0, absorbed: amounts.reduce((s, a) => s + (a.stays - a.billable), 0) };
        });
    const cur = months(window);
    const prev = months(previous);
    const sum = (rows: typeof cur, k: "billed" | "paid" | "absorbed") => rows.reduce((s, r) => s + r[k], 0);
    built.caf = { figures: [fig("Billed", sum(cur, "billed"), sum(prev, "billed"), "PHP"), fig("Paid", sum(cur, "paid"), sum(prev, "paid"), "PHP"), fig("Nights absorbed", sum(cur, "absorbed"), sum(prev, "absorbed"))], rows: cur };
  }

  const ready = !programs.loading && !programsBefore.loading && !!extras && !!extrasBefore;
  const report = () => operationsReport({ sections, rows: programs.rows, previous: programsBefore.rows, buckets, extras: built, period: label, previousPeriod: prevLabel });
  const preview = ready ? report().spec : null;
  const toggle = (k: GeneratorSectionKey) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  if (!see.reports) return <EmptyState title="Reports access is needed" description="Ask an admin to open Reports for your role." />;
  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Generate a report" description="One document for any range: every program, donations, transport, staff hours, NCH billing and the gifts in kind received, each beside the range before. Tick what to include, read it here, then download the branded PDF." />
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PeriodPicker value={state} onChange={setState} />
          <ReportToolbar ai={ai} buildSpec={() => report().spec} buildInput={() => report().input} filename={`LAF-Operations-Report-${window.from}-${window.to}.pdf`} />
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {GENERATOR_SECTIONS.filter((s) => allowed(s.key)).map((s) => (
            <span key={s.key} className="flex items-center gap-2">
              <Checkbox id={`gen-${s.key}`} checked={picked.has(s.key)} onCheckedChange={() => toggle(s.key)} />
              <Label htmlFor={`gen-${s.key}`} className="text-theme-sm font-normal">
                {s.label}
              </Label>
            </span>
          ))}
        </div>
        <p className="text-theme-xs text-muted-foreground">
          {label} compared with {prevLabel}. {bucketLabel(buckets[0]?.key ?? window.from, grain) ? `Columns by ${grain}.` : ""}
        </p>
      </div>
      {programs.error ? <EmptyState title="Couldn't load the programs" description={programs.error} /> : null}
      {!ready ? <LoadingState /> : null}
      <AiAnalysisPanel text={ai.analysis?.overall} />
      {preview?.sections.map((s) => (
        <SectionCard key={s.heading} title={s.heading} description={s.description}>
          {s.kpis?.length ? (
            <KpiGrid>
              {s.kpis.map((k) => (
                <KpiCard key={k.label} label={k.label} value={k.value} sublabel={`${prevLabel}: ${k.previous ?? "—"}${k.change ? ` · ${k.change}` : ""}`} />
              ))}
            </KpiGrid>
          ) : null}
          {s.table ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-theme-sm">
                <thead>
                  <tr className="border-b border-border text-left text-theme-xs text-muted-foreground">
                    {s.table.columns.map((c, i) => (
                      <th key={c} className={`px-2 py-2 font-medium whitespace-nowrap ${i ? "text-right" : ""}`}>
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {s.table.rows.map((r, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      {r.map((v, j) => (
                        <td key={j} className={`px-2 py-1.5 tabular-nums ${j ? "text-right" : "font-medium"}`}>
                          {typeof v === "number" ? v.toLocaleString() : v}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {s.table.totals ? (
                    <tr className="font-semibold">
                      {s.table.totals.map((v, j) => (
                        <td key={j} className={`px-2 py-1.5 tabular-nums ${j ? "text-right" : ""}`}>
                          {typeof v === "number" ? v.toLocaleString() : v}
                        </td>
                      ))}
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : null}
          <AiAnalysisPanel text={ai.analysis?.sections[s.heading]} compact />
        </SectionCard>
      ))}
    </div>
  );
}
