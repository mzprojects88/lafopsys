"use client";

import * as React from "react";
import Link from "next/link";
import {
  Send,
  CheckCircle2,
  AlertTriangle,
  Clock,
  UserPlus,
  HandCoins,
  FileSignature,
  BadgeCheck,
  BarChart3,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, Line, LineChart, XAxis } from "recharts";
import { KpiGrid, type StatTone } from "@/components/patterns/kpi-card";
import { IconCircle } from "@/components/patterns/icon-circle";
import { SectionCard } from "@/components/patterns/section-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { useRole } from "@/lib/rbac/use-role";
import { useReferralsData } from "@/lib/hooks/use-referrals-collection";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";
import { useCensusData } from "@/lib/hooks/use-census-collection";
import { useHouseLayout } from "@/lib/hooks/use-house-layout-collection";
import { houseCapacity, isActiveStay } from "@/lib/utils/beds";
import { useDonorsData } from "@/lib/hooks/use-donors-collection";
import { useCashEntriesData } from "@/lib/hooks/use-cash-entries-collection";
import { useLeaveRequests } from "@/lib/hooks/use-leave-collections";
import { useExpiringLots, useStockSummary } from "@/lib/hooks/use-inventory-views";
import { isHiddenPath } from "@/lib/rbac/hidden";
import { moduleForPath } from "@/lib/rbac/roles";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import { inventoryAppHref } from "@/lib/utils/inventory-app";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/date";
import { STATUS_TONE_CLASSES } from "@/lib/utils/status-colors";
import { ROLES, type Role } from "@/lib/types/common";
import { hasAnyRole } from "@/lib/rbac/roles";
import { LoadingState } from "@/components/patterns/loading-state";
import { PeriodPresetsBar, usePeriodPresets } from "@/components/patterns/period-presets";
import { FilterSelect, useFilters } from "@/components/patterns/filters";
import { useCollection } from "@/lib/data/collection-store";
import { dashboardProfilesStore, myDashboardStore, useDashboardFigures } from "@/lib/hooks/use-dashboard";
import { DashboardCard } from "@/components/modules/dashboard/dashboard-cards";
import { CustomizeSheet } from "@/components/modules/dashboard/customize-sheet";
import { ACTIONS, CARDS, resolveLayout, type ActionKey } from "@/lib/utils/dashboard-catalog";
import type { PresetKey } from "@/lib/utils/period-presets";
import {
  BedDouble, Bus, CalendarCheck, ClipboardCheck, Fingerprint, Fuel, Gift, HandHeart, Landmark, LayoutGrid, ListChecks, Map as MapIcon, NotebookPen, ShoppingBasket, Stethoscope, Wallet as WalletIcon,
} from "lucide-react";

/** The quick actions' icons (0147). */
const ACTION_ICONS: Record<ActionKey, LucideIcon> = {
  admit: Send, house_today: BedDouble, floor_plan: MapIcon, new_request: FileSignature, requests: ClipboardCheck, ledger: Landmark, funds: WalletIcon,
  receive_donation: HandCoins, cash_gift: Gift, donors: HandHeart, new_trip: Bus, log_fuel: Fuel, care_cart: ShoppingBasket, activity_center: Stethoscope,
  clock: Fingerprint, punches: ListChecks, dtr: Clock, leave: CalendarCheck, generate_report: BarChart3, programs_report: NotebookPen, compliance: CheckCircle2,
};
import { bucketOf, daysOf } from "@/lib/utils/period-presets";
import { naturalGrain } from "@/lib/utils/period";

export default function DashboardPage() {
  return (
    <React.Suspense fallback={<LoadingState />}>
      <DashboardContent />
    </React.Suspense>
  );
}

function DashboardContent() {
  const { role, roles, title, user } = useRole();
  // The person's own dashboard (0147): the cards their profile offers, in their order, their quick actions, and the
  // period it opens on (Year to date unless they chose another).
  const { data: profiles, loading: profilesLoading } = useCollection(dashboardProfilesStore);
  const { data: saved, loading: layoutLoading } = useCollection(myDashboardStore);
  const allowed = React.useMemo(() => {
    if (roles.includes("admin")) return new Set<string>(CARDS.map((c) => c.key));
    // The profile alone, as the database decides it (shared.dashboard_card_ok).
    return new Set(profiles.filter((p) => roles.includes(p.role as Role)).map((p) => p.card));
  }, [profiles, roles]);
  // Money anywhere on the page (the trend, the activity, approvals) only for a profile with a money card.
  const seesMoney = CARDS.some((c) => c.money && allowed.has(c.key));
  const { levelOfPath } = useModuleAccess();
  const mayUse = (a: (typeof ACTIONS)[number]) => {
    // Only actions the person may take; receiving happens in the inventory app, for its editors.
    if (a.inventory) return hasAnyRole(roles, "admin", "inventory_staff", "inventory_lead");
    const level = levelOfPath(a.href, moduleForPath(a.href) ?? undefined);
    return !isHiddenPath(a.href, role) && (a.edit ? level === "edit" : level !== "none");
  };
  const layout = resolveLayout(saved, allowed, roles, mayUse);
  const [customizing, setCustomizing] = React.useState(false);
  const period = usePeriodPresets("dashboard", layout.period as PresetKey, false, false);
  const w = period.window!;
  // Only once the person's period and profile are known, so the figures are fetched once, for the right period.
  const settled = !layoutLoading && !profilesLoading;
  const { figures, error: figuresError } = useDashboardFigures(w, settled);
  const inPeriod = (date: string | undefined | null) => !!date && date.slice(0, 10) >= w.from && date.slice(0, 10) <= w.to;
  const roleLabel = ROLES.find((r) => r.value === title)?.label ?? title;
  const { referrals } = useReferralsData();
  const { patients, stays } = usePatientsData();
  const { history: censusHistory } = useCensusData();
  const { units } = useHouseLayout();
  const { donations, donors } = useDonorsData();
  const { entries: cashEntries } = useCashEntriesData();
  // Pending leave: every request for HR/admins, the person's own for anyone else (RLS).
  const { requests: leaveRequests } = useLeaveRequests();
  const { rows: stockSummary } = useStockSummary();
  const { rows: expiringLots } = useExpiringLots();

  const today = censusHistory[censusHistory.length - 1];
  // Families checked in now (the stays), not the House Sheet's row count the census held.
  const inHouseNow = stays.filter(isActiveStay).length || (today?.inHouse ?? 0);
  const expiringSoon = expiringLots.filter((l) => l.days_left >= 0 && l.days_left <= 14).length;

  // The beds drawn on the floor plan (0047), one admission slot each by default.
  const capacity = houseCapacity(units);
  const temporaryBeds = units.filter((u) => u.active && u.temporary).length;
  const occupiedPct = capacity > 0 ? Math.round((inHouseNow / capacity) * 100) : 0;
  const availableSlots = Math.max(0, capacity - inHouseNow);

  // v_stock_summary is per item per House; count distinct items at their worst status.
  const stockByItem = new Map<string, "ok" | "low" | "out">();
  for (const r of stockSummary) {
    const cur = stockByItem.get(r.item_id);
    if (!cur || r.status === "out" || (r.status === "low" && cur === "ok")) stockByItem.set(r.item_id, r.status);
  }
  const goodStock = [...stockByItem.values()].filter((s) => s === "ok").length;
  const lowStock = [...stockByItem.values()].filter((s) => s === "low").length;

  // Both charts follow the period: one point a day up to five weeks, a week up to a year, a month beyond.
  const grain = naturalGrain(w);
  const days = daysOf(w);
  const buckets = [...new Set(days.map((d) => bucketOf(d, grain)))];
  const giftsByBucket = new Map<string, number>();
  for (const d of donations) if (inPeriod(d.date)) giftsByBucket.set(bucketOf(d.date, grain), (giftsByBucket.get(bucketOf(d.date, grain)) ?? 0) + d.totalValue);
  const donationChart = buckets.map((b) => ({ date: b, amount: giftsByBucket.get(b) ?? 0 }));

  // The newest five in the period: gifts, check-ins, approved referrals (or one of them).
  const shows = useFilters("kind");
  const recentActivity = [
    ...donations.filter((d) => seesMoney && inPeriod(d.date)).map((d) => ({
      kind: "gift",
      icon: HandCoins,
      title: `Donation of ${formatCurrency(d.totalValue, d.currency)} received`,
      subtitle: donors.find((dn) => dn.id === d.donorId)?.name ?? "Anonymous",
      date: d.date,
    })),
    ...stays.filter((s) => inPeriod(s.checkInAt)).map((s) => ({
      kind: "stay",
      icon: UserPlus,
      title: "Patient stay recorded",
      subtitle: patients.find((p) => p.id === s.patientId)?.firstName ?? "—",
      date: s.checkInAt,
    })),
    ...referrals.filter((r) => r.status === "approved" && inPeriod(r.date)).map((r) => ({
      kind: "referral",
      icon: BadgeCheck,
      title: "Referral approved",
      subtitle: r.patientName,
      date: r.date,
    })),
  ]
    .filter((a) => shows.ok("kind", a.kind))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5);

  const urgentApprovals = [
    ...leaveRequests
      .filter((a) => a.status === "pending")
      .slice(0, 2)
      .map((a) => ({ title: "Leave request", subtitle: `${a.startsOn}${a.endsOn !== a.startsOn ? ` – ${a.endsOn}` : ""} · ${a.days} day(s)`, priority: "Medium" as const })),
    ...cashEntries
      .filter((e) => seesMoney && e.approvalStatus === "pending")
      .slice(0, 2)
      .map((e) => ({
        title: e.direction === "outflow" ? "Cash Disbursement" : "Cash Deposit",
        subtitle: formatCurrency(e.amount, e.currency),
        priority: e.amount > 20000 ? ("High" as const) : ("Medium" as const),
      })),
  ].slice(0, 4);

  const quickActions = layout.actions.map((k) => {
    const a = ACTIONS.find((x) => x.key === k)!;
    return { label: a.label, href: a.inventory ? inventoryAppHref(a.href) : a.href, icon: ACTION_ICONS[k] };
  });

  const chartConfig: ChartConfig = { amount: { label: "Donations", color: "var(--chart-1)" } };

  // Enrolled = admitted by the end of each point; admissions = admitted within it.
  const lastDayOf = new Map<string, string>();
  for (const d of days) lastDayOf.set(bucketOf(d, grain), d);
  const admissionsTrend = buckets.map((b) => ({
    date: b,
    enrolled: patients.filter((p) => p.admittedAt && p.admittedAt.slice(0, 10) <= (lastDayOf.get(b) ?? b)).length,
    admissions: patients.filter((p) => inPeriod(p.admittedAt) && bucketOf(p.admittedAt.slice(0, 10), grain) === b).length,
  }));
  const admissionsChartConfig: ChartConfig = {
    enrolled: { label: "Enrolled", color: "var(--chart-1)" },
    admissions: { label: "Admissions", color: "var(--chart-2)" },
  };

  return (
    <div className="flex flex-1 flex-col gap-5 lg:gap-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="flex flex-col gap-0.5">
        <p className="text-theme-sm text-muted-foreground">Welcome back,</p>
        <h1 className="text-xl font-semibold text-foreground lg:text-2xl">
          {user || roleLabel}
          {user ? <span className="font-normal text-muted-foreground"> · {roleLabel}</span> : null}
        </h1>
      </div>
        <Button variant="outline" size="sm" onClick={() => setCustomizing(true)}><LayoutGrid className="size-4" /> Customize</Button>
      </div>
      {customizing ? (
        <CustomizeSheet
          open
          onOpenChange={setCustomizing}
          allowed={allowed}
          usable={ACTIONS.filter(mayUse).map((a) => a.key)}
          current={layout}
        />
      ) : null}

      <PeriodPresetsBar state={period.state} onChange={period.setState} today={period.today} years />

      <KpiGrid>
        {layout.cards.map((k) => (
          <DashboardCard
            key={k}
            k={k}
            f={figures}
            period={period.state.key === "this_year" ? `Year to date ${w.from.slice(0, 4)}` : period.label}
            window={w}
            now={{ inHouseNow, occupiedPct, capacity, expiringSoon, lowStock }}
          />
        ))}
      </KpiGrid>
      {figuresError ? <p className="text-theme-sm text-destructive">The figures could not load: {figuresError}</p> : null}
      {settled && layout.cards.length === 0 ? <p className="text-theme-sm text-muted-foreground">No cards chosen: press Customize to add some.</p> : null}

      <div className="flex flex-col gap-2">
        <h2 className="text-theme-sm font-semibold text-foreground">Quick Actions</h2>
        {quickActions.length === 0 ? <p className="text-theme-xs text-muted-foreground">None chosen: press Customize to add shortcuts.</p> : null}
        <div className="grid grid-cols-4 gap-2 lg:hidden">
          {quickActions.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className="flex flex-col items-center gap-1.5 rounded-2xl border border-border bg-card px-2 py-3 text-center transition-colors hover:bg-muted/60"
            >
              <IconCircle icon={action.icon} size="md" />
              <span className="text-[11px] leading-tight font-medium text-foreground">{action.label}</span>
            </Link>
          ))}
        </div>
        <div className="hidden flex-wrap gap-2 lg:flex">
          {quickActions.map((action) => (
            <Button key={action.href} variant="outline" asChild>
              <Link href={action.href}>
                <action.icon className="size-4" strokeWidth={1.75} />
                {action.label}
              </Link>
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3 lg:gap-6">
        <div className="flex min-w-0 flex-col gap-5 lg:col-span-2 lg:gap-6">
          {seesMoney && !isHiddenPath("/donors", role) && (
            <SectionCard title="Donations Trend" description={period.label}>
              <div className="mb-3 flex items-center gap-1.5 text-theme-xs text-muted-foreground">
                <span className="size-2 rounded-full bg-chart-1" />
                All gifts, cash and in kind (₱)
              </div>
              <ChartContainer config={chartConfig} className="h-56 w-full">
                <AreaChart data={donationChart}>
                  <defs>
                    <linearGradient id="donationFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-amount)" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="var(--color-amount)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5)} fontSize={11} tickLine={false} axisLine={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area type="monotone" dataKey="amount" stroke="var(--color-amount)" fill="url(#donationFill)" strokeWidth={2} />
                </AreaChart>
              </ChartContainer>
            </SectionCard>
          )}

          <SectionCard title="Patients & Admissions Trend" description={period.label}>
            <div className="mb-3 flex items-center gap-3 text-theme-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-chart-1" />
                Enrolled
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-chart-2" />
                Admissions
              </span>
            </div>
            <ChartContainer config={admissionsChartConfig} className="h-56 w-full">
              <LineChart data={admissionsTrend}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5)} fontSize={11} tickLine={false} axisLine={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line type="monotone" dataKey="enrolled" stroke="var(--color-enrolled)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="admissions" stroke="var(--color-admissions)" strokeWidth={2} dot={false} />
              </LineChart>
            </ChartContainer>
          </SectionCard>

          <SectionCard
            title="Recent Activity"
            description={period.label}
            flush
            actions={<FilterSelect all="Everything" value={shows.values.kind} onChange={shows.set("kind")} options={[{ value: "gift", label: "Gifts" }, { value: "stay", label: "Check-ins" }, { value: "referral", label: "Referrals" }]} className="w-32" />}
          >
            <ul className="divide-y divide-border">
              {recentActivity.length === 0 ? <li className="px-5 py-3 text-theme-xs text-muted-foreground">Nothing recorded in this period.</li> : null}
              {recentActivity.map((a, i) => (
                <li key={i} className="flex items-start gap-3 px-5 py-3">
                  <IconCircle icon={a.icon} size="sm" />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-theme-sm leading-tight font-medium text-foreground">{a.title}</span>
                    <span className="text-theme-xs text-muted-foreground">{a.subtitle}</span>
                  </div>
                  <span className="shrink-0 text-theme-xs text-muted-foreground">{formatDate(a.date, "MMM d")}</span>
                </li>
              ))}
            </ul>
            <div className="border-t border-border px-5 py-3">
              <Link href="/reports" className="flex w-fit items-center gap-1 text-theme-xs font-medium text-primary hover:underline">
                View all activity <ChevronRight className="size-3.5" />
              </Link>
            </div>
          </SectionCard>
        </div>

        <div className="flex min-w-0 flex-col gap-5 lg:gap-6">
          <SectionCard title="House Occupancy" flush>
            <div className="flex items-center gap-6 p-5">
              <OccupancyRing percent={occupiedPct} />
              <div className="flex flex-1 flex-col gap-2 text-theme-sm">
                <LegendRow color="bg-primary" label="In-House Now" value={inHouseNow} />
                <LegendRow color="bg-primary/30" label="Available Slots" value={availableSlots} />
                <LegendRow color="bg-muted-foreground/40" label={temporaryBeds ? `Total Capacity (${temporaryBeds} temporary)` : "Total Capacity"} value={capacity || "—"} />
              </div>
            </div>
            <div className="border-t border-border px-5 py-3">
              <Link href="/patients/floor-plan" className="flex w-fit items-center gap-1 text-theme-xs font-medium text-primary hover:underline">
                View floor plan <ChevronRight className="size-3.5" />
              </Link>
            </div>
          </SectionCard>

          <SectionCard title="Inventory Status" flush>
            <ul className="divide-y divide-border">
              <StatusRow icon={CheckCircle2} tone="positive" label="Good Stock" sublabel="Well-stocked items" value={goodStock} />
              <StatusRow icon={AlertTriangle} tone="warning" label="Low Stock" sublabel="Reorder soon" value={lowStock} />
              <StatusRow icon={Clock} tone="warning" label="Expiring ≤14d" sublabel="Needs attention" value={expiringSoon} />
            </ul>
            <div className="border-t border-border px-5 py-3">
              <Link href="/inventory" className="flex w-fit items-center gap-1 text-theme-xs font-medium text-primary hover:underline">
                View inventory <ChevronRight className="size-3.5" />
              </Link>
            </div>
          </SectionCard>

          {!isHiddenPath("/finance", role) && (
            <SectionCard title="Urgent Approvals" actions={<Badge className="rounded-full">{urgentApprovals.length}</Badge>} flush>
              <ul className="divide-y divide-border">
                {urgentApprovals.map((a, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 px-5 py-3">
                    <div className="flex min-w-0 flex-col">
                      <span className="text-theme-sm font-medium text-foreground">{a.title}</span>
                      <span className="text-theme-xs text-muted-foreground">{a.subtitle}</span>
                    </div>
                    <Badge className={STATUS_TONE_CLASSES[a.priority === "High" ? "negative" : "warning"]}>{a.priority}</Badge>
                  </li>
                ))}
              </ul>
              <div className="border-t border-border px-5 py-3">
                <Link href="/finance/approvals" className="flex w-fit items-center gap-1 text-theme-xs font-medium text-primary hover:underline">
                  View all approvals <ChevronRight className="size-3.5" />
                </Link>
              </div>
            </SectionCard>
          )}
        </div>
      </div>
    </div>
  );
}

function OccupancyRing({ percent }: { percent: number }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(100, percent) / 100) * circumference;

  return (
    <div className="relative flex size-28 shrink-0 items-center justify-center">
      <svg viewBox="0 0 100 100" className="size-28 -rotate-90">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="currentColor" strokeWidth="10" className="text-muted" />
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="text-primary transition-all"
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-xl font-bold tabular-nums text-foreground">{percent}%</span>
        <span className="text-theme-xs text-muted-foreground">Occupied</span>
      </div>
    </div>
  );
}

function LegendRow({ color, label, value }: { color: string; label: string; value: number | string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`size-2.5 shrink-0 rounded-full ${color}`} />
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  );
}

function StatusRow({
  icon,
  tone,
  label,
  sublabel,
  value,
}: {
  icon: LucideIcon;
  tone: StatTone;
  label: string;
  sublabel: string;
  value: number;
}) {
  return (
    <li className="flex items-center gap-3 px-5 py-3">
      <IconCircle icon={icon} tone={tone} size="sm" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-theme-sm font-medium text-foreground">{label}</span>
        <span className="text-theme-xs text-muted-foreground">{sublabel}</span>
      </div>
      <span className="text-lg font-semibold tabular-nums text-foreground">{value}</span>
    </li>
  );
}
