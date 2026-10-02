"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle, Bus, Car, ChevronLeft, ChevronRight, Coins, Fuel, Gauge, HandCoins, Route, Wrench } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { ModuleSubNav } from "@/components/patterns/module-subnav";
import { TRANSPORT_SUB_NAV } from "@/components/modules/transport/transport-nav";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { SectionCard } from "@/components/patterns/section-card";
import { EmptyState } from "@/components/patterns/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FuelGauge } from "@/components/modules/transport/fuel-gauge";
import { OdometerDrums } from "@/components/modules/transport/odometer-drums";
import { useRole } from "@/context/role-provider";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import { recordFuelLevel, useFleetStatus, usePeriodData, type PeriodTrip, type VehicleStatus } from "@/lib/hooks/use-fleet-collection";
import { useRouteKm } from "@/lib/hooks/use-vehicles-collection";
import { useVehicleExpenses } from "@/lib/hooks/use-vehicle-expenses-collection";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate, todayIso } from "@/lib/utils/date";
import { periodRange, periodTotals, shiftPeriod, untrackedGaps, type PeriodKind, type PeriodTotals } from "@/lib/utils/fuel";
import { formatKm, isUnusualTrip, routeKey } from "@/lib/utils/odometer";
import { formatPesoCents } from "@/lib/utils/vehicle-expenses";
import { cn } from "@/lib/utils";

const KINDS: { value: PeriodKind; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "year", label: "Year" },
];
const LEVELS = [
  { value: 0, label: "E" },
  { value: 0.25, label: "¼" },
  { value: 0.5, label: "½" },
  { value: 0.75, label: "¾" },
  { value: 1, label: "F" },
];
const litres = (n: number) => `${n.toLocaleString("en-PH", { maximumFractionDigits: 1 })} L`;

/**
 * Fuel Monitoring (phase D, 0079): each vehicle's gauge and odometer, the period's trips, km,
 * fuel and costs, the checks that need a look, and when each service is due.
 */
export default function FuelMonitoringPage() {
  const access = useModuleAccess();
  const canEdit = access.canEdit("transport");
  const { statuses, loading } = useFleetStatus();
  const [kind, setKind] = React.useState<PeriodKind>("month");
  const [anchor, setAnchor] = React.useState(todayIso());
  const [vehicleId, setVehicleId] = React.useState("all");
  const period = periodRange(kind, anchor);
  const data = usePeriodData(period.from, period.to);
  const routes = useRouteKm();
  const { kindName } = useVehicleExpenses();
  const atToday = period.to >= todayIso();

  const shown = statuses.filter((s) => vehicleId === "all" || s.vehicle.id === vehicleId);
  const perVehicle = shown.map((s) => ({
    s,
    trips: data.trips.filter((t) => t.vehicleId === s.vehicle.id),
    totals: periodTotals(
      data.trips.filter((t) => t.vehicleId === s.vehicle.id),
      data.expenses.filter((e) => e.vehicleId === s.vehicle.id),
      s.kmPerLitre
    ),
  }));
  const totals = sumTotals(perVehicle.map((p) => p.totals));
  const checks = perVehicle.flatMap((p) => checksFor(p.s, p.trips, routes, p.totals.km === 0 && p.totals.litresBought > 0));
  const byKind = Object.entries(totals.byKind).sort((a, b) => b[1] - a[1]);
  const services = shown.flatMap((s) => s.services.map((sv) => ({ ...sv, vehicle: s.vehicle.name })));

  if (!access.loading && !access.canView("transport")) {
    return <EmptyState icon={Fuel} title="Fuel Monitoring is for Transport" description="Ask the Super Admin for Transport access." />;
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Fuel Monitoring" description="Trips, km, fuel and every vehicle cost, by day, week, month, quarter or year." action={<ModuleSubNav items={TRANSPORT_SUB_NAV} />} />

      {!loading && statuses.length === 0 ? (
        <EmptyState icon={Car} title="No vehicles yet" description="The Super Admin adds them in Settings › Vehicles." />
      ) : (
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-label="Vehicles">
          {statuses.map((s) => (
            <InstrumentCard key={s.vehicle.id} status={s} canEdit={canEdit} />
          ))}
        </section>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="no-scrollbar flex gap-1 overflow-x-auto rounded-xl bg-muted p-1" role="tablist" aria-label="Period">
            {KINDS.map((k) => (
              <button
                key={k.value}
                type="button"
                role="tab"
                aria-selected={kind === k.value}
                onClick={() => setKind(k.value)}
                className="rounded-lg px-3 py-1.5 text-theme-sm font-medium whitespace-nowrap text-muted-foreground transition-colors aria-selected:bg-card aria-selected:text-foreground aria-selected:shadow-theme-xs"
              >
                {k.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <Button size="icon-sm" variant="outline" aria-label="Earlier" onClick={() => setAnchor(shiftPeriod(kind, anchor, -1))}>
              <ChevronLeft />
            </Button>
            <span className="min-w-40 text-center text-theme-sm font-medium tabular-nums">{period.label}</span>
            <Button size="icon-sm" variant="outline" aria-label="Later" disabled={atToday} onClick={() => setAnchor(shiftPeriod(kind, anchor, 1))}>
              <ChevronRight />
            </Button>
          </div>
          {statuses.length > 1 && (
            <Select value={vehicleId} onValueChange={setVehicleId}>
              <SelectTrigger className="w-full sm:w-56" aria-label="Vehicle">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All vehicles</SelectItem>
                {statuses.map((s) => (
                  <SelectItem key={s.vehicle.id} value={s.vehicle.id}>
                    {s.vehicle.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        {data.error && <p className="text-theme-sm text-destructive">Couldn&apos;t load this period: {data.error}</p>}

        <KpiGrid>
          <KpiCard label="Trips" value={data.loading ? "…" : totals.trips} icon={Bus} />
          <KpiCard label="Kilometres" value={data.loading ? "…" : formatKm(totals.km)} icon={Route} />
          <KpiCard label="Fuel bought" value={data.loading ? "…" : litres(totals.litresBought)} icon={Fuel} sublabel={formatCurrency(totals.fuelCost)} />
          <KpiCard
            label="Fuel used (est.)"
            value={data.loading ? "…" : totals.estLitresUsed == null ? "—" : litres(totals.estLitresUsed)}
            icon={Gauge}
            sublabel="km ÷ km per litre"
          />
          <KpiCard label="Other expenses" value={data.loading ? "…" : formatCurrency(totals.otherCost)} icon={Wrench} />
          <KpiCard label="Total cost" value={data.loading ? "…" : formatCurrency(totals.totalCost)} icon={Coins} />
          <KpiCard label="Cost per km" value={data.loading ? "…" : totals.costPerKm == null ? "—" : formatPesoCents(totals.costPerKm)} icon={Route} />
          <KpiCard
            label="Paid by drivers"
            value={data.loading ? "…" : formatCurrency(totals.paidByDrivers)}
            icon={HandCoins}
            tone={totals.paidByDrivers > 0 ? "warning" : "default"}
            sublabel="To be reimbursed"
          />
        </KpiGrid>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SectionCard title="Where the money went" description={period.label}>
          {byKind.length === 0 ? (
            <p className="text-theme-sm text-muted-foreground">No fuel or expenses logged in this period.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {byKind.map(([k, amount]) => (
                <div key={k} className="flex flex-col gap-1">
                  <div className="flex justify-between text-theme-sm">
                    <span>{kindName(k)}</span>
                    <span className="font-medium tabular-nums">{formatCurrency(amount)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${(amount / totals.totalCost) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Needs a look" description="Readings and fill-ups in this period that don't add up">
          {checks.length === 0 ? (
            <p className="text-theme-sm text-muted-foreground">Nothing to check in this period.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {checks.map((c) => (
                <li key={c.key} className="flex gap-2 text-theme-sm">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                  <span className="flex min-w-0 flex-col">
                    <span>{c.text}</span>
                    {c.photoId && <PhotoLink id={c.photoId} />}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="Maintenance"
        description="When each service is due, by km or by months"
        actions={
          <Link href="/settings#vehicles" className="text-theme-sm text-primary hover:underline">
            Intervals
          </Link>
        }
      >
        {services.length === 0 ? (
          <p className="text-theme-sm text-muted-foreground">No service intervals yet. The Super Admin sets them per vehicle in Settings › Vehicles.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {services.map((sv) => (
              <li key={`${sv.vehicle}-${sv.kind}`} className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
                <span className="flex flex-col">
                  <span className="text-theme-sm font-medium">
                    {sv.kindName}
                    {statuses.length > 1 ? ` · ${sv.vehicle}` : ""}
                  </span>
                  <span className="text-theme-xs text-muted-foreground">
                    {sv.last ? `Last ${formatDate(sv.last.date, "MMM d, yyyy")}${sv.last.odometer != null ? ` at ${formatKm(sv.last.odometer)}` : ""}` : "Not logged yet: log the last one as an expense"}
                    {" · every "}
                    {[sv.rule.everyKm != null ? formatKm(sv.rule.everyKm) : null, sv.rule.everyMonths != null ? `${sv.rule.everyMonths} months` : null].filter(Boolean).join(" or ")}
                  </span>
                </span>
                <DueBadge due={sv.due} />
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

/** One vehicle on the dark instrument panel: gauge, odometer, km per litre; the driver can read the gauge in. */
function InstrumentCard({ status: s, canEdit }: { status: VehicleStatus; canEdit: boolean }) {
  const { vehicle: v } = s;
  const { staffId } = useRole();
  const [saving, setSaving] = React.useState(false);
  const litresLeft = s.level != null && v.tankLitres ? s.level * v.tankLitres : null;

  async function readGauge(level: number) {
    setSaving(true);
    const r = await recordFuelLevel(v.id, level, v.lastReading);
    setSaving(false);
    if (r.ok) toast.success("Gauge reading saved");
    else toast.error(r.error);
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 py-5">
        <div className="flex items-center justify-between gap-2">
          <span className="flex flex-col">
            <span className="font-medium text-foreground">{v.name}</span>
            <span className="text-theme-xs text-muted-foreground">{v.plateNo ?? "No plate number yet"}</span>
          </span>
          {s.level != null && s.level < 0.25 && <Badge variant="destructive">Refuel soon</Badge>}
        </div>
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-5 gap-y-4 rounded-2xl bg-instrument p-3 text-instrument-foreground shadow-theme-md sm:p-4">
          <FuelGauge level={s.level} doorSide={v.fuelDoorSide} className="sm:row-span-2" />
          <dl className="flex flex-col gap-2 text-theme-xs sm:order-3 sm:self-start">
            <div>
              <dt className="text-instrument-muted">In the tank</dt>
              <dd className="font-medium tabular-nums">
                {litresLeft != null ? `≈ ${litres(litresLeft)} of ${litres(v.tankLitres!)}` : v.tankLitres ? "Known after a full fill" : "Set the tank size in Settings"}
              </dd>
            </div>
            <div>
              <dt className="text-instrument-muted">Km per litre</dt>
              <dd className="font-medium tabular-nums">
                {s.kmPerLitre != null ? `${s.kmPerLitre} ${s.measured ? "(measured)" : "(starting figure)"}` : "Known after two full fills"}
              </dd>
            </div>
          </dl>
          <div className="col-span-2 justify-self-center sm:order-2 sm:col-span-1 sm:self-end sm:justify-self-start">
            {v.startOdometer != null ? (
              <OdometerDrums value={v.lastReading} className="ring-white/10" />
            ) : (
              <span className="text-theme-sm text-instrument-muted">Odometer not tracked yet.</span>
            )}
          </div>
        </div>
        {s.efficiencyDrop && (
          <p className="flex items-center gap-2 text-theme-xs text-warning-foreground dark:text-warning">
            <AlertTriangle className="size-4 shrink-0" />
            The last full tank went more than {s.efficiencyPct}% less far than the ones before. Worth a check (tires, a leak, a long idle).
          </p>
        )}
        {canEdit && staffId && v.startOdometer != null && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-theme-xs text-muted-foreground">The gauge reads</span>
            {LEVELS.map((l) => (
              <Button key={l.value} size="sm" variant="outline" className="min-w-10" disabled={saving} onClick={() => readGauge(l.value)} aria-label={`Gauge reads ${l.label}`}>
                {l.label}
              </Button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DueBadge({ due }: { due: VehicleStatus["services"][number]["due"] }) {
  const left = [due.kmLeft != null ? `${formatKm(Math.abs(due.kmLeft))}` : null, due.daysLeft != null ? `${Math.abs(due.daysLeft)} days` : null].filter(Boolean).join(" / ");
  if (due.status === "unknown") return <Badge variant="secondary">No record</Badge>;
  if (due.status === "overdue") return <Badge variant="destructive">Overdue {left}</Badge>;
  return (
    <Badge variant="outline" className={cn(due.status === "soon" && "border-warning/40 bg-warning/10 text-warning-foreground dark:text-warning")}>
      {due.status === "soon" ? "Due soon" : "OK"} · {left} left
    </Badge>
  );
}

function PhotoLink({ id }: { id: string }) {
  async function open() {
    const res = await fetch(`/api/transport/odometer-photo?id=${id}`);
    const body = await res.json().catch(() => ({}));
    if (body.url) window.open(body.url, "_blank", "noopener");
    else toast.error(body.error ?? "The photo couldn't be opened.");
  }
  return (
    <button type="button" className="self-start text-theme-xs text-primary hover:underline" onClick={open}>
      See the photo
    </button>
  );
}

function sumTotals(list: PeriodTotals[]): PeriodTotals {
  const sum = (f: (t: PeriodTotals) => number) => Math.round(list.reduce((s, t) => s + f(t), 0) * 100) / 100;
  const byKind: Record<string, number> = {};
  for (const t of list) for (const [k, v] of Object.entries(t.byKind)) byKind[k] = Math.round(((byKind[k] ?? 0) + v) * 100) / 100;
  const km = sum((t) => t.km);
  const totalCost = sum((t) => t.totalCost);
  return {
    trips: sum((t) => t.trips),
    km,
    litresBought: sum((t) => t.litresBought),
    fuelCost: sum((t) => t.fuelCost),
    otherCost: sum((t) => t.otherCost),
    totalCost,
    estLitresUsed: list.some((t) => t.estLitresUsed != null) ? sum((t) => t.estLitresUsed ?? 0) : null,
    costPerKm: km > 0 ? Math.round((totalCost / km) * 100) / 100 : null,
    paidByDrivers: sum((t) => t.paidByDrivers),
    byKind,
  };
}

/** The period's checks for one vehicle, in plain sentences. */
function checksFor(
  s: VehicleStatus,
  trips: PeriodTrip[],
  routes: Map<string, { medianKm: number; trips: number }>,
  fuelWithoutKm: boolean
): { key: string; text: string; photoId?: string | null }[] {
  const name = s.vehicle.name;
  const out: { key: string; text: string; photoId?: string | null }[] = [];
  for (const g of untrackedGaps(trips)) {
    out.push({ key: `gap-${g.afterTripId}`, text: `${name}: ${formatKm(g.km)} on the odometer between trips, with no trip logged (before ${formatDate(g.date, "MMM d")}).` });
  }
  for (const t of trips) {
    if (t.odometerStart != null && t.odometerEnd != null) {
      const km = t.odometerEnd - t.odometerStart;
      const usual = routes.get(routeKey(t.direction, t.destination)) ?? null;
      if (isUnusualTrip(km, usual)) {
        out.push({ key: `odd-${t.id}`, text: `${name}: a trip on ${formatDate(t.date, "MMM d")} read ${formatKm(km)}; that route is usually about ${formatKm(Math.round(usual!.medianKm))}.` });
      }
    }
    if (t.aiStart != null && t.odometerStart != null && Math.abs(t.aiStart - t.odometerStart) > 1) {
      out.push({ key: `ai-s-${t.id}`, text: `${name}: departure on ${formatDate(t.date, "MMM d")} was confirmed at ${formatKm(t.odometerStart)}; the photo read ${formatKm(t.aiStart)}.`, photoId: t.startPhotoId });
    }
    if (t.aiEnd != null && t.odometerEnd != null && Math.abs(t.aiEnd - t.odometerEnd) > 1) {
      out.push({ key: `ai-e-${t.id}`, text: `${name}: arrival on ${formatDate(t.date, "MMM d")} was confirmed at ${formatKm(t.odometerEnd)}; the photo read ${formatKm(t.aiEnd)}.`, photoId: t.endPhotoId });
    }
  }
  if (fuelWithoutKm) out.push({ key: `fuel-${s.vehicle.id}`, text: `${name}: fuel was bought in this period but no km were driven.` });
  if (s.efficiencyDrop) out.push({ key: `eff-${s.vehicle.id}`, text: `${name}: the last full tank went more than ${s.efficiencyPct}% less far than the ones before.` });
  return out;
}
