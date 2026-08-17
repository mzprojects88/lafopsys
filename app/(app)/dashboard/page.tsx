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
  Boxes,
  FileSignature,
  BadgeCheck,
  BarChart3,
  ChevronRight,
  ChevronDown,
  Settings2,
  type LucideIcon,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, Line, LineChart, XAxis } from "recharts";
import { PageHeader } from "@/components/patterns/page-header";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { IconCircle } from "@/components/patterns/icon-circle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { useRole } from "@/lib/rbac/use-role";
import {
  censusHistory,
  patients,
  donations,
  cashEntries,
  inventoryItems,
  inventoryLots,
  timesheetApprovals,
  referrals,
  stays,
  donors,
} from "@/lib/mock-data";
import { formatCurrency } from "@/lib/utils/currency";
import { daysUntil, formatDate } from "@/lib/utils/date";
import type { CategoryColor } from "@/lib/utils/category-colors";

const HOUSE_CAPACITY = 20; // placeholder pending the spec's open question on licensed capacity

export default function DashboardPage() {
  const { role } = useRole();

  const today = censusHistory[censusHistory.length - 1];
  const pendingApprovals = timesheetApprovals.filter((a) => a.status === "pending").length;
  const pendingReferrals = referrals.filter((r) => r.status === "submitted").length;
  const expiringSoon = inventoryLots.filter((l) => l.expiryDate && daysUntil(l.expiryDate) <= 14 && daysUntil(l.expiryDate) >= 0).length;
  const cashIn = cashEntries.filter((e) => e.direction === "inflow").reduce((s, e) => s + e.amount, 0);

  const occupiedPct = Math.round((today.inHouse / HOUSE_CAPACITY) * 100);
  const availableSlots = Math.max(0, HOUSE_CAPACITY - today.inHouse);

  const goodStock = inventoryItems.filter((item) => {
    const stock = inventoryLots.filter((l) => l.itemId === item.id).reduce((s, l) => s + l.quantity, 0);
    return stock > item.reorderPoint * 1.5;
  }).length;
  const lowStock = inventoryItems.filter((item) => {
    const stock = inventoryLots.filter((l) => l.itemId === item.id).reduce((s, l) => s + l.quantity, 0);
    return stock > 0 && stock <= item.reorderPoint * 1.5;
  }).length;

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
      color: "green" as CategoryColor,
      title: `Donation of ${formatCurrency(d.totalValue, d.currency)} received`,
      subtitle: donors.find((dn) => dn.id === d.donorId)?.name ?? "Anonymous",
      date: d.date,
    })),
    ...stays.slice(0, 2).map((s) => ({
      icon: UserPlus,
      color: "blue" as CategoryColor,
      title: "Patient stay recorded",
      subtitle: patients.find((p) => p.id === s.patientId)?.firstName ?? "—",
      date: s.checkInAt,
    })),
    ...referrals.filter((r) => r.status === "approved").slice(0, 1).map((r) => ({
      icon: BadgeCheck,
      color: "purple" as CategoryColor,
      title: "Referral approved",
      subtitle: r.patientName,
      date: r.date,
    })),
  ]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5);

  const urgentApprovals = [
    ...timesheetApprovals
      .filter((a) => a.status === "pending")
      .slice(0, 2)
      .map((a) => ({ title: "Timesheet Adjustment", subtitle: a.adjustmentReason ?? "Pending review", priority: "Medium" as const })),
    ...cashEntries
      .filter((e) => e.approvalStatus === "pending")
      .slice(0, 2)
      .map((e) => ({
        title: e.direction === "outflow" ? "Cash Disbursement" : "Cash Deposit",
        subtitle: formatCurrency(e.amount, e.currency),
        priority: e.amount > 20000 ? ("High" as const) : ("Medium" as const),
      })),
  ].slice(0, 4);

  const quickActions = [
    { label: "Create Referral", href: "/patients/referrals/new", icon: Send, color: "purple" as CategoryColor },
    { label: "Record Donation", href: "/donors/intake", icon: HandCoins, color: "green" as CategoryColor },
    { label: "Add Inventory", href: "/inventory/scan", icon: Boxes, color: "teal" as CategoryColor },
    { label: "New Cash Entry", href: "/finance/entry", icon: FileSignature, color: "blue" as CategoryColor },
    { label: "Request Approval", href: "/finance/approvals", icon: CheckCircle2, color: "amber" as CategoryColor },
    { label: "Generate Report", href: "/reports/builder", icon: BarChart3, color: "indigo" as CategoryColor },
  ];

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
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Dashboard" description="Role-aware view — switch roles from the sidebar to compare." />

      <KpiGrid>
        {(role === "admin" || role === "social_worker" || role === "house_staff" || role === "driver") && (
          <KpiCard label="In-House Now" value={today.inHouse} sublabel="Residents" icon={Users} color="blue" />
        )}
        {(role === "admin" || role === "social_worker") && (
          <KpiCard label="Enrolled Patients" value={patients.length} sublabel="Total" icon={UserCheck} color="cyan" />
        )}
        {(role === "admin" || role === "finance" || role === "board") && (
          <KpiCard label="Cash Donations" value={formatCurrency(cashIn)} sublabel="This period" icon={Wallet} color="green" />
        )}
        {(role === "admin" || role === "finance") && (
          <KpiCard label="Pending Approvals" value={pendingApprovals} sublabel="Items" icon={ClipboardList} color="amber" />
        )}
        {(role === "admin" || role === "social_worker") && (
          <KpiCard label="Pending Referrals" value={pendingReferrals} sublabel="Referrals" icon={Send} color="purple" />
        )}
        {(role === "admin" || role === "house_staff") && (
          <KpiCard label="Items Expiring ≤14d" value={expiringSoon} sublabel="Items" icon={PackageX} color="rose" />
        )}
        {role === "volunteer" && <KpiCard label="Donations Recorded" value={donations.length} icon={HandCoins} color="green" />}
      </KpiGrid>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Donations Trend (This Period)</CardTitle>
            <span className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs text-muted-foreground">
              Last 30 days <ChevronDown className="size-3" />
            </span>
          </CardHeader>
          <CardContent>
            <div className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-2 rounded-full bg-[var(--chart-1)]" />
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Patients & Admissions Trend</CardTitle>
            <span className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs text-muted-foreground">
              Last 30 days <ChevronDown className="size-3" />
            </span>
          </CardHeader>
          <CardContent>
            <div className="mb-3 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-[var(--chart-1)]" />
                Enrolled
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-[var(--chart-2)]" />
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
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">House Occupancy</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-6">
            <OccupancyRing percent={occupiedPct} />
            <div className="flex flex-col gap-2 text-sm">
              <LegendRow color="bg-blue-500" label="In-House Now" value={today.inHouse} />
              <LegendRow color="bg-blue-200" label="Available Slots" value={availableSlots} />
              <LegendRow color="bg-slate-300" label="Total Capacity" value={HOUSE_CAPACITY} />
            </div>
          </CardContent>
          <Link href="/house-ops" className="mx-4 mb-4 flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            View house operations <ChevronRight className="size-3.5" />
          </Link>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Inventory Status</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            <StatusRow icon={CheckCircle2} color="green" label="Good Stock" sublabel="Well-stocked items" value={goodStock} />
            <StatusRow icon={AlertTriangle} color="amber" label="Low Stock" sublabel="Reorder soon" value={lowStock} />
            <StatusRow icon={Clock} color="rose" label="Expiring ≤14d" sublabel="Needs attention" value={expiringSoon} />
            <Link href="/inventory" className="mt-2 flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              View inventory <ChevronRight className="size-3.5" />
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Activity</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {recentActivity.map((a, i) => (
              <div key={i} className="flex items-start gap-3">
                <IconCircle icon={a.icon} color={a.color} size="sm" />
                <div className="flex flex-1 flex-col">
                  <span className="text-sm font-medium leading-tight">{a.title}</span>
                  <span className="text-xs text-muted-foreground">{a.subtitle}</span>
                </div>
                <span className="shrink-0 text-[11px] text-muted-foreground">{formatDate(a.date, "MMM d")}</span>
              </div>
            ))}
            <Link href="/reports" className="mt-1 flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              View all activity <ChevronRight className="size-3.5" />
            </Link>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Urgent Approvals</CardTitle>
            <Badge className="rounded-full">{urgentApprovals.length}</Badge>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {urgentApprovals.map((a, i) => (
              <div key={i} className="flex items-center justify-between gap-2">
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{a.title}</span>
                  <span className="text-xs text-muted-foreground">{a.subtitle}</span>
                </div>
                <Badge
                  variant="outline"
                  className={
                    a.priority === "High"
                      ? "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400"
                      : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400"
                  }
                >
                  {a.priority}
                </Badge>
              </div>
            ))}
            <Link href="/finance/approvals" className="mt-1 flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              View all approvals <ChevronRight className="size-3.5" />
            </Link>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {quickActions.map((action) => (
              <Button key={action.href} variant="outline" className="h-auto flex-col items-start gap-2 py-3" asChild>
                <Link href={action.href}>
                  <IconCircle icon={action.icon} color={action.color} size="sm" />
                  <span className="text-xs font-medium">{action.label}</span>
                </Link>
              </Button>
            ))}
            <button
              type="button"
              className="col-span-full mt-1 flex items-center justify-end gap-1 text-xs font-medium text-primary hover:underline"
            >
              <Settings2 className="size-3.5" />
              Customize dashboard
            </button>
          </CardContent>
        </Card>
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
        <span className="text-2xl font-bold">{percent}%</span>
        <span className="text-[10px] text-muted-foreground">Occupied</span>
      </div>
    </div>
  );
}

function LegendRow({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`size-2.5 shrink-0 rounded-full ${color}`} />
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto font-semibold">{value}</span>
    </div>
  );
}

function StatusRow({
  icon,
  color,
  label,
  sublabel,
  value,
}: {
  icon: LucideIcon;
  color: CategoryColor;
  label: string;
  sublabel: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <IconCircle icon={icon} color={color} size="sm" />
      <div className="flex flex-1 flex-col">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{sublabel}</span>
      </div>
      <span className="text-lg font-semibold tabular-nums">{value}</span>
    </div>
  );
}
