"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import {
  Plus,
  TrendingUp,
  TrendingDown,
  Scale,
  Clock,
  Landmark,
  CheckSquare,
  PieChart,
  Target,
  Wallet,
  ClipboardCheck,
  BookOpen,
  CalendarRange,
  Upload,
  Fuel,
  Settings2,
  Banknote,
} from "lucide-react";
import { FinanceSetupBanner } from "@/components/modules/finance/setup-banner";
import { useRole } from "@/lib/rbac/use-role";
import { holdsPower } from "@/lib/rbac/roles";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { StatusBadge } from "@/components/patterns/status-badge";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { LoadingState } from "@/components/patterns/loading-state";
import { PeriodPresetsBar, usePeriodPresets } from "@/components/patterns/period-presets";
import { ClearFilters, FilterSelect, useFilters } from "@/components/patterns/filters";
import { optionsOf } from "@/lib/utils/filters";
import { ENTITIES } from "@/lib/types/common";
import { ModuleSubNav, type ModuleSubNavItem } from "@/components/patterns/module-subnav";
import { Button } from "@/components/ui/button";
import { useCashEntriesData } from "@/lib/hooks/use-cash-entries-collection";
import { useProgramsData } from "@/lib/hooks/use-programs-collection";

const SUB_NAV: ModuleSubNavItem[] = [
  { href: "/finance/monthly-summary", label: "Monthly Summary", icon: CalendarRange },
  { href: "/finance/bank-import", label: "Bank Import", icon: Upload },
  { href: "/finance/accounts", label: "Accounts", icon: Landmark },
  { href: "/finance/approvals", label: "Approvals", icon: CheckSquare },
  { href: "/finance/allocation", label: "Allocation", icon: PieChart },
  { href: "/finance/cost-per-outcome", label: "Cost / Outcome", icon: Target },
  { href: "/finance/budget", label: "Budget", icon: Wallet },
  { href: "/finance/close", label: "Monthly Close", icon: ClipboardCheck },
  { href: "/finance/registers", label: "Registers", icon: BookOpen },
  { href: "/finance/vehicle-costs", label: "Vehicle Costs", icon: Fuel },
  { href: "/finance/budgets", label: "Budgets", icon: Wallet },
  { href: "/finance/funds", label: "Funds & Advances", icon: Banknote },
  { href: "/finance/settings", label: "Financial Settings", icon: Settings2 },
];
import type { CashEntry } from "@/lib/types/finance";
import type { Program } from "@/lib/types/reference";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/date";
import { STATUS_TONE_CLASSES } from "@/lib/utils/status-colors";

function sourceLabel(source: string) {
  return source.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

function buildColumns(programs: Program[]): ColumnDef<CashEntry>[] {
  return [
    { accessorKey: "date", header: "Date", cell: ({ row }) => (row.original.date ? formatDate(row.original.date) : "—") },
    {
      id: "direction",
      header: "Direction",
      cell: ({ row }) => (
        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-theme-xs font-medium capitalize ${STATUS_TONE_CLASSES[row.original.direction === "inflow" ? "positive" : "neutral"]}`}>
          {row.original.direction}
        </span>
      ),
    },
    { id: "source", header: "Source", cell: ({ row }) => sourceLabel(row.original.source) },
    {
      id: "program",
      header: "Program",
      cell: ({ row }) => programs.find((p) => p.id === row.original.programId)?.name ?? "—",
    },
    { accessorKey: "entity", header: "Entity", cell: ({ row }) => (row.original.entity === "US_501C3" ? "US" : "PH") },
    {
      accessorKey: "amount",
      header: "Amount",
      cell: ({ row }) => formatCurrency(row.original.amount, row.original.currency),
    },
    {
      accessorKey: "approvalStatus",
      header: "Approval",
      cell: ({ row }) => <StatusBadge domain="finance" status={row.original.approvalStatus} />,
    },
  ];
}

export default function FinancePage() {
  return (
    <React.Suspense fallback={<LoadingState />}>
      <FinanceContent />
    </React.Suspense>
  );
}

function FinanceContent() {
  const { canEdit } = useModuleAccess();
  const { roles } = useRole();
  const { entries: all } = useCashEntriesData();
  const { programs } = useProgramsData();
  const columns = buildColumns(programs);
  // In, out, net and the list follow the period (this month by default, or All time); pending stays "now".
  const period = usePeriodPresets("finance", "this_month", true);
  const w = period.window;
  const f = useFilters("direction", "approval", "entity", "source", "program");
  const cashEntries = all.filter(
    (e) =>
      (!w || (!!e.date && e.date >= w.from && e.date <= w.to)) &&
      f.ok("direction", e.direction) &&
      f.ok("approval", e.approvalStatus) &&
      f.ok("entity", e.entity) &&
      f.ok("source", e.source) &&
      f.ok("program", e.programId)
  );
  const totalInflow = cashEntries.filter((e) => e.direction === "inflow").reduce((s, e) => s + e.amount, 0);
  const totalOutflow = cashEntries.filter((e) => e.direction === "outflow").reduce((s, e) => s + e.amount, 0);
  const pendingCount = all.filter((e) => e.approvalStatus === "pending").length;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Financial Tracking"
        description="All cashflow in/out — donation, infusion, and other means."
        action={
          <>
            {canEdit("finance") ? <Button asChild><Link href="/finance/entry"><Plus />New Entry</Link></Button> : null}
            <ModuleSubNav items={SUB_NAV} />
          </>
        }
      />

      {holdsPower(roles, "finance_setup") ? <FinanceSetupBanner /> : null}
      <PeriodPresetsBar state={period.state} onChange={period.setState} today={period.today} allowAll />
      <KpiGrid>
        <KpiCard label="Total Inflow" value={formatCurrency(totalInflow)} sublabel={period.label} icon={TrendingUp} />
        <KpiCard label="Total Outflow" value={formatCurrency(totalOutflow)} sublabel={period.label} icon={TrendingDown} />
        <KpiCard label="Net" value={formatCurrency(totalInflow - totalOutflow)} sublabel={period.label} icon={Scale} />
        <KpiCard label="Pending Approvals" value={pendingCount} sublabel="Now" icon={Clock} tone={pendingCount > 0 ? "warning" : "default"} />
      </KpiGrid>

      <DataTable
        columns={columns}
        data={cashEntries}
        searchPlaceholder="Search cashflow…"
        pageSize={12}
        toolbar={
          <>
            <FilterSelect all="In and out" value={f.values.direction} onChange={f.set("direction")} options={[{ value: "inflow", label: "Inflow" }, { value: "outflow", label: "Outflow" }]} className="w-32" />
            <FilterSelect all="Any approval" value={f.values.approval} onChange={f.set("approval")} options={optionsOf(all, (e) => e.approvalStatus)} />
            <FilterSelect all="PH and US" value={f.values.entity} onChange={f.set("entity")} options={optionsOf(all, (e) => e.entity, (v) => ENTITIES.find((x) => x.value === v)?.label ?? v)} />
            <FilterSelect all="All sources" value={f.values.source} onChange={f.set("source")} options={optionsOf(all, (e) => e.source, sourceLabel)} className="w-48" />
            <FilterSelect all="All programs" value={f.values.program} onChange={f.set("program")} options={optionsOf(all, (e) => e.programId, (v) => programs.find((p) => p.id === v)?.name ?? v)} />
            <ClearFilters active={f.active} onClear={f.clear} />
          </>
        }
      />
    </div>
  );
}
