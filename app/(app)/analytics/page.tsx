"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Bed, Printer, RotateCcw, Timer, UserPlus, Users } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PeriodPicker, periodStateWindow, type PeriodState } from "@/components/ui/period-picker";
import { ChartCard } from "@/components/modules/analytics/chart-card";
import { AiAnalysisPanel, ReportToolbar, useReportAnalysis } from "@/components/modules/reports/report-ai";
import { useRole } from "@/context/role-provider";
import { createClient } from "@/lib/supabase/client";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";
import { useDiagnosesReferenceData } from "@/lib/hooks/use-diagnoses-reference-collection";
import { useReferenceTableData } from "@/lib/hooks/use-reference-table-collection";
import { useDonorsData } from "@/lib/hooks/use-donors-collection";
import { useCafBills } from "@/lib/hooks/use-caf-billing";
import { holdsPower } from "@/lib/rbac/roles";
import { analyticsReport, type AnalyticsKpi, type ChartDef } from "@/lib/utils/analytics-report";
import { cafAmounts, cafMonthLabel } from "@/lib/utils/caf";
import { formatCurrency } from "@/lib/utils/currency";
import { todayIso } from "@/lib/utils/date";
import { ILLNESS_CODES, PRIORITIES } from "@/lib/utils/master-sheet";
import { periodLabel, previousWindow, type DayWindow, type RangeKind } from "@/lib/utils/period";
import { ageGroupOn, autoGrain, breakdown, matchesPatient, series, type Grain, type PatientFilter } from "@/lib/utils/report-series";

const ALL = "all";
const STATUSES = ["ongoing", "check_up", "completed", "expired", "lost_to_follow_up", "non_pedia"];
const AGE_GROUPS = ["0–1", "2–5", "6–9", "10–12", "13–15", "16–18"];
const FILTER_KEYS = ["priority", "illnessCode", "diagnosisCategory", "diagnosisId", "status", "sex", "ageGroup", "provinceId", "hospitalId"] as const;
const FILTER_LABELS: Record<(typeof FILTER_KEYS)[number], string> = { priority: "Priority", illnessCode: "Patient type", diagnosisCategory: "Diagnosis group", diagnosisId: "Diagnosis", status: "Status", sex: "Sex", ageGroup: "Age group", provinceId: "Province", hospitalId: "Hospital" };
const titleCase = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

interface Loaded {
  key: string;
  nights: { night: string; patientId: string; visitId: string; visitStart: string }[];
  trips: { date: string; direction: string; passengers: boolean; urgent: boolean; km: number; riders: number }[];
  expenses: { date: string; amount: number; litres: number }[];
  meals: { date: string; meal: string; patientId: string }[];
  gifts: { date: string; food: number; nonFood: number }[];
  hours: { date: string; minutes: number; late: boolean }[];
}
type GChart = ChartDef & { group: "patients" | "transport" | "donors" | "caf" | "hours" };
interface See {
  patients: boolean;
  transport: boolean;
  donors: boolean;
  hours: boolean;
  caf: boolean;
}

/** The range's records, read once per range with the viewer's own access; a section they can't open stays empty. */
function useRangeRecords(from: string, to: string, see: See): { data: Loaded | null; error: string | null } {
  const [loaded, setLoaded] = React.useState<Loaded | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    let live = true;
    const ops = () => createClient().schema("ops");
    const none = Promise.resolve([] as never[]);
    void Promise.all([
      see.patients
        ? fetchAll<{ night: string; patient_id: string; visit_key: string; visit_start: string }>((f, t) =>
            // Who stayed each night (0100): the House Sheet while it is the record, else the app.
            ops().from("nightly_record").select("night, patient_id, visit_key, visit_start").gte("night", from).lte("night", to).order("night").order("patient_id").range(f, t)
          )
        : none,
      see.transport
        ? fetchAll<{ date: string; direction: string; carries_passengers: boolean; urgent: boolean; odometer_start: number | null; odometer_end: number | null; trip_manifest: { id: string }[] | null }>((f, t) =>
            ops().from("trips").select("date, direction, carries_passengers, urgent, odometer_start, odometer_end, trip_manifest(id)").gte("date", from).lte("date", to).order("date").range(f, t)
          )
        : none,
      see.transport
        ? fetchAll<{ expense_date: string; amount: number; litres: number | null; voided_at: string | null }>((f, t) =>
            ops().from("vehicle_expenses").select("expense_date, amount, litres, voided_at").gte("expense_date", from).lte("expense_date", to).order("expense_date").range(f, t)
          )
        : none,
      see.patients
        ? fetchAll<{ date: string; meal: string; patient_id: string }>((f, t) => ops().from("meal_record").select("date, meal, patient_id").gte("date", from).lte("date", to).order("date").range(f, t))
        : none,
      see.donors ? ops().rpc("gik_batches", { p_from: from, p_to: to }).then((r) => (r.data ?? []) as { date: string; food_value: number; nonfood_value: number }[]) : none,
      see.hours
        ? fetchAll<{ date: string; total_minutes: number | null; flag: string | null }>((f, t) => ops().from("time_entries").select("date, total_minutes, flag").gte("date", from).lte("date", to).order("date").range(f, t))
        : none,
    ])
      .then(([nights, trips, expenses, meals, gifts, hours]) => {
        if (!live) return;
        setError(null);
        setLoaded({
          key: `${from}|${to}`,
          nights: nights.map((n) => ({ night: n.night, patientId: n.patient_id, visitId: n.visit_key, visitStart: n.visit_start })),
          trips: trips.map((t) => ({
            date: t.date,
            direction: t.direction,
            passengers: t.carries_passengers,
            urgent: t.urgent,
            km: t.odometer_start != null && t.odometer_end != null ? Number(t.odometer_end) - Number(t.odometer_start) : 0,
            riders: t.trip_manifest?.length ?? 0,
          })),
          expenses: expenses.filter((e) => !e.voided_at).map((e) => ({ date: e.expense_date, amount: Number(e.amount), litres: Number(e.litres ?? 0) })),
          meals: meals.map((m) => ({ date: m.date, meal: m.meal, patientId: m.patient_id })),
          gifts: gifts.map((g) => ({ date: g.date, food: Number(g.food_value), nonFood: Number(g.nonfood_value) })),
          hours: hours.map((h) => ({ date: h.date, minutes: Number(h.total_minutes ?? 0), late: h.flag === "late" })),
        });
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [from, to, see.patients, see.transport, see.donors, see.hours]);
  return { data: loaded?.key === `${from}|${to}` ? loaded : null, error };
}

/**
 * Analytics (2026-10-15, any range with the AI comparison since Nov 2026): everything the house
 * records, for a day, week, month, quarter, year or custom range, by day, week or month, with the
 * patient filters (priority, patient type, diagnosis, status, sex, age group, province, hospital)
 * applied to every patient chart. Live from the records, read with the viewer's own access: a
 * section the viewer can't open is left out. Filters stay in the address, so a view can be
 * bookmarked or shared. Exports as the branded PDF (description, figures and chart per section,
 * the AI's comparison with the previous range when kept) and still prints.
 */
export default function AnalyticsPage() {
  return (
    <React.Suspense fallback={<p className="text-theme-sm text-muted-foreground">Loading…</p>}>
      <Analytics />
    </React.Suspense>
  );
}

function Analytics() {
  const router = useRouter();
  const params = useSearchParams();
  const today = todayIso();
  const period: PeriodState = React.useMemo(() => {
    const kind = (params.get("range") ?? "month") as RangeKind;
    return { kind: ["today", "week", "month", "quarter", "year", "custom"].includes(kind) ? kind : "month", anchor: params.get("at") ?? today, from: params.get("from") ?? undefined, to: params.get("to") ?? undefined };
  }, [params, today]);
  const win = periodStateWindow(period);
  const { from, to } = win;
  const prevWin = previousWindow(period.kind, win);
  const grainParam = params.get("by") as Grain | "auto" | null;
  const grain: Grain = grainParam && grainParam !== "auto" ? grainParam : autoGrain(from, to);
  const filter: PatientFilter = Object.fromEntries(FILTER_KEYS.flatMap((k) => (params.get(k) ? [[k, params.get(k)!]] : []))) as PatientFilter;
  const filtered = FILTER_KEYS.some((k) => params.get(k));

  const setParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "" || v === ALL) next.delete(k);
      else next.set(k, v);
    }
    router.replace(`?${next.toString()}`, { scroll: false });
  };
  const setPeriod = (next: PeriodState) => setParams({ range: next.kind, at: next.kind !== "custom" && next.anchor !== today ? next.anchor : null, from: next.kind === "custom" ? (next.from ?? null) : null, to: next.kind === "custom" ? (next.to ?? null) : null });

  const access = useModuleAccess();
  const { roles } = useRole();
  const see: See = {
    patients: access.canView("patients"),
    transport: access.canView("transport"),
    donors: access.canView("donors"),
    hours: holdsPower(roles, "runs_hr") || holdsPower(roles, "finance_work"),
    caf: holdsPower(roles, "caf_billing_view"),
  };

  const { patients, appointments } = usePatientsData();
  const { rows: diagnoses } = useDiagnosesReferenceData();
  const { rows: provinces } = useReferenceTableData("provinces", "prov", "region");
  const { rows: hospitals } = useReferenceTableData("hospitals", "hosp");
  const { donations } = useDonorsData();
  const { bills } = useCafBills();
  const { data, error } = useRangeRecords(from, to, see);
  const previous = useRangeRecords(prevWin.from, prevWin.to, see);
  const ai = useReportAnalysis();
  const filterKey = params.toString();
  const clearAnalysis = ai.clear;
  React.useEffect(() => clearAnalysis(), [from, to, filterKey, clearAnalysis]);

  // ---- patients that pass the filters ----
  const categoryOf = React.useMemo(() => new Map(diagnoses.map((d) => [d.id, d.category])), [diagnoses]);
  const okPatient = React.useMemo(() => {
    const ok = new Set(patients.filter((p) => matchesPatient(p, filter, { categoryOf: (id) => categoryOf.get(id), today })).map((p) => p.id));
    return (id: string) => ok.has(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the filter is read from the address each render; its string is the key.
  }, [patients, categoryOf, today, filterKey]);

  const provinceName = new Map(provinces.map((p) => [p.id, p.name]));
  const hospitalName = new Map(hospitals.map((h) => [h.id, h.name]));
  const diagnosisName = new Map(diagnoses.map((d) => [d.id, d.name]));

  /** The charts and KPIs for one window's records: drawn for this range, totalled for the previous one. */
  const build = (d: Loaded, w: DayWindow, g: Grain) => {
    const span = { from: w.from, to: w.to, grain: g };
    const nights = d.nights.filter((n) => okPatient(n.patientId));
    const visitStarts = [...new Map(nights.filter((n) => n.visitStart >= w.from && n.visitStart <= w.to).map((n) => [n.visitId, { checkInAt: n.visitStart }])).values()];
    const served = [...new Set(nights.map((n) => n.patientId))].flatMap((id) => patients.filter((p) => p.id === id));
    const visitsWithNights = new Set(nights.map((n) => n.visitId)).size;
    const checkUps = appointments.filter((a) => a.date >= w.from && a.date <= w.to && okPatient(a.patientId));
    const meals = d.meals.filter((m) => okPatient(m.patientId));
    const cashGifts = see.donors ? donations.filter((x) => x.kind === "cash" && x.currency === "PHP" && x.date >= w.from && x.date <= w.to) : [];
    const giftsRows = [...d.gifts.map((x) => ({ date: x.date, food: x.food, nonFood: x.nonFood, cash: 0 })), ...cashGifts.map((x) => ({ date: x.date, food: 0, nonFood: 0, cash: x.totalValue }))];
    const cafMonths = bills
      .filter((b) => b.month >= `${w.from.slice(0, 7)}-01` && b.month <= w.to)
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((b) => {
        const terms = { rate: b.rate, cap: b.cap, discountPct: b.discountPct };
        const amounts = b.lines.map((l) => cafAmounts(l, terms));
        const due = Math.round(amounts.reduce((s, a) => s + a.net, 0));
        return { label: cafMonthLabel(b.month), billed: due, paid: b.status === "paid" ? due : 0, absorbed: amounts.reduce((s, a) => s + (a.stays - a.billable), 0) };
      });
    const csv = (n: string) => `${n}-${w.from}-to-${w.to}`;
    const kpis: AnalyticsKpi[] = see.patients
      ? [
          { label: "Bed nights", value: nights.length.toLocaleString(), current: nights.length, previous: 0 },
          { label: "Families served", value: served.length.toLocaleString(), current: served.length, previous: 0 },
          { label: "New visits", value: visitStarts.length.toLocaleString(), current: visitStarts.length, previous: 0 },
          { label: "Nights per visit", value: visitsWithNights ? (nights.length / visitsWithNights).toFixed(1) : "—", current: visitsWithNights ? Math.round((nights.length / visitsWithNights) * 10) / 10 : 0, previous: 0 },
        ]
      : [];
    const families = [{ key: "count", label: "Families" }];
    const charts: GChart[] = [
      ...(see.patients
        ? ([
            { group: "patients", title: "Bed nights and new visits", description: "Nights slept at LAF House and the visits that started, from the nightly record (the House Sheet while it is the record, the app after).", kind: "line", xKey: "label", data: series([...nights.map((n) => ({ day: n.night, n: 1, v: 0 })), ...visitStarts.map((s) => ({ day: s.checkInAt, n: 0, v: 1 }))], (r) => r.day, span, { nights: (r) => r.n, visits: (r) => r.v }), series: [{ key: "nights", label: "Bed nights" }, { key: "visits", label: "New visits" }], csvName: csv("bed-nights") },
            { group: "patients", title: "Check-ups and rides", description: "Hospital appointments in the range and how many needed a ride, from Patients > Appointments.", kind: "bar", xKey: "label", data: series(checkUps, (a) => a.date, span, { checkUps: () => 1, rides: (a) => (a.needsTransport ? 1 : 0) }), series: [{ key: "checkUps", label: "Check-ups" }, { key: "rides", label: "Needing a ride" }], csvName: csv("check-ups") },
            { group: "patients", title: "Families served by priority", description: "Families who stayed in the range, by their admission priority.", kind: "rank", xKey: "name", data: breakdown(served, (p) => (p.priority ? `${p.priority} · ${PRIORITIES[p.priority]}` : null)), series: families, csvName: csv("by-priority") },
            { group: "patients", title: "By patient type", description: "Families who stayed, by the child's patient type.", kind: "rank", xKey: "name", data: breakdown(served, (p) => (p.illnessCode ? ILLNESS_CODES[p.illnessCode] : null)), series: families, csvName: csv("by-patient-type") },
            { group: "patients", title: "By diagnosis", description: "Families who stayed, by the child's first diagnosis on record.", kind: "rank", xKey: "name", data: breakdown(served, (p) => diagnosisName.get(p.diagnosisIds[0] ?? "")), series: families, csvName: csv("by-diagnosis") },
            { group: "patients", title: "By age group", description: "Families who stayed, by the child's age today.", kind: "rank", xKey: "name", data: AGE_GROUPS.map((ag) => ({ name: ag, count: served.filter((p) => ageGroupOn(p.birthDate, today) === ag).length })), series: families, csvName: csv("by-age") },
            { group: "patients", title: "By province", description: "Families who stayed, by home province.", kind: "rank", xKey: "name", data: breakdown(served, (p) => provinceName.get(p.provinceId)), series: families, csvName: csv("by-province") },
            { group: "patients", title: "By sex and referring hospital", description: "Families who stayed, by the child's sex and the hospital that referred them.", kind: "rank", xKey: "name", data: [...breakdown(served, (p) => (p.sex === "F" ? "Female" : p.sex === "M" ? "Male" : null), 2), ...breakdown(served, (p) => hospitalName.get(p.referringHospitalId ?? ""), 4)], series: families, csvName: csv("by-sex-hospital") },
            { group: "patients", title: "Meals served", description: "Meals ticked for the families staying, by breakfast, lunch and dinner.", note: "Ticked on House Today since 15 Oct 2026.", kind: "bar", stacked: true, xKey: "label", data: series(meals, (m) => m.date, span, { breakfast: (m) => (m.meal === "breakfast" ? 1 : 0), lunch: (m) => (m.meal === "lunch" ? 1 : 0), dinner: (m) => (m.meal === "dinner" ? 1 : 0) }), series: [{ key: "breakfast", label: "Breakfast" }, { key: "lunch", label: "Lunch" }, { key: "dinner", label: "Dinner" }], csvName: csv("meals") },
          ] as GChart[])
        : []),
      ...(see.transport
        ? ([
            { group: "transport", title: "Trips", description: "Trips driven: pick-ups from the hospital, deliveries to it, urgent runs and errands without passengers, from Transport > Trips.", note: filtered ? "Trips aren't filtered by patient." : undefined, kind: "bar", stacked: true, xKey: "label", data: series(d.trips, (t) => t.date, span, { pickups: (t) => (t.passengers && t.direction === "from_hospital" ? 1 : 0), deliveries: (t) => (t.passengers && t.direction === "to_hospital" && !t.urgent ? 1 : 0), urgent: (t) => (t.urgent ? 1 : 0), errands: (t) => (!t.passengers ? 1 : 0) }), series: [{ key: "pickups", label: "Pick-ups" }, { key: "deliveries", label: "Deliveries" }, { key: "urgent", label: "Urgent" }, { key: "errands", label: "Errands" }], csvName: csv("trips") },
            { group: "transport", title: "Kilometres and fuel", description: "Kilometres from the trips' odometer readings and pesos spent on fuel from the vehicle expenses.", kind: "bar", xKey: "label", data: series([...d.trips.map((t) => ({ day: t.date, km: t.km, fuel: 0 })), ...d.expenses.map((e) => ({ day: e.date, km: 0, fuel: e.litres > 0 ? e.amount : 0 }))], (r) => r.day, span, { km: (r) => r.km, fuel: (r) => r.fuel }), series: [{ key: "km", label: "Km driven" }, { key: "fuel", label: "Fuel spent (PHP)" }], csvName: csv("km-fuel") },
          ] as GChart[])
        : []),
      ...(see.donors
        ? ([
            { group: "donors", title: "Donations", description: "Gifts in kind by the category each line was received under in LAF Inventory, and cash gifts in pesos.", note: filtered ? "Donations aren't filtered by patient." : undefined, kind: "bar", stacked: true, xKey: "label", data: series(giftsRows, (x) => x.date, span, { food: (x) => x.food, nonFood: (x) => x.nonFood, cash: (x) => x.cash }), series: [{ key: "food", label: "Food items" }, { key: "nonFood", label: "Non-food items" }, { key: "cash", label: "Cash" }], csvName: csv("donations") },
          ] as GChart[])
        : []),
      ...(see.caf
        ? ([{ group: "caf", title: "NCH billing by month", description: "The NCH Cancer Assistance Fund bills: pesos billed and paid, and the nights above the monthly cap that LAF absorbed.", note: "Billed and paid in pesos; nights above the monthly cap are absorbed by LAF.", kind: "bar", xKey: "label", data: cafMonths, series: [{ key: "billed", label: "Billed" }, { key: "paid", label: "Paid" }, { key: "absorbed", label: "Nights absorbed" }], csvName: csv("nch-billing") }] as GChart[])
        : []),
      ...(see.hours
        ? ([{ group: "hours", title: "Staff hours", description: "Hours worked and late arrivals from the staff's clock-ins and clock-outs.", kind: "bar", xKey: "label", data: series(d.hours, (h) => h.date, span, { hours: (h) => Math.round((h.minutes / 60) * 10) / 10, late: (h) => (h.late ? 1 : 0) }), series: [{ key: "hours", label: "Hours worked" }, { key: "late", label: "Late arrivals" }], csvName: csv("staff-hours") }] as GChart[])
        : []),
    ];
    return { kpis, charts, donationsTitle: `Donations · ${formatCurrency(giftsRows.reduce((s, x) => s + x.food + x.nonFood + x.cash, 0))} in the range` };
  };

  const current = data ? build(data, win, grain) : null;
  const before = previous.data ? build(previous.data, prevWin, "month") : null;
  const kpis: AnalyticsKpi[] = (current?.kpis ?? []).map((k, i) => ({ ...k, previous: before?.kpis[i]?.current ?? 0 }));

  const label = periodLabel(period.kind, win);
  const prevLabel = periodLabel(period.kind, prevWin);
  const filterWords = FILTER_KEYS.flatMap((k) => {
    const v = params.get(k);
    if (!v) return [];
    const text = k === "diagnosisId" ? diagnosisName.get(v) : k === "provinceId" ? provinceName.get(v) : k === "hospitalId" ? hospitalName.get(v) : k === "status" ? titleCase(v) : k === "illnessCode" ? ILLNESS_CODES[v as keyof typeof ILLNESS_CODES] : v;
    return [`${FILTER_LABELS[k]}: ${text ?? v}`];
  });
  const report = () => analyticsReport({ charts: current?.charts ?? [], previous: before?.charts ?? [], kpis, period: label, previousPeriod: prevLabel, filters: filterWords });
  const delta = (k: AnalyticsKpi) => (k.previous > 0 ? Math.round(((k.current - k.previous) / k.previous) * 100) : undefined);

  const options = (pairs: [string, string][]) =>
    pairs.map(([value, text]) => (
      <SelectItem key={value} value={value}>
        {text}
      </SelectItem>
    ));
  const pick = (key: (typeof FILTER_KEYS)[number], placeholder: string, pairs: [string, string][], width = "w-40") => (
    <Select value={params.get(key) ?? ALL} onValueChange={(v) => setParams({ [key]: v })}>
      <SelectTrigger className={`${width} print:hidden`} aria-label={placeholder}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{placeholder}</SelectItem>
        {options(pairs)}
      </SelectContent>
    </Select>
  );
  const card = (c: ChartDef) => <ChartCard key={c.title} title={c.title === "Donations" ? (current?.donationsTitle ?? c.title) : c.title} description={c.description} note={c.note} kind={c.kind} stacked={c.stacked} xKey={c.xKey} data={c.data} series={c.series} csvName={c.csvName} analysis={ai.analysis?.sections[c.title]} />;
  const group = (g: string) => (current?.charts ?? []).filter((c) => c.group === g).map(card);
  const icons = [Bed, Users, UserPlus, Timer];

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Analytics"
        description="Live from the records for any range, by day, week or month, compared with the range before. Patient filters apply to every patient chart; each chart downloads as CSV; the page exports as a branded PDF with the AI's comparison, or prints."
        action={
          <Button variant="outline" className="print:hidden" onClick={() => window.print()}>
            <Printer /> Print
          </Button>
        }
      />

      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <PeriodPicker value={period} onChange={setPeriod} />
            <Select value={grainParam ?? "auto"} onValueChange={(v) => setParams({ by: v === "auto" ? null : v })}>
              <SelectTrigger className="w-36 print:hidden" aria-label="Group by">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">By {grain} (auto)</SelectItem>
                <SelectItem value="day">By day</SelectItem>
                <SelectItem value="week">By week</SelectItem>
                <SelectItem value="month">By month</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <ReportToolbar ai={ai} buildSpec={() => report().spec} buildInput={() => report().input} filename={`LAF-Analytics-${from}-${to}.pdf`} />
        </div>
        {see.patients && (
          <div className="flex flex-wrap items-center gap-2">
            {pick("priority", "Any priority", Object.entries(PRIORITIES).map(([k, v]) => [k, `${k} · ${v}`]))}
            {pick("illnessCode", "Any patient type", Object.entries(ILLNESS_CODES).map(([k, v]) => [k, v]), "w-48")}
            {pick("diagnosisCategory", "Any diagnosis group", [["cancer", "Cancer"], ["thalassemia", "Thalassemia"], ["other", "Other"]])}
            {pick("diagnosisId", "Any diagnosis", [...diagnoses].sort((a, b) => a.name.localeCompare(b.name)).map((d) => [d.id, d.name]), "w-56")}
            {pick("status", "Any status", STATUSES.map((s) => [s, titleCase(s)]))}
            {pick("sex", "Any sex", [["F", "Female"], ["M", "Male"]], "w-32")}
            {pick("ageGroup", "Any age", AGE_GROUPS.map((a) => [a, a]), "w-32")}
            {pick("provinceId", "Any province", [...provinces].sort((a, b) => a.name.localeCompare(b.name)).map((p) => [p.id, p.name]), "w-48")}
            {pick("hospitalId", "Any hospital", hospitals.map((h) => [h.id, h.name]), "w-48")}
            {filtered && (
              <Button variant="ghost" size="sm" className="print:hidden" onClick={() => setParams(Object.fromEntries(FILTER_KEYS.map((k) => [k, null])))}>
                <RotateCcw /> Clear filters
              </Button>
            )}
          </div>
        )}
      </div>

      {error ? <p className="text-theme-sm text-destructive">{error}</p> : null}
      {!data ? <p className="text-theme-sm text-muted-foreground">Loading the records…</p> : null}
      <AiAnalysisPanel text={ai.analysis?.overall} />

      {see.patients && current && (
        <>
          <KpiGrid>
            {kpis.map((k, i) => (
              <KpiCard key={k.label} label={k.label} value={k.value} icon={icons[i]} sublabel={`${prevLabel}: ${k.previous.toLocaleString()}${filtered ? " · filtered" : ""}`} deltaPct={delta(k)} deltaLabel={`vs ${prevLabel}`} />
            ))}
          </KpiGrid>
          <AiAnalysisPanel text={ai.analysis?.sections.Patients} />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{group("patients")}</div>
        </>
      )}
      {see.transport && current && <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{group("transport")}</div>}
      {see.donors && current && group("donors")}
      {(see.caf || see.hours) && current && <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{[...group("caf"), ...group("hours")]}</div>}
    </div>
  );
}
