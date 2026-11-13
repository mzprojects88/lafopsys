"use client";

import * as React from "react";
import Link from "next/link";
import {
  BedDouble,
  Bus,
  Fuel,
  HandCoins,
  HandHeart,
  Home,
  Inbox,
  PackageX,
  PiggyBank,
  Receipt,
  ShieldCheck,
  ShoppingBasket,
  Sigma,
  Target,
  Stethoscope,
  UserCheck,
  Users,
  UtensilsCrossed,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { KpiCard, type StatTone } from "@/components/patterns/kpi-card";
import { createClient } from "@/lib/supabase/client";
import { useCollection } from "@/lib/data/collection-store";
import type { DashboardFigures } from "@/lib/hooks/use-dashboard";
import { fundStatusStore, voucherQueueStore } from "@/lib/hooks/use-vouchers";
import { useCorrectionRequests } from "@/lib/hooks/use-correction-requests";
import { useLeaveRequests } from "@/lib/hooks/use-leave-collections";
import { useComplianceFilings, useComplianceItems } from "@/lib/hooks/use-compliance-collections";
import { useHolidays } from "@/lib/hooks/use-hr-reference-collections";
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import { useVehicleExpenses } from "@/lib/hooks/use-vehicle-expenses-collection";
import { useDtrSessions } from "@/lib/hooks/use-dtr-sessions";
import { useGoalActuals } from "@/lib/hooks/use-goal-actuals";
import { useRole } from "@/lib/rbac/use-role";
import { complianceCalendar } from "@/lib/utils/compliance";
import { formatCurrency } from "@/lib/utils/currency";
import { todayIso } from "@/lib/utils/date";
import type { CardKey } from "@/lib/utils/dashboard-catalog";
import type { DayWindow } from "@/lib/utils/period";

/** What the page already has for the cards that show the house and the stock right now. */
export interface NowContext {
  inHouseNow: number;
  occupiedPct: number;
  capacity: number;
  /** Of the capacity, the temporary mattresses (0092). */
  temporaryBeds: number;
  expiringSoon: number;
  lowStock: number;
}

const n = (v: number | undefined) => Math.round(v ?? 0).toLocaleString("en-PH");
const sum = (f: DashboardFigures | null, ...lines: string[]) => lines.reduce((t, l) => t + Number(f?.lines[l] ?? 0), 0);

function Card({ href, label, value, sublabel, icon, tone }: { href?: string; label: string; value: string | number; sublabel?: string; icon: LucideIcon; tone?: StatTone }) {
  const card = <KpiCard label={label} value={value} sublabel={sublabel} icon={icon} tone={tone} className="h-full" />;
  return href ? <Link href={href} className="block rounded-2xl transition-opacity hover:opacity-85">{card}</Link> : card;
}

/**
 * One dashboard card (0147). The period cards read the figures the page fetched once; the cards about right now
 * (waiting on me, funds, compliance, fuel, staff in) load their own data, so it is fetched only when switched on.
 */
export function DashboardCard({ k, f, period, window, now }: { k: CardKey; f: DashboardFigures | null; period: string; window: DayWindow; now: NowContext }) {
  const dash = f ? undefined : "…";
  switch (k) {
    case "housing":
      return <HousingCard value={dash ?? n(sum(f, "housing"))} period={period} window={window} />;
    case "rides":
      return <Card href="/transport/report" label="Transportation" value={dash ?? n(sum(f, "transport_to_nch", "transport_to_laf"))} sublabel={`Patient and caregiver rides · to NCH ${n(sum(f, "transport_to_nch"))} · to LAF ${n(sum(f, "transport_to_laf"))}`} icon={Bus} />;
    case "meals":
      return <Card href="/house-ops/meals" label="Meals served" value={dash ?? n(sum(f, "meals_breakfast", "meals_lunch", "meals_dinner"))} sublabel={`Breakfast ${n(sum(f, "meals_breakfast"))} · Lunch ${n(sum(f, "meals_lunch"))} · Dinner ${n(sum(f, "meals_dinner"))}`} icon={UtensilsCrossed} />;
    case "child_visits":
      return <Card href="/house-ops/activity-center" label="Child visits supported" value={dash ?? n(sum(f, "center_nch_participants"))} sublabel="LAF Activity Center @ NCH" icon={Stethoscope} />;
    case "care_cart":
      return <Card href="/house-ops/care-cart" label="Care Cart meals served" value={dash ?? n(sum(f, "care_cart_1000", "care_cart_1200", "care_cart_1700"))} sublabel="Served at NCH" icon={ShoppingBasket} />;
    case "patients":
      return <Card href="/patients" label="Unique patients admitted" value={dash ?? n(f?.unique_patients)} sublabel={`Children who stayed · ${n(f?.enrolled)} enrolled in all`} icon={UserCheck} />;
    case "cash":
      return f?.cash ? <Card href="/donors/cash" label="Cash donations" value={formatCurrency(f.cash.amount)} sublabel={`${n(f.cash.gifts)} gift${f.cash.gifts === 1 ? "" : "s"} · ${period}`} icon={Wallet} /> : null;
    case "gifts":
      return f?.gifts ? <Card href="/donors/totals" label="Gifts in kind" value={formatCurrency(f.gifts.food + f.gifts.non_food)} sublabel={`Food ${formatCurrency(f.gifts.food)} · Non-food ${formatCurrency(f.gifts.non_food)}`} icon={HandCoins} /> : null;
    case "expenses":
      return f?.expenses ? <Card href="/finance/ledger" label="Expenses" value={formatCurrency(f.expenses.amount)} sublabel={`${n(f.expenses.vouchers)} paid voucher${f.expenses.vouchers === 1 ? "" : "s"} · ${period}`} icon={Receipt} /> : null;
    case "budget": {
      if (!f?.budget) return null;
      const b = f.budget;
      return (
        <Card
          href="/finance/budgets"
          label={`Budget used · ${b.year}`}
          value={b.approved > 0 ? `${Math.round((b.spent / b.approved) * 100)}%` : "—"}
          sublabel={b.approved > 0 ? `${formatCurrency(b.spent)} of ${formatCurrency(b.approved)}` : `No approved ${b.year} budget yet`}
          icon={PiggyBank}
          tone={b.approved > 0 && b.spent > b.approved ? "warning" : "default"}
        />
      );
    }
    case "in_house":
      return <Card href="/patients/floor-plan" label="In the house now" value={now.inHouseNow} sublabel={`${now.occupiedPct}% of ${now.capacity || "—"} slots · now`} icon={Home} />;
    case "since_2024":
      return <Card href="/reports/programs" label="Since 2024" value={dash ?? n(f?.since_2024)} sublabel={(f?.prior_years ?? 0) < 2 ? "Without 2024–2025: enter them in Programs › Prior years" : "Total program output, 2024 to date"} icon={Sigma} />;
    case "volunteers":
      return <Card href="/staff/volunteers" label="Volunteers" value={dash ?? n(sum(f, "care_cart_volunteers", "center_nch_volunteers", "center_laf_volunteers"))} sublabel={`Care Cart ${n(sum(f, "care_cart_volunteers"))} · Activity Center ${n(sum(f, "center_nch_volunteers", "center_laf_volunteers"))}`} icon={HandHeart} />;
    case "stock":
      return <Card href="/inventory/expiry" label="Stock alerts" value={now.expiringSoon + now.lowStock} sublabel={`${now.expiringSoon} expiring ≤14 days · ${now.lowStock} low · now`} icon={PackageX} tone={now.expiringSoon + now.lowStock > 0 ? "warning" : "default"} />;
    case "caf_nights":
      return <Card href="/reports/caf-billing" label="NCH (CAF) nights" value={dash ?? n(sum(f, "caf_nights"))} sublabel={`Children on the Cancer Assistance Fund · ${period}`} icon={BedDouble} />;
    case "waiting":
      return <WaitingCard />;
    case "funds":
      return <FundsCard />;
    case "compliance":
      return <ComplianceCard />;
    case "transport_costs":
      return <FuelCard window={window} period={period} />;
    case "staff_in":
      return <StaffInCard />;
    case "goals":
      return <GoalsCard />;
    case "beds":
      return (
        <Card
          href="/patients/floor-plan"
          label="Beds"
          value={now.capacity}
          sublabel={`${now.capacity - now.temporaryBeds} regular · ${now.temporaryBeds} temporary · ${now.inHouseNow} in use, ${Math.max(0, now.capacity - now.inHouseNow)} free · now`}
          icon={BedDouble}
        />
      );
  }
}

/** Housing, saying how many of its nights the House Sheet filled: past nights nobody finalized in the app that the
 * Programs sheet doesn't have either (0148). */
function HousingCard({ value, period, window }: { value: string; period: string; window: DayWindow }) {
  const [filled, setFilled] = React.useState<{ key: string; n: number } | null>(null);
  const key = `${window.from}|${window.to}`;
  React.useEffect(() => {
    let live = true;
    void createClient().schema("ops").rpc("unfinalized_nights", { p_from: window.from, p_to: window.to })
      .then(({ data }) => live && setFilled({ key, n: ((data ?? []) as { filled: boolean }[]).filter((r) => r.filled).length }));
    return () => {
      live = false;
    };
  }, [window.from, window.to, key]);
  const gaps = filled?.key === key ? filled.n : 0;
  return (
    <Card
      href="/patients/bed-nights"
      label="Housing"
      value={value}
      sublabel={gaps ? `Bed nights provided · ${period} · ${gaps} night${gaps === 1 ? "" : "s"} from the House Sheet (not finalized)` : `Bed nights provided · ${period}`}
      icon={BedDouble}
      tone={gaps ? "warning" : "default"}
    />
  );
}

function WaitingCard() {
  const { staffId: me } = useRole();
  const { data: queue } = useCollection(voucherQueueStore);
  const { requests } = useCorrectionRequests();
  const { requests: leave } = useLeaveRequests();
  const sign = queue.filter((q) => q.step !== "returned").length;
  const punches = requests.filter((r) => r.status === "pending" && r.staffId !== me).length;
  const leaves = leave.filter((l) => l.status === "pending" && l.employeeId !== me).length;
  const total = sign + punches + leaves;
  return <Card href="/requests" label="Waiting on me" value={total} sublabel={`${sign} to sign · ${leaves} leave · ${punches} missed punches · now`} icon={Inbox} tone={total > 0 ? "warning" : "default"} />;
}

function FundsCard() {
  const { data: funds } = useCollection(fundStatusStore);
  const low = funds.filter((x) => x.low).length;
  return <Card href="/finance/funds" label="Funds" value={formatCurrency(funds.reduce((t, x) => t + x.cashOnHand, 0))} sublabel={`Cash on hand · ${low} of ${funds.length} below the top-up point · now`} icon={Wallet} tone={low > 0 ? "warning" : "default"} />;
}

function ComplianceCard() {
  const { items } = useComplianceItems();
  const { filings } = useComplianceFilings();
  const { holidays } = useHolidays();
  const s = useAppSettings();
  const today = todayIso();
  const year = Number(today.slice(0, 4));
  const all = complianceCalendar(items, filings, { from: `${year - 1}-01-01`, to: `${year + 1}-12-31` }, {
    penLastDigit: s.compliancePenLastDigit,
    employerInitial: s.complianceEmployerInitial,
    trackingFrom: s.complianceTrackingFrom,
    leadDays: s.complianceLeadDays,
    holidays: holidays.map((h) => ({ date: h.date, kind: h.kind })),
  }, today);
  const soon = all.filter((e) => e.status === "due_soon" || e.status === "in_progress").length;
  const late = all.filter((e) => e.status === "overdue" || e.status === "behind").length;
  return <Card href="/compliance" label="Compliance" value={soon + late} sublabel={`${soon} due soon · ${late} overdue or behind · now`} icon={ShieldCheck} tone={late > 0 ? "warning" : "default"} />;
}

function FuelCard({ window, period }: { window: DayWindow; period: string }) {
  const { expenses } = useVehicleExpenses();
  const fuel = expenses.filter((e) => !e.voidedAt && e.kind === "fuel" && e.date >= window.from && e.date <= window.to);
  const litres = fuel.reduce((t, e) => t + (e.litres ?? 0), 0);
  return <Card href="/transport/fuel" label="Fuel spent" value={formatCurrency(fuel.reduce((t, e) => t + e.amount, 0))} sublabel={`${litres.toLocaleString("en-PH", { maximumFractionDigits: 1 })} litres · ${period}`} icon={Fuel} />;
}

/** The share of a year already gone (0 to 1). */
function yearGone(year: number): number {
  const start = Date.parse(`${year}-01-01`);
  return Math.min(1, Math.max(0, (Date.now() - start) / (Date.parse(`${year + 1}-01-01`) - start)));
}

/** Each active goal's progress this year (counted as Executive › Goals counts it): how many are on pace for the
 * share of the year gone, and the one furthest behind. Goals are read by the CEO, the Trustees and the Super Admin. */
function GoalsCard() {
  const { goals, actual, target, loading } = useGoalActuals();
  const year = Number(todayIso().slice(0, 4));
  const gone = yearGone(year);
  const rows = goals
    .filter((g) => g.status === "active" && g.measure !== "none")
    .map((g) => ({ g, t: target(g, year), a: actual(g, year) }))
    .filter((r): r is { g: typeof r.g; t: number; a: number } => r.t != null && r.t > 0 && r.a != null)
    .map((r) => ({ ...r, pct: Math.round((r.a / r.t) * 100) }));
  const onPace = rows.filter((r) => r.pct >= gone * 100 - 5).length;
  const behind = [...rows].sort((x, y) => x.pct - y.pct)[0];
  if (loading) return <Card href="/executive/goals" label={`Goals ${year}`} value="…" icon={Target} />;
  return (
    <Card
      href="/executive/goals"
      label={`Goals ${year}`}
      value={rows.length ? `${onPace} of ${rows.length} on pace` : "—"}
      sublabel={rows.length ? `${Math.round(gone * 100)}% of the year gone${behind ? ` · furthest behind: ${behind.g.title} ${behind.pct}%` : ""}` : "No goal with a target this year (Executive › Goals)"}
      icon={Target}
      tone={rows.length && onPace < rows.length ? "warning" : "default"}
    />
  );
}

function StaffInCard() {
  const { totals } = useDtrSessions();
  return <Card href="/staff/punches" label="Staff clocked in" value={totals.openCount} sublabel="Right now" icon={Users} />;
}

