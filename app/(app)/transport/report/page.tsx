"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { ModuleSubNav } from "@/components/patterns/module-subnav";
import { SectionCard } from "@/components/patterns/section-card";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { useVehicles } from "@/lib/hooks/use-vehicles-collection";
import { useStaffRoster } from "@/lib/hooks/use-staff-roster";
import { useVehicleExpenses } from "@/lib/hooks/use-vehicle-expenses-collection";
import { TRANSPORT_SUB_NAV } from "@/components/modules/transport/transport-nav";
import { periodRange, shiftPeriod, type PeriodKind } from "@/lib/utils/fuel";
import { csvLines, downloadCsv } from "@/lib/utils/csv";
import { formatDate, todayIso } from "@/lib/utils/date";
import { formatCurrency } from "@/lib/utils/currency";
import { formatTime12 } from "@/lib/utils/time12";
import { directionLabel } from "@/lib/utils/trip-direction";

interface TripRow {
  id: string;
  date: string;
  direction: string;
  carriesPassengers: boolean;
  destination: string | null;
  vehicleId: string | null;
  vehicle: string;
  driverId: string | null;
  status: string;
  departureTime: string | null;
  departedAt: string | null;
  arrivedAt: string | null;
  odometerStart: number | null;
  odometerEnd: number | null;
  passengers: number;
}
interface ExpenseRow {
  id: string;
  date: string;
  vehicleId: string;
  kind: string;
  amount: number;
  litres: number | null;
  odometer: number | null;
  vendor: string | null;
  paidBy: "laf" | "driver";
  paidByStaffId: string | null;
  posted: boolean;
}

const PERIODS: { value: PeriodKind; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "year", label: "Year" },
];

/**
 * Transport & fuel report (go-live, 2026-10-13): the period's trips and fuel/expense entries as
 * tables with CSV downloads -- the Fuel Monitoring screen shows the figures, this hands them to
 * the office. Transport view is enough to read it.
 */
export default function TransportReportPage() {
  const { vehicles } = useVehicles();
  const { staff } = useStaffRoster();
  const { kindName } = useVehicleExpenses();
  const [kind, setKind] = React.useState<PeriodKind>("month");
  const [anchor, setAnchor] = React.useState(todayIso());
  const [vehicleId, setVehicleId] = React.useState("all");
  const period = periodRange(kind, anchor);
  const [trips, setTrips] = React.useState<TripRow[] | null>(null);
  const [expenses, setExpenses] = React.useState<ExpenseRow[] | null>(null);

  React.useEffect(() => {
    let live = true;
    const ops = createClient().schema("ops");
    Promise.all([
      ops
        .from("trips")
        .select("id, date, direction, carries_passengers, destination, vehicle, vehicle_id, driver_staff_id, status, departure_time, departed_at, arrived_at, odometer_start, odometer_end, trip_manifest(boarded_at), trip_passengers(patient_id)")
        .gte("date", period.from)
        .lte("date", period.to)
        .order("date"),
      ops
        .from("vehicle_expenses")
        .select("id, expense_date, vehicle_id, kind, amount, litres, odometer, vendor, paid_by, paid_by_staff_id, vehicle_expense_postings(cash_entry_id)")
        .gte("expense_date", period.from)
        .lte("expense_date", period.to)
        .is("voided_at", null)
        .order("expense_date"),
    ]).then(([t, e]) => {
      if (!live) return;
      setTrips(
        ((t.data ?? []) as Record<string, unknown>[]).map((r) => {
          const manifest = (r.trip_manifest as { boarded_at: string | null }[] | null) ?? [];
          const riders = (r.trip_passengers as { patient_id: string }[] | null) ?? [];
          return {
            id: r.id as string,
            date: r.date as string,
            direction: r.direction as string,
            carriesPassengers: Boolean(r.carries_passengers),
            destination: (r.destination as string | null) ?? null,
            vehicleId: (r.vehicle_id as string | null) ?? null,
            vehicle: r.vehicle as string,
            driverId: (r.driver_staff_id as string | null) ?? null,
            status: r.status as string,
            departureTime: (r.departure_time as string | null) ?? null,
            departedAt: (r.departed_at as string | null) ?? null,
            arrivedAt: (r.arrived_at as string | null) ?? null,
            odometerStart: r.odometer_start == null ? null : Number(r.odometer_start),
            odometerEnd: r.odometer_end == null ? null : Number(r.odometer_end),
            passengers: manifest.length ? manifest.filter((m) => m.boarded_at).length : riders.length,
          };
        }),
      );
      setExpenses(
        ((e.data ?? []) as Record<string, unknown>[]).map((r) => ({
          id: r.id as string,
          date: r.expense_date as string,
          vehicleId: r.vehicle_id as string,
          kind: r.kind as string,
          amount: Number(r.amount),
          litres: r.litres == null ? null : Number(r.litres),
          odometer: r.odometer == null ? null : Number(r.odometer),
          vendor: (r.vendor as string | null) ?? null,
          paidBy: r.paid_by as "laf" | "driver",
          paidByStaffId: (r.paid_by_staff_id as string | null) ?? null,
          posted: ((r.vehicle_expense_postings as unknown[] | null) ?? []).length > 0,
        })),
      );
    });
    return () => {
      live = false;
    };
  }, [period.from, period.to]);

  const vehicleName = (id: string | null, fallback = "") => vehicles.find((v) => v.id === id)?.name ?? fallback;
  const staffName = (id: string | null) => {
    const s = staff.find((x) => x.id === id);
    return s ? `${s.firstName} ${s.lastName}` : "";
  };
  const shownTrips = (trips ?? []).filter((t) => vehicleId === "all" || t.vehicleId === vehicleId);
  const shownExpenses = (expenses ?? []).filter((e) => vehicleId === "all" || e.vehicleId === vehicleId);
  const km = (t: TripRow) => (t.odometerStart != null && t.odometerEnd != null ? t.odometerEnd - t.odometerStart : null);
  const totalKm = shownTrips.reduce((n, t) => n + (km(t) ?? 0), 0);
  const fuelLitres = shownExpenses.filter((e) => e.litres != null).reduce((n, e) => n + (e.litres ?? 0), 0);
  const totalCost = shownExpenses.reduce((n, e) => n + e.amount, 0);
  const driverPaid = shownExpenses.filter((e) => e.paidBy === "driver").reduce((n, e) => n + e.amount, 0);

  // Day keys stepped in UTC: a local midnight turned into ISO slipped a day back in Manila (UTC+8),
  // so the arrows could stay on the same period. Same stepping as Fuel Monitoring.
  const step = (dir: -1 | 1) => setAnchor(shiftPeriod(kind, anchor, dir));

  function exportTrips() {
    downloadCsv(
      csvLines(
        ["Date", "Type", "Destination", "Vehicle", "Driver", "Status", "Leaves", "Departed", "Arrived", "Odometer start", "Odometer end", "Km", "Passengers"],
        shownTrips.map((t) => [
          t.date,
          directionLabel(t.direction, t.carriesPassengers),
          t.destination ?? "",
          vehicleName(t.vehicleId, t.vehicle),
          staffName(t.driverId),
          t.status,
          t.departureTime ? formatTime12(t.departureTime) : "",
          t.departedAt ? formatDate(t.departedAt, "yyyy-MM-dd h:mm a") : "",
          t.arrivedAt ? formatDate(t.arrivedAt, "yyyy-MM-dd h:mm a") : "",
          t.odometerStart?.toString() ?? "",
          t.odometerEnd?.toString() ?? "",
          km(t)?.toString() ?? "",
          String(t.passengers),
        ]),
      ),
      `trips-${period.from}-to-${period.to}.csv`,
    );
  }
  function exportExpenses() {
    downloadCsv(
      csvLines(
        ["Date", "Vehicle", "Type", "Litres", "Amount", "Odometer", "Station / vendor", "Paid by", "Posted to Finance"],
        shownExpenses.map((e) => [
          e.date,
          vehicleName(e.vehicleId),
          kindName(e.kind),
          e.litres?.toString() ?? "",
          e.amount.toFixed(2),
          e.odometer?.toString() ?? "",
          e.vendor ?? "",
          e.paidBy === "driver" ? `Driver${e.paidByStaffId ? ` (${staffName(e.paidByStaffId)})` : ""}` : "LAF",
          e.posted ? "yes" : "no",
        ]),
      ),
      `fuel-expenses-${period.from}-to-${period.to}.csv`,
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Transport & Fuel Report" description={`${period.label}: trips, kilometres, fuel and expenses, with CSV downloads.`} action={<ModuleSubNav items={TRANSPORT_SUB_NAV} />} />
      <div className="flex flex-wrap items-center gap-2">
        <Select value={kind} onValueChange={(v) => setKind(v as PeriodKind)}>
          <SelectTrigger className="w-32" aria-label="Period"><SelectValue /></SelectTrigger>
          <SelectContent>{PERIODS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
        </Select>
        <Button size="sm" variant="outline" aria-label="Earlier" onClick={() => step(-1)}><ChevronLeft /></Button>
        <span className="text-theme-sm">{period.label}</span>
        <Button size="sm" variant="outline" aria-label="Later" disabled={period.to >= todayIso()} onClick={() => step(1)}><ChevronRight /></Button>
        <Select value={vehicleId} onValueChange={setVehicleId}>
          <SelectTrigger className="w-48" aria-label="Vehicle"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All vehicles</SelectItem>
            {vehicles.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <KpiGrid>
        <KpiCard label="Trips" value={shownTrips.length} />
        <KpiCard label="Kilometres" value={totalKm.toLocaleString("en-PH")} />
        <KpiCard label="Fuel bought" value={`${fuelLitres.toLocaleString("en-PH", { maximumFractionDigits: 1 })} L`} />
        <KpiCard label="Total cost" value={formatCurrency(totalCost)} />
      </KpiGrid>

      <SectionCard
        title={`Trips (${shownTrips.length})`}
        actions={<Button size="sm" variant="outline" disabled={!shownTrips.length} onClick={exportTrips}><Download /> CSV</Button>}
        flush
        bodyClassName="overflow-x-auto"
      >
        {trips === null ? <p className="px-5 py-3 text-theme-xs text-muted-foreground">Loading…</p> : shownTrips.length === 0 ? <p className="px-5 py-3 text-theme-xs text-muted-foreground">No trips in this period.</p> : (
          <table className="w-full text-theme-sm">
            <thead className="text-theme-xs text-muted-foreground">
              <tr>
                <th className="px-5 py-2 text-left font-medium">Date</th>
                <th className="px-2 py-2 text-left font-medium">Type</th>
                <th className="px-2 py-2 text-left font-medium">Vehicle</th>
                <th className="px-2 py-2 text-left font-medium">Driver</th>
                <th className="px-2 py-2 text-right font-medium">Passengers</th>
                <th className="px-2 py-2 text-right font-medium">Km</th>
                <th className="px-2 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shownTrips.map((t) => (
                <tr key={t.id}>
                  <td className="px-5 py-2 whitespace-nowrap">{formatDate(t.date, "MMM d")}</td>
                  <td className="px-2 py-2">{directionLabel(t.direction, t.carriesPassengers)}{t.destination ? ` · ${t.destination}` : ""}</td>
                  <td className="px-2 py-2">{vehicleName(t.vehicleId, t.vehicle)}</td>
                  <td className="px-2 py-2">{staffName(t.driverId) || "—"}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{t.passengers}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{km(t) ?? "—"}</td>
                  <td className="px-2 py-2 capitalize">{t.status.replace("_", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>

      <SectionCard
        title={`Fuel & expenses (${shownExpenses.length})${driverPaid ? ` · ${formatCurrency(driverPaid)} paid by drivers` : ""}`}
        actions={<Button size="sm" variant="outline" disabled={!shownExpenses.length} onClick={exportExpenses}><Download /> CSV</Button>}
        flush
        bodyClassName="overflow-x-auto"
      >
        {expenses === null ? <p className="px-5 py-3 text-theme-xs text-muted-foreground">Loading…</p> : shownExpenses.length === 0 ? <p className="px-5 py-3 text-theme-xs text-muted-foreground">Nothing logged in this period.</p> : (
          <table className="w-full text-theme-sm">
            <thead className="text-theme-xs text-muted-foreground">
              <tr>
                <th className="px-5 py-2 text-left font-medium">Date</th>
                <th className="px-2 py-2 text-left font-medium">Vehicle</th>
                <th className="px-2 py-2 text-left font-medium">Type</th>
                <th className="px-2 py-2 text-right font-medium">Litres</th>
                <th className="px-2 py-2 text-right font-medium">Amount</th>
                <th className="px-2 py-2 text-left font-medium">Paid by</th>
                <th className="px-2 py-2 text-left font-medium">Finance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shownExpenses.map((e) => (
                <tr key={e.id}>
                  <td className="px-5 py-2 whitespace-nowrap">{formatDate(e.date, "MMM d")}</td>
                  <td className="px-2 py-2">{vehicleName(e.vehicleId)}</td>
                  <td className="px-2 py-2">{kindName(e.kind)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{e.litres ?? "—"}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatCurrency(e.amount)}</td>
                  <td className="px-2 py-2">{e.paidBy === "driver" ? `Driver ${staffName(e.paidByStaffId)}`.trim() : "LAF"}</td>
                  <td className="px-2 py-2">{e.posted ? "posted" : "to post"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>
    </div>
  );
}
