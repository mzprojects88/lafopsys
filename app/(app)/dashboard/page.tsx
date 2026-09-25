"use client";

import Link from "next/link";
import {
  Users,
  UserCheck,
  Wallet,
  ClipboardList,
  Send,
  PackageX,
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
import { KpiCard, KpiGrid, type StatTone } from "@/components/patterns/kpi-card";
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
import { houseCapacity } from "@/lib/utils/beds";
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
import { ROLES } from "@/lib/types/common";

export default function DashboardPage() {
  const { role, user } = useRole();
  const roleLabel = ROLES.find((r) => r.value === role)?.label ?? role;
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
  const inHouseNow = today?.inHouse ?? 0;
  const pendingApprovals = leaveRequests.filter((a) => a.status === "pending").length;
  const pendingReferrals = referrals.filter((r) => r.status === "submitted").length;
  const expiringSoon = expiringLots.filter((l) => l.days_left >= 0 && l.days_left <= 14).length;
  const cashIn = cashEntries.filter((e) => e.direction === "inflow").reduce((s, e) => s + e.amount, 0);

  // The beds drawn on the floor plan (0047), one admission slot each by default.
  const capacity = houseCapacity(units);
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

  const donationChart = donations
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .reduce<{ date: string; amount: number }[]>((acc, d) => {
      const existing = acc.find((row) => row.date === d.date);
      if (existing) existing.amount += d.totalValue;
      else acc.push({ date: d.date, amount: d.totalValue });
      return acc;
    }, [])
    .slice(-14);

  const recentActivity = [
    ...donations.slice(0, 2).map((d) => ({
      icon: HandCoins,
      title: `Donation of ${formatCurrency(d.totalValue, d.currency)} received`,
      subtitle: donors.find((dn) => dn.id === d.donorId)?.name ?? "Anonymous",
      date: d.date,
    })),
    ...stays.slice(0, 2).map((s) => ({
      icon: UserPlus,
      title: "Patient stay recorded",
      subtitle: patients.find((p) => p.id === s.patientId)?.firstName ?? "—",
      date: s.checkInAt,
    })),
    ...referrals.filter((r) => r.status === "approved").slice(0, 1).map((r) => ({
      icon: BadgeCheck,
      title: "Referral approved",
      subtitle: r.patientName,
      date: r.date,
    })),
  ]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5);

  const urgentApprovals = [
    ...leaveRequests
      .filter((a) => a.status === "pending")
      .slice(0, 2)
      .map((a) => ({ title: "Leave request", subtitle: `${a.startsOn}${a.endsOn !== a.startsOn ? ` – ${a.endsOn}` : ""} · ${a.days} day(s)`, priority: "Medium" as const })),
    ...cashEntries
      .filter((e) => e.approvalStatus === "pending")
      .slice(0, 2)
      .map((e) => ({
        title: e.direction === "outflow" ? "Cash Disbursement" : "Cash Deposit",
        subtitle: formatCurrency(e.amount, e.currency),
        priority: e.amount > 20000 ? ("High" as const) : ("Medium" as const),
      })),
  ].slice(0, 4);

  const { canEdit } = useModuleAccess();
  const quickActions = [
    { label: "Admit a child", href: "/patients/admit", icon: Send },
    // Donations and stock are both recorded in the LAF Inventory app (one
    // receipt, one entry); this app only shows what they became.
    { label: "Receive a donation", href: inventoryAppHref("/intake"), icon: HandCoins },
    { label: "New Cash Entry", href: "/finance/entry", icon: FileSignature },
    { label: "Request Approval", href: "/finance/approvals", icon: CheckCircle2 },
    { label: "Generate Report", href: "/reports/builder", icon: BarChart3 },
  ].filter((a) => {
    // Only actions the person may actually take; the inventory app decides its own.
    const m = moduleForPath(a.href);
    return !isHiddenPath(a.href) && (m === null || canEdit(m));
  });

  const chartConfig: ChartConfig = { amount: { label: "Donations", color: "var(--chart-1)" } };

  // The card is explicitly labeled "Last 30 days" -- real censusHistory can span
  // much further back than mock data ever did, so it's windowed here to match
  // what the label actually promises rather than dumping the full real history.
  const admissionsTrend = censusHistory.slice(-30).map((day) => ({
    date: day.date,
    enrolled: patients.filter((p) => p.admittedAt <= day.date).length,
    admissions: patients.filter((p) => p.admittedAt === day.date).length,
  }));
  const admissionsChartConfig: ChartConfig = {
    enrolled: { label: "Enrolled", color: "var(--chart-1)" },
    admissions: { label: "Admissions", color: "var(--chart-2)" },
  };

  return (
    <div className="flex flex-1 flex-col gap-5 lg:gap-6">
      <div className="flex flex-col gap-0.5">
        <p className="text-theme-sm text-muted-foreground">Welcome back,</p>
        <h1 className="text-xl font-semibold text-foreground lg:text-2xl">
          {user || roleLabel}
          {user ? <span className="font-normal text-muted-foreground"> · {roleLabel}</span> : null}
        </h1>
      </div>

      <KpiGrid>
        {(role === "admin" || role === "social_worker" || role === "house_staff" || role === "driver") && (
          <KpiCard label="In-House Now" value={inHouseNow} sublabel="Residents" icon={Users} />
        )}
        {(role === "admin" || role === "social_worker") && (
          <KpiCard label="Enrolled Patients" value={patients.length} sublabel="Total" icon={UserCheck} />
        )}
        {(role === "admin" || role === "finance" || role === "board") && !isHiddenPath("/donors") && (
          <KpiCard label="Cash Donations" value={formatCurrency(cashIn)} sublabel="This period" icon={Wallet} />
        )}
        {(role === "admin" || role === "finance") && !isHiddenPath("/finance") && (
          <KpiCard label="Pending Approvals" value={pendingApprovals} sublabel="Items" icon={ClipboardList} tone={pendingApprovals > 0 ? "warning" : "default"} />
        )}
        {(role === "admin" || role === "social_worker") && (
          <KpiCard label="Pending Referrals" value={pendingReferrals} sublabel="Referrals" icon={Send} tone={pendingReferrals > 0 ? "warning" : "default"} />
        )}
        {(role === "admin" || role === "house_staff") && (
          <KpiCard label="Items Expiring ≤14d" value={expiringSoon} sublabel="Items" icon={PackageX} tone={expiringSoon > 0 ? "warning" : "default"} />
        )}
        {role === "volunteer" && !isHiddenPath("/donors") && <KpiCard label="Donations Recorded" value={donations.length} icon={HandCoins} />}
      </KpiGrid>

      <div className="flex flex-col gap-2">
        <h2 className="text-theme-sm font-semibold text-foreground">Quick Actions</h2>
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
          {!isHiddenPath("/donors") && (
            <SectionCard title="Donations Trend (This Period)" description="Last 30 days">
              <div className="mb-3 flex items-center gap-1.5 text-theme-xs text-muted-foreground">
                <span className="size-2 rounded-full bg-chart-1" />
                Cash Donations (₱)
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

          <SectionCard title="Patients & Admissions Trend" description="Last 30 days">
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

          <SectionCard title="Recent Activity" flush>
            <ul className="divide-y divide-border">
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
                <LegendRow color="bg-muted-foreground/40" label="Total Capacity" value={capacity || "—"} />
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

          {!isHiddenPath("/finance") && (
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
