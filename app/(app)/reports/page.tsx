"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download, FolderOpen, List, Pencil, Plus } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProfileEditor } from "@/components/modules/reports/profile-editor";
import { useCollection } from "@/lib/data/collection-store";
import { reportProfilesStore, useReportExtra, type ReportExtra, type ReportProfile } from "@/lib/hooks/use-report-profiles";
import { dashboardProfilesStore, useDashboardFigures, type DashboardFigures } from "@/lib/hooks/use-dashboard";
import { csvLines, downloadCsv } from "@/lib/utils/csv";
import { useSetupRows } from "@/lib/hooks/use-finance-setup";
import type { Role } from "@/lib/types/common";
import { ModuleSubNav } from "@/components/patterns/module-subnav";
import { PeriodPresetsBar, usePeriodPresets } from "@/components/patterns/period-presets";
import { Button } from "@/components/ui/button";
import { ReportLinks } from "@/components/modules/reports/report-links";
import { useGoals } from "@/lib/hooks/use-budgets";
import { MEASURES, type Measure } from "@/lib/utils/budgets";
import { PageHeader } from "@/components/patterns/page-header";
import { SectionCard } from "@/components/patterns/section-card";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { LoadingState } from "@/components/patterns/loading-state";
import { EmptyState } from "@/components/patterns/empty-state";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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
import { bucketsFor, periodGrain, type Grain } from "@/lib/utils/program-impact";
import { GENERATOR_SECTIONS, operationsReport, type Figure, type GeneratorExtras, type GeneratorSectionKey } from "@/lib/utils/operations-report";
import { periodLabel, periodWindow, previousWindow, type DayWindow, type RangeKind } from "@/lib/utils/period";
import { addDays } from "@/lib/utils/dtr";
import { bucketOf } from "@/lib/utils/report-series";
import { todayIso } from "@/lib/utils/date";

/** What a window is, by its shape, so a whole month picked as two dates still compares with the month before: a
 * day with the day before, a calendar week, month, quarter or year with the one before, anything else with the same
 * number of days before it. */
function kindOf(w: DayWindow): RangeKind {
  if (w.from === w.to) return "today";
  for (const k of ["week", "month", "quarter", "year"] as const) {
    const p = periodWindow(k, w.from);
    if (p.from === w.from && p.to === w.to) return k;
  }
  return "custom";
}
const GRAIN_WORD: Record<Grain, string> = { day: "By day", week: "By week", month: "By month" };
/** The Programs group each goal measure belongs to. */
const GOAL_GROUP: Record<Measure, string> = { housing: "Housing", rides: "Transportation", meals: "Meals @ LAF House", care_cart: "Care Cart", center: "LAF Center @ NCH" };

interface Extra {
  /** The reads failed: the figures are missing, not zero. */
  failed?: boolean;
  trips: { date: string; km: number; fuel: number }[];
  hours: { date: string; minutes: number; late: boolean }[];
  gifts: { date: string; food: number; nonFood: number }[];
}

/** Transport, staff hours and gifts in kind for a window, read with the viewer's own access. */
function useExtras(window: DayWindow, see: { transport: boolean; hours: boolean; donors: boolean }, enabled = true) {
  const [state, setState] = React.useState<{ key: string; data: Extra } | null>(null);
  const key = `${window.from}|${window.to}|${see.transport}|${see.hours}|${see.donors}`;
  React.useEffect(() => {
    if (!enabled) return;
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
    }).catch(() => live && setState({ key, data: { failed: true, trips: [], hours: [], gifts: [] } }));
    return () => {
      live = false;
    };
  }, [window.from, window.to, see.transport, see.hours, see.donors, key, enabled]);
  return state?.key === key ? state.data : null;
}

/**
 * Reports (the landing page since Nov 2026): one document for the chosen period -- the programs by line, donations,
 * transport, staff hours, NCH billing and the gifts in kind received -- each figure beside the previous period's with
 * its variance, the year to date and the year's goal, with the AI's comparison when kept. Shown first, then printed
 * as the branded PDF. The links to the reports inside each module open on request.
 */
export default function ReportsPage() {
  return (
    <React.Suspense fallback={<LoadingState />}>
      <Generator />
    </React.Suspense>
  );
}

function Generator() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const today = todayIso();
  // One period for the whole page (the chips every page uses); a month runs from its day 1 to its last day.
  const period = usePeriodPresets("reports", "this_month");
  const window = period.window!;
  const kind = kindOf(window);
  const previous = previousWindow(kind, window);
  // Counted as the dashboard counts the same period; shown as totals, or in those columns (a year by month).
  const grain = periodGrain(window);
  const { data: profiles } = useCollection(reportProfilesStore);
  const profile = profiles.find((p) => p.id === params.get("profile")) ?? null;
  const cols = params.get("cols") ?? profile?.columnsMode ?? (grain === "month" ? "columns" : "total");
  const totalsOnly = cols !== "columns";
  const setCols = (v: string) => {
    const q = new URLSearchParams(params.toString());
    q.set("cols", v);
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  };
  const buckets = bucketsFor(window, grain);
  const label = periodLabel(kind, window);
  const prevLabel = periodLabel(kind, previous);
  // Year to date: 1 January of the year the period ends in (today at the latest, unless the period is all ahead).
  const ytdEnd = window.to > today && window.from <= today ? today : window.to;
  const year = Number(ytdEnd.slice(0, 4));
  const ytdWindow = React.useMemo(() => ({ from: `${ytdEnd.slice(0, 4)}-01-01`, to: ytdEnd }), [ytdEnd]);
  const ytdLabel = `YTD ${year}`;
  // The programs' year to date = 1 January to the day before the period, plus the period's own figure (so the two
  // are counted alike and a period never exceeds its year to date); nothing to ask when the period starts the year.
  const beforeWindow = React.useMemo(() => ({ from: ytdWindow.from, to: addDays(window.from, -1) }), [ytdWindow.from, window.from]);
  const hasBefore = window.from > ytdWindow.from && beforeWindow.to >= beforeWindow.from;
  const ytdIsPeriod = window.from === ytdWindow.from && window.to === ytdWindow.to;
  const [showLinks, setShowLinks] = React.useState(false);

  const access = useModuleAccess();
  const { roles } = useRole();
  const see = { reports: access.canView("reports"), transport: access.canView("transport"), donors: access.canView("donors"), hours: holdsPower(roles, "runs_hr") || holdsPower(roles, "finance_work"), caf: holdsPower(roles, "caf_billing_view") };
  // Expenses: for a dashboard profile with the Expenses card (the database gives the figures to no one else, 0147).
  const { data: cardRows } = useCollection(dashboardProfilesStore);
  const seesExpenses = roles.includes("admin") || cardRows.some((r) => r.card === "expenses" && roles.includes(r.role as Role));
  const designs = roles.some((r) => r === "admin" || r === "ceo" || r === "finance");
  const [picked, setPicked] = React.useState<Set<GeneratorSectionKey>>(() => new Set(GENERATOR_SECTIONS.map((s) => s.key)));
  const [order, setOrder] = React.useState<GeneratorSectionKey[]>(() => GENERATOR_SECTIONS.map((s) => s.key));
  // A profile picked (or opened from a link) sets the sections and their order once.
  const appliedFor = React.useRef<string | null>(null);
  const design = profile ? JSON.stringify([profile.id, profile.sections, profile.includeAi]) : null;
  React.useEffect(() => {
    if (!profile) {
      if (appliedFor.current !== null) {
        appliedFor.current = null;
        setPicked(new Set(GENERATOR_SECTIONS.map((x) => x.key)));
        setOrder(GENERATOR_SECTIONS.map((x) => x.key));
      }
      return;
    }
    if (appliedFor.current === design) return;
    appliedFor.current = design;
    const known = new Set<string>(GENERATOR_SECTIONS.map((x) => x.key));
    const mine = profile.sections.filter((k) => known.has(k)) as GeneratorSectionKey[];
    setPicked(new Set(mine));
    setOrder([...mine, ...GENERATOR_SECTIONS.map((x) => x.key).filter((k) => !mine.includes(k))]);
    ai.setInclude(profile.includeAi);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once a design, not on every render of the analysis state
  }, [design]);
  // A profile just saved may not be in the list yet: its period and columns come with it.
  const pickProfile = (id: string, saved?: Pick<ReportProfile, "period" | "columnsMode">) => {
    const p = id ? (saved ?? profiles.find((x) => x.id === id) ?? null) : null;
    const q = new URLSearchParams(params.toString());
    for (const k of ["period", "from", "to", "cols", "profile"]) q.delete(k);
    if (p) {
      q.set("profile", id);
      q.set("period", p.period);
      q.set("cols", p.columnsMode);
    }
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  };
  const [editing, setEditing] = React.useState<ReportProfile | "new" | null>(null);
  const { data: fundCodes } = useSetupRows("fin_codes");
  const allowed = (k: GeneratorSectionKey) => (k === "donations" || k === "inventory" ? see.donors : k === "staff" ? see.hours : k === "expenses" ? seesExpenses : see.reports);
  const sections = order.filter((k) => picked.has(k) && allowed(k));
  const wants = (k: GeneratorSectionKey) => sections.includes(k);
  const fund = profile?.fundCode ?? null;

  const programs = useProgramImpact(window, grain);
  const programsBefore = useProgramImpact(previous, periodGrain(previous));
  const programsYtd = useProgramImpact(hasBefore ? beforeWindow : ytdWindow, "month", 0, hasBefore);
  const extras = useExtras(window, see);
  const extrasBefore = useExtras(previous, see);
  const extrasYtdRead = useExtras(ytdWindow, see, !ytdIsPeriod);
  const extrasYtd = ytdIsPeriod ? extras : extrasYtdRead;
  // The year's goals (Executive › Goals): read by the CEO, the Trustees and the Super Admin; nobody else gets rows.
  const { goals, targets } = useGoals();
  const goalOf = (measure: string) => {
    const g = goals.find((x) => x.status === "active" && x.measure === measure && targets.some((t) => t.goalId === x.id && t.year === year));
    return g ? { title: g.title, target: targets.find((t) => t.goalId === g.id && t.year === year)!.target } : null;
  };
  const programGoals = Object.fromEntries(
    (Object.keys(GOAL_GROUP) as Measure[]).flatMap((m) => ((g) => (g ? [[GOAL_GROUP[m], { label: g.title, lines: MEASURES[m].lines as string[], target: g.target }]] : []))(goalOf(m))),
  );
  const needExtra = wants("occupancy") || wants("expenses");
  const extraNow = useReportExtra(window, fund, needExtra);
  const extraPrev = useReportExtra(previous, fund, needExtra);
  const extraYtdRead = useReportExtra(ytdWindow, fund, needExtra && !ytdIsPeriod);
  const extraYtd = ytdIsPeriod ? extraNow : extraYtdRead;
  const needHeadline = wants("headline");
  const headNow = useDashboardFigures(window, needHeadline);
  const headPrev = useDashboardFigures(previous, needHeadline);
  const headYtdRead = useDashboardFigures(ytdWindow, needHeadline && !ytdIsPeriod);
  const headYtd = ytdIsPeriod ? headNow : headYtdRead;
  // How many of the period's nights the House Sheet filled (nobody finalized them in the app, 0148).
  const [filledNights, setFilledNights] = React.useState<{ key: string; n: number } | null>(null);
  const nightsKey = `${window.from}|${window.to}`;
  React.useEffect(() => {
    let live = true;
    void createClient().schema("ops").rpc("unfinalized_nights", { p_from: window.from, p_to: window.to })
      .then(({ data }) => live && setFilledNights({ key: nightsKey, n: ((data ?? []) as { filled: boolean }[]).filter((r) => r.filled).length }));
    return () => {
      live = false;
    };
  }, [window.from, window.to, nightsKey]);
  const filled = filledNights?.key === nightsKey ? filledNights.n : 0;
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
  const fig = (label: string, cur: number, prev: number, ytd: number, unit?: Figure["unit"], goal?: number): Figure => ({ label, value: cur, previous: prev, ytd, unit, goal });

  const cash = (w: DayWindow) => donations.filter((d) => d.kind === "cash" && d.currency === "PHP" && d.date >= w.from && d.date <= w.to);
  const built: GeneratorExtras = {};
  if (extras && extrasBefore && extrasYtd) {
    const km = (x: Extra) => x.trips.reduce((s, t) => s + t.km, 0);
    const fuel = (x: Extra) => x.trips.reduce((s, t) => s + t.fuel, 0);
    const tripCount = (x: Extra) => x.trips.filter((t) => (t as { trip?: number }).trip === 1).length;
    built.transport = {
      figures: [fig("Trips", tripCount(extras), tripCount(extrasBefore), tripCount(extrasYtd)), fig("Kilometres", km(extras), km(extrasBefore), km(extrasYtd), "km"), fig("Fuel spent", fuel(extras), fuel(extrasBefore), fuel(extrasYtd), "PHP")],
      rows: inBuckets(extras.trips, (t) => t.date, (a, t) => {
        a.trips = (a.trips ?? 0) + ((t as { trip?: number }).trip ?? 0);
        a.km = (a.km ?? 0) + t.km;
        a.fuel = (a.fuel ?? 0) + t.fuel;
      }) as { label: string; trips: number; km: number; fuel: number }[],
    };
    const hoursOf = (x: Extra) => Math.round((x.hours.reduce((s, h) => s + h.minutes, 0) / 60) * 10) / 10;
    const lateOf = (x: Extra) => x.hours.filter((h) => h.late).length;
    built.staff = {
      figures: [fig("Hours worked", hoursOf(extras), hoursOf(extrasBefore), hoursOf(extrasYtd), "h"), fig("Late arrivals", lateOf(extras), lateOf(extrasBefore), lateOf(extrasYtd))],
      rows: inBuckets(extras.hours, (h) => h.date, (a, h) => {
        a.hours = Math.round(((a.hours ?? 0) + h.minutes / 60) * 10) / 10;
        a.late = (a.late ?? 0) + (h.late ? 1 : 0);
      }) as { label: string; hours: number; late: number }[],
    };
    const food = (x: Extra) => x.gifts.reduce((s, g) => s + g.food, 0);
    const nonFood = (x: Extra) => x.gifts.reduce((s, g) => s + g.nonFood, 0);
    const cashOf = (w: DayWindow) => cash(w).reduce((s, d) => s + d.totalValue, 0);
    const raised = (w: DayWindow) => donations.filter((d) => d.date >= w.from && d.date <= w.to).reduce((s, d) => s + Number(d.totalValue ?? 0), 0);
    built.donations = {
      figures: [
        fig("Cash gifts", cashOf(window), cashOf(previous), cashOf(ytdWindow), "PHP"),
        fig("Gifts in kind", food(extras) + nonFood(extras), food(extrasBefore) + nonFood(extrasBefore), food(extrasYtd) + nonFood(extrasYtd), "PHP"),
        // The gifts in kind by what they are (the category each line was received under in LAF Inventory).
        { ...fig("Gifts in kind: food", food(extras), food(extrasBefore), food(extrasYtd), "PHP"), part: true },
        { ...fig("Gifts in kind: non-food", nonFood(extras), nonFood(extrasBefore), nonFood(extrasYtd), "PHP"), part: true },
        fig("Cash gifts (count)", cash(window).length, cash(previous).length, cash(ytdWindow).length),
        // One a receipt for goods (ops.gik_batches gives a row per receipt in LAF Inventory).
        fig("Gifts in kind (count)", extras.gifts.length, extrasBefore.gifts.length, extrasYtd.gifts.length),
        // The money-raised goal, counted as Executive › Goals counts it: every gift on the donor ledger.
        ...((g) => (g ? [{ ...fig(`Goal: ${g.title}`, raised(window), raised(previous), raised(ytdWindow), "PHP", g.target), derived: true }] : []))(goalOf("donations")),
      ],
      rows: inBuckets([...extras.gifts.map((g) => ({ date: g.date, cash: 0, food: g.food, nonFood: g.nonFood })), ...cash(window).map((d) => ({ date: d.date, cash: d.totalValue, food: 0, nonFood: 0 }))], (r) => r.date, (a, r) => {
        a.cash = (a.cash ?? 0) + r.cash;
        a.food = (a.food ?? 0) + r.food;
        a.nonFood = (a.nonFood ?? 0) + r.nonFood;
      }) as { label: string; cash: number; food: number; nonFood: number }[],
    };
    built.inventory = {
      figures: [fig("Food received", food(extras), food(extrasBefore), food(extrasYtd), "PHP"), fig("Non-food received", nonFood(extras), nonFood(extrasBefore), nonFood(extrasYtd), "PHP")],
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
    const ytd = months(ytdWindow);
    const sum = (rows: typeof cur, k: "billed" | "paid" | "absorbed") => rows.reduce((s, r) => s + r[k], 0);
    built.caf = { figures: [fig("Billed", sum(cur, "billed"), sum(prev, "billed"), sum(ytd, "billed"), "PHP"), fig("Paid", sum(cur, "paid"), sum(prev, "paid"), sum(ytd, "paid"), "PHP"), fig("Nights absorbed", sum(cur, "absorbed"), sum(prev, "absorbed"), sum(ytd, "absorbed"))], rows: cur };
  }

  // Headline: the dashboard's own figures for the three windows (money only where the dashboard shows it).
  const sumLines = (x: DashboardFigures | null, ...lines: string[]) => lines.reduce((t, l) => t + Number(x?.lines[l] ?? 0), 0);
  if (needHeadline && headNow.figures && headPrev.figures && headYtd.figures) {
    const [a, b, c] = [headNow.figures, headPrev.figures, headYtd.figures];
    const line = (name: string, unit: Figure["unit"], ...lines: string[]) => fig(name, sumLines(a, ...lines), sumLines(b, ...lines), sumLines(c, ...lines), unit);
    built.headline = {
      figures: [
        line("Bed nights provided", "", "housing"),
        line("Patient and caregiver rides", "", "transport_to_nch", "transport_to_laf"),
        line("Meals served", "", "meals_breakfast", "meals_lunch", "meals_dinner"),
        line("Child visits (Activity Center @ NCH)", "", "center_nch_participants"),
        line("Care Cart meals (served at NCH)", "", "care_cart_1000", "care_cart_1200", "care_cart_1700"),
        fig("Unique patients admitted", a.unique_patients, b.unique_patients, c.unique_patients),
        ...(a.cash && b.cash && c.cash ? [fig("Cash donations", a.cash.amount, b.cash.amount, c.cash.amount, "PHP")] : []),
        ...(a.expenses && b.expenses && c.expenses ? [fig("Expenses (paid vouchers)", a.expenses.amount, b.expenses.amount, c.expenses.amount, "PHP")] : []),
      ],
    };
  }
  // Occupancy and beds: the house's beds and the families a night.
  const occ = (x: ReportExtra | null) => x?.occupancy;
  if (needExtra && occ(extraNow.data) && occ(extraPrev.data) && occ(extraYtd.data)) {
    const [a, b, c] = [occ(extraNow.data)!, occ(extraPrev.data)!, occ(extraYtd.data)!];
    const avg = (o: typeof a) => (o.days ? Math.round((o.family_nights / o.days) * 10) / 10 : 0);
    const pct = (o: typeof a) => (o.beds && o.days ? Math.round((o.family_nights / o.days / o.beds) * 1000) / 10 : 0);
    built.occupancy = {
      figures: [
        fig("Families a night (average)", avg(a), avg(b), avg(c)),
        fig("Beds in use (average, %)", pct(a), pct(b), pct(c)),
        fig("Family-nights", a.family_nights, b.family_nights, c.family_nights),
        fig("Nights with nobody in", a.empty_nights, b.empty_nights, c.empty_nights),
      ],
      note: `${a.beds} beds (${a.regular_beds} regular, ${a.beds - a.regular_beds} temporary mattresses) on the floor plan; families housed each night from the nights finalized in the app, else the House Sheet. ${a.busiest ? `Busiest night: ${a.busiest.night} with ${a.busiest.families} families.` : ""}`.trim(),
    };
  }
  // Expenses: paid vouchers against the approved budget, by account and by fund; spending per person-night.
  const exp = (x: ReportExtra | null) => x?.expenses;
  if (needExtra && exp(extraNow.data) && exp(extraPrev.data) && exp(extraYtd.data)) {
    const [a, b, c] = [exp(extraNow.data)!, exp(extraPrev.data)!, exp(extraYtd.data)!];
    const nights = (rows: typeof programs.rows) => rows.filter((r) => r.line === "housing").reduce((t, r) => t + Math.max(r.native, r.fromSheet), 0);
    const perNight = (paid: number, n: number) => (n ? Math.round((paid / n) * 100) / 100 : 0);
    const ytdNights = nights(programsYtd.rows) + nights(programs.rows);
    built.expenses = {
      figures: [
        fig("Paid", a.total, b.total, c.total, "PHP"),
        ...(a.budget != null ? [fig("Approved budget for these days", a.budget, b.budget ?? 0, c.budget ?? 0, "PHP")] : []),
        fig("Vouchers paid", a.vouchers, b.vouchers, c.vouchers),
        ...(fund ? [] : [fig("Spending per person-night (all spending ÷ bed nights)", perNight(a.total, nights(programs.rows)), perNight(b.total, nights(programsBefore.rows)), perNight(c.total, ytdNights), "PHP")]),
      ],
      byAccount: a.by_account.map((x) => ({ label: `${x.code} ${x.name}`, amount: Number(x.amount) })),
      byFund: a.by_fund.map((x) => ({ label: `${x.name} (${x.code})`, amount: Number(x.amount) })),
      note: fund
        ? `Paid from the ${fund} fund only, by the day paid. Budgets aren't set by fund, so there is no budget line.`
        : "Paid vouchers by the day paid (fund top-ups and cash advances left out; a liquidation counts the spending), against the approved budget's share of these days.",
    };
  }

  const loadingMore = (needExtra && (extraNow.loading || extraPrev.loading || extraYtd.loading)) || (needHeadline && (headNow.loading || headPrev.loading || headYtd.loading));
  const ready = !programs.loading && !programsBefore.loading && !programsYtd.loading && !!extras && !!extrasBefore && !!extrasYtd && !loadingMore;
  /** `plain`: every table whatever the profile draws (the CSV). */
  const report = (plain = false) =>
    operationsReport({
      sections, rows: programs.rows, previous: programsBefore.rows, buckets, extras: built, period: label, previousPeriod: prevLabel, totalsOnly, ytdRows: programsYtd.rows, ytdLabel, goalYear: year, goals: programGoals,
      styles: plain ? undefined : (profile?.charts as Partial<Record<GeneratorSectionKey, "chart" | "rank" | "table" | "figures">> | undefined),
      comparisons: profile?.comparisons,
      notes: filled ? { Housing: `${filled} night${filled === 1 ? "" : "s"} of this period came from the House Sheet: nobody finalized them in the app.` } : undefined,
      title: profile?.name,
    });
  // Every table of the report as one CSV, section by section.
  const exportCsv = () => {
    const spec = report(true).spec;
    const lines: (string | number)[][] = [[spec.title, spec.period, spec.previousPeriod ?? ""]];
    for (const sec of spec.sections) {
      if (!sec.table) continue;
      lines.push([], [sec.heading], sec.table.columns, ...sec.table.rows, ...(sec.table.totals ? [sec.table.totals] : []));
    }
    downloadCsv(csvLines(lines[0].map(String), lines.slice(1).map((r) => r.map(String))), `LAF-${(profile?.name ?? "Report").replace(/[^A-Za-z0-9]+/g, "-")}-${window.from}-${window.to}.csv`);
  };
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
      <PageHeader
        title="Reports"
        description="One report for the period you pick: every program, donations, transport, staff hours, NCH billing and the gifts in kind received, each beside the period before, with its variance, the year to date and the year's goal. Tick what to include, read it here, then download the branded PDF."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => setShowLinks((v) => !v)} aria-expanded={showLinks}><List className="size-4" /> {showLinks ? "Hide report links" : "Show report links"}</Button>
            <ModuleSubNav items={[{ href: "/reports/documents", label: "Documents", icon: FolderOpen }]} />
          </div>
        }
      />
      {showLinks ? <ReportLinks /> : null}
      <PeriodPresetsBar state={period.state} onChange={period.setState} today={period.today} years />
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-4">
        <span className="text-theme-sm font-medium">Report profile</span>
        <Select value={profile?.id ?? "none"} onValueChange={(v) => pickProfile(v === "none" ? "" : v)}>
          <SelectTrigger className="w-64" aria-label="Report profile"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Everything (no profile)</SelectItem>
            {profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {designs && profile ? <Button variant="outline" size="sm" onClick={() => setEditing(profile)}><Pencil className="size-4" /> Edit</Button> : null}
        {designs ? <Button variant="outline" size="sm" onClick={() => setEditing("new")}><Plus className="size-4" /> New profile</Button> : null}
        {profile?.description ? <p className="w-full text-theme-xs text-muted-foreground">{profile.description}</p> : null}
      </div>
      {editing ? (
        <ProfileEditor
          profile={editing === "new" ? null : editing}
          funds={fundCodes.filter((c) => c.tier === "T2" && c.active !== false).map((c) => ({ code: String(c.code), name: String(c.name) }))}
          onClose={() => setEditing(null)}
          onSaved={(id, saved) => {
            setEditing(null);
            // Applied again once the list has the saved design (the effect follows the design, not the id).
            pickProfile(id, saved);
          }}
        />
      ) : null}
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1" role="group" aria-label="Columns">
            {[{ v: "total", label: "Totals only" }, { v: "columns", label: GRAIN_WORD[grain] }].map((o) => (
              <Button key={o.v} size="sm" variant={(o.v === "total") === totalsOnly ? "default" : "outline"} aria-pressed={(o.v === "total") === totalsOnly} onClick={() => setCols(o.v)}>{o.label}</Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" disabled={!ready} onClick={exportCsv}><Download className="size-4" /> CSV</Button>
            <ReportToolbar ai={ai} buildSpec={() => report().spec} buildInput={() => report().input} filename={`LAF-${(profile?.name ?? "Operations-Report").replace(/[^A-Za-z0-9]+/g, "-")}-${window.from}-${window.to}.pdf`} />
          </div>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {order.map((k) => GENERATOR_SECTIONS.find((x) => x.key === k)!).filter((s) => allowed(s.key)).map((s) => (
            <span key={s.key} className="flex items-center gap-2">
              <Checkbox id={`gen-${s.key}`} checked={picked.has(s.key)} onCheckedChange={() => toggle(s.key)} />
              <Label htmlFor={`gen-${s.key}`} className="text-theme-sm font-normal">
                {s.label}
              </Label>
            </span>
          ))}
        </div>
        <p className="text-theme-xs text-muted-foreground">
          {label} ({window.from} to {window.to}) compared with {prevLabel}; year to date is {ytdWindow.from} to {ytdWindow.to}.{Object.keys(programGoals).length ? ` Goals are the ${year} targets from Executive › Goals, set against the year to date.` : ""}
        </p>
      </div>
      {programs.error || programsBefore.error || programsYtd.error ? <EmptyState title="Couldn't load the programs" description={`${programs.error ?? programsBefore.error ?? programsYtd.error} Figures that failed to load read as zero: reload before using this report.`} /> : null}
      {[extraNow, extraPrev, extraYtd, headNow, headPrev, headYtd].some((x) => x.error) ? <EmptyState title="Some figures couldn't load" description={`${[extraNow, extraPrev, extraYtd, headNow, headPrev, headYtd].find((x) => x.error)?.error} The headline, occupancy or expenses section is left out: reload before using this report.`} /> : null}
      {extras?.failed || extrasBefore?.failed || extrasYtd?.failed ? <EmptyState title="Some figures couldn't load" description="Transport, staff hours or gifts in kind failed to load and read as zero: reload before using this report." /> : null}
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
