"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Bed, ChevronLeft, ChevronRight, Printer, RotateCcw, Timer, UserPlus, Users } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChartCard } from "@/components/modules/analytics/chart-card";
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
import { cafAmounts, cafMonthLabel } from "@/lib/utils/caf";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate, todayIso } from "@/lib/utils/date";
import { ILLNESS_CODES, PRIORITIES } from "@/lib/utils/master-sheet";
import { periodLabel, periodWindow, shiftAnchor, type PeriodKind } from "@/lib/utils/period";
import { ageGroupOn, autoGrain, breakdown, matchesPatient, series, type Grain, type PatientFilter } from "@/lib/utils/report-series";

type Range = PeriodKind | "custom";
const RANGES: { value: Range; label: string }[] = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "year", label: "Year" },
  { value: "custom", label: "Custom" },
];
const ALL = "all";
const STATUSES = ["ongoing", "check_up", "completed", "expired", "lost_to_follow_up", "non_pedia"];
const AGE_GROUPS = ["0–1", "2–5", "6–9", "10–12", "13–15", "16–18"];
const FILTER_KEYS = ["priority", "illnessCode", "diagnosisCategory", "diagnosisId", "status", "sex", "ageGroup", "provinceId", "hospitalId"] as const;
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

/**
 * Analytics (2026-10-15): everything the house records, for any range -- day, week, month,
 * quarter, year or custom -- by day, week or month, with the patient filters (priority, patient
 * type, diagnosis, status, sex, age group, province, hospital) applied to every patient chart.
 * Live from the records, read with the viewer's own access: a section the viewer can't open is
 * left out. Filters stay in the address, so a view can be bookmarked or shared. Prints to PDF.
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
  const range = (params.get("range") as Range) || "month";
  const anchor = params.get("at") || today;
  const win = range === "custom" ? { from: params.get("from") || periodWindow("month", today).from, to: params.get("to") || today } : periodWindow(range, anchor);
  const { from, to } = win;
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

  const access = useModuleAccess();
  const { roles } = useRole();
  const see = {
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

  // ---- the range's records, read once per range ----
  const rangeKey = `${from}|${to}`;
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
        ? fetchAll<{ date: string; meal: string; patient_id: string }>((f, t) => ops().from("meals_served").select("date, meal, patient_id").gte("date", from).lte("date", to).order("date").range(f, t))
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
  const data = loaded?.key === rangeKey ? loaded : null;

  // ---- patients that pass the filters ----
  const filterKey = params.toString();
  const categoryOf = React.useMemo(() => new Map(diagnoses.map((d) => [d.id, d.category])), [diagnoses]);
  const okPatient = React.useMemo(() => {
    const ok = new Set(patients.filter((p) => matchesPatient(p, filter, { categoryOf: (id) => categoryOf.get(id), today })).map((p) => p.id));
    return (id: string) => ok.has(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the filter is read from the address each render; its string is the key.
  }, [patients, categoryOf, today, filterKey]);
  const span = { from, to, grain };

  const nights = (data?.nights ?? []).filter((n) => okPatient(n.patientId));
  const visitStarts = [...new Map(nights.filter((n) => n.visitStart >= from && n.visitStart <= to).map((n) => [n.visitId, { checkInAt: n.visitStart }])).values()];
  const served = [...new Set(nights.map((n) => n.patientId))].flatMap((id) => patients.filter((p) => p.id === id));
  const visitsWithNights = new Set(nights.map((n) => n.visitId)).size;
  const checkUps = appointments.filter((a) => a.date >= from && a.date <= to && okPatient(a.patientId));
  const meals = (data?.meals ?? []).filter((m) => okPatient(m.patientId));

  const provinceName = new Map(provinces.map((p) => [p.id, p.name]));
  const hospitalName = new Map(hospitals.map((h) => [h.id, h.name]));
  const diagnosisName = new Map(diagnoses.map((d) => [d.id, d.name]));

  const cashGifts = see.donors ? donations.filter((d) => d.kind === "cash" && d.currency === "PHP" && d.date >= from && d.date <= to) : [];
  const giftsRows = [
    ...(data?.gifts ?? []).map((g) => ({ date: g.date, food: g.food, nonFood: g.nonFood, cash: 0 })),
    ...cashGifts.map((g) => ({ date: g.date, food: 0, nonFood: 0, cash: g.totalValue })),
  ];
  const cafMonths = bills
    .filter((b) => b.month >= `${from.slice(0, 7)}-01` && b.month <= to)
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((b) => {
      const terms = { rate: b.rate, cap: b.cap, discountPct: b.discountPct };
      const amounts = b.lines.map((l) => cafAmounts(l, terms));
      const due = Math.round(amounts.reduce((s, a) => s + a.net, 0));
      return {
        label: cafMonthLabel(b.month),
        billed: due,
        paid: b.status === "paid" ? due : 0,
        absorbed: amounts.reduce((s, a) => s + (a.stays - a.billable), 0),
      };
    });

  const label = range === "custom" ? `${formatDate(from)} – ${formatDate(to)}` : periodLabel(range, win);
  const csv = (name: string) => `${name}-${from}-to-${to}`;
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

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Analytics"
        description="Live from the records for any range, by day, week or month. Patient filters apply to every patient chart; each chart downloads as CSV, and the page prints to PDF."
        action={
          <Button variant="outline" className="print:hidden" onClick={() => window.print()}>
            <Printer /> Print / PDF
          </Button>
        }
      />

      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={range} onValueChange={(v) => setParams({ range: v, at: null })}>
            <SelectTrigger className="w-32 print:hidden" aria-label="Date range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>{RANGES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
          </Select>
          {range === "custom" ? (
            <span className="flex items-center gap-2 print:hidden">
              <Input type="date" aria-label="From" className="w-40" value={from} max={to} onChange={(e) => e.target.value && setParams({ from: e.target.value })} />
              <span className="text-theme-sm text-muted-foreground">to</span>
              <Input type="date" aria-label="To" className="w-40" value={to} min={from} onChange={(e) => e.target.value && setParams({ to: e.target.value })} />
            </span>
          ) : (
            <span className="flex items-center gap-1 print:hidden">
              <Button type="button" size="icon-sm" variant="outline" aria-label="Previous" onClick={() => setParams({ at: shiftAnchor(range, anchor, -1) })}>
                <ChevronLeft />
              </Button>
              <Button type="button" size="icon-sm" variant="outline" aria-label="Next" onClick={() => setParams({ at: shiftAnchor(range, anchor, 1) })}>
                <ChevronRight />
              </Button>
            </span>
          )}
          <span className="text-theme-sm font-medium">{label}</span>
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

      {see.patients && data && (
        <>
          <KpiGrid>
            <KpiCard label="Bed nights" value={nights.length.toLocaleString()} icon={Bed} sublabel={filtered ? "Filtered" : undefined} />
            <KpiCard label="Families served" value={served.length.toLocaleString()} icon={Users} />
            <KpiCard label="New visits" value={visitStarts.length.toLocaleString()} icon={UserPlus} />
            <KpiCard label="Nights per visit" value={visitsWithNights ? (nights.length / visitsWithNights).toFixed(1) : "—"} icon={Timer} />
          </KpiGrid>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard
              title="Bed nights and new visits"
              kind="line"
              data={series([...nights.map((n) => ({ day: n.night, n: 1, v: 0 })), ...visitStarts.map((s) => ({ day: s.checkInAt, n: 0, v: 1 }))], (r) => r.day, span, { nights: (r) => r.n, visits: (r) => r.v })}
              series={[{ key: "nights", label: "Bed nights" }, { key: "visits", label: "New visits" }]}
              csvName={csv("bed-nights")}
            />
            <ChartCard
              title="Check-ups and rides"
              data={series(checkUps, (a) => a.date, span, { checkUps: () => 1, rides: (a) => (a.needsTransport ? 1 : 0) })}
              series={[{ key: "checkUps", label: "Check-ups" }, { key: "rides", label: "Needing a ride" }]}
              csvName={csv("check-ups")}
            />
            <ChartCard title="Families served by priority" kind="rank" xKey="name" data={breakdown(served, (p) => (p.priority ? `${p.priority} · ${PRIORITIES[p.priority]}` : null))} series={[{ key: "count", label: "Families" }]} csvName={csv("by-priority")} />
            <ChartCard title="By patient type" kind="rank" xKey="name" data={breakdown(served, (p) => (p.illnessCode ? ILLNESS_CODES[p.illnessCode] : null))} series={[{ key: "count", label: "Families" }]} csvName={csv("by-patient-type")} />
            <ChartCard title="By diagnosis" kind="rank" xKey="name" data={breakdown(served, (p) => diagnosisName.get(p.diagnosisIds[0] ?? ""))} series={[{ key: "count", label: "Families" }]} csvName={csv("by-diagnosis")} />
            <ChartCard title="By age group" kind="rank" xKey="name" data={AGE_GROUPS.map((g) => ({ name: g, count: served.filter((p) => ageGroupOn(p.birthDate, today) === g).length }))} series={[{ key: "count", label: "Families" }]} csvName={csv("by-age")} />
            <ChartCard title="By province" kind="rank" xKey="name" data={breakdown(served, (p) => provinceName.get(p.provinceId))} series={[{ key: "count", label: "Families" }]} csvName={csv("by-province")} />
            <ChartCard title="By sex and referring hospital" kind="rank" xKey="name" data={[...breakdown(served, (p) => (p.sex === "F" ? "Female" : p.sex === "M" ? "Male" : null), 2), ...breakdown(served, (p) => hospitalName.get(p.referringHospitalId ?? ""), 4)]} series={[{ key: "count", label: "Families" }]} csvName={csv("by-sex-hospital")} />
            <ChartCard
              title="Meals served"
              note="Ticked on House Today since 15 Oct 2026."
              stacked
              data={series(meals, (m) => m.date, span, { breakfast: (m) => (m.meal === "breakfast" ? 1 : 0), lunch: (m) => (m.meal === "lunch" ? 1 : 0), dinner: (m) => (m.meal === "dinner" ? 1 : 0) })}
              series={[{ key: "breakfast", label: "Breakfast" }, { key: "lunch", label: "Lunch" }, { key: "dinner", label: "Dinner" }]}
              csvName={csv("meals")}
            />
          </div>
        </>
      )}

      {see.transport && data && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard
            title="Trips"
            note={filtered ? "Trips aren't filtered by patient." : undefined}
            stacked
            data={series(data.trips, (t) => t.date, span, {
              pickups: (t) => (t.passengers && t.direction === "from_hospital" ? 1 : 0),
              deliveries: (t) => (t.passengers && t.direction === "to_hospital" && !t.urgent ? 1 : 0),
              urgent: (t) => (t.urgent ? 1 : 0),
              errands: (t) => (!t.passengers ? 1 : 0),
            })}
            series={[{ key: "pickups", label: "Pick-ups" }, { key: "deliveries", label: "Deliveries" }, { key: "urgent", label: "Urgent" }, { key: "errands", label: "Errands" }]}
            csvName={csv("trips")}
          />
          <ChartCard
            title="Kilometres and fuel"
            data={series([...data.trips.map((t) => ({ day: t.date, km: t.km, fuel: 0 })), ...data.expenses.map((e) => ({ day: e.date, km: 0, fuel: e.litres > 0 ? e.amount : 0 }))], (r) => r.day, span, { km: (r) => r.km, fuel: (r) => r.fuel })}
            series={[{ key: "km", label: "Km driven" }, { key: "fuel", label: "Fuel spent (PHP)" }]}
            csvName={csv("km-fuel")}
          />
        </div>
      )}

      {see.donors && data && (
        <ChartCard
          title={`Donations · ${formatCurrency(giftsRows.reduce((s, g) => s + g.food + g.nonFood + g.cash, 0))} in the range`}
          note={filtered ? "Donations aren't filtered by patient." : "Gifts in kind by the category each line was received under in LAF Inventory; cash in pesos."}
          stacked
          data={series(giftsRows, (g) => g.date, span, { food: (g) => g.food, nonFood: (g) => g.nonFood, cash: (g) => g.cash })}
          series={[{ key: "food", label: "Food items" }, { key: "nonFood", label: "Non-food items" }, { key: "cash", label: "Cash" }]}
          csvName={csv("donations")}
        />
      )}

      {(see.caf || see.hours) && data && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {see.caf && (
            <ChartCard
              title="NCH billing by month"
              note="Billed and paid in pesos; nights above the monthly cap are absorbed by LAF."
              xKey="label"
              data={cafMonths}
              series={[{ key: "billed", label: "Billed" }, { key: "paid", label: "Paid" }, { key: "absorbed", label: "Nights absorbed" }]}
              csvName={csv("nch-billing")}
            />
          )}
          {see.hours && (
            <ChartCard
              title="Staff hours"
              data={series(data.hours, (h) => h.date, span, { hours: (h) => Math.round((h.minutes / 60) * 10) / 10, late: (h) => (h.late ? 1 : 0) })}
              series={[{ key: "hours", label: "Hours worked" }, { key: "late", label: "Late arrivals" }]}
              csvName={csv("staff-hours")}
            />
          )}
        </div>
      )}
    </div>
  );
}
