"use client";

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
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
} from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { StatusBadge } from "@/components/patterns/status-badge";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { ModuleSubNav, type ModuleSubNavItem } from "@/components/patterns/module-subnav";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useCashEntriesData } from "@/lib/hooks/use-cash-entries-collection";
import { useProgramsData } from "@/lib/hooks/use-programs-collection";

const SUB_NAV: ModuleSubNavItem[] = [
  { href: "/finance/accounts", label: "Accounts", icon: Landmark, color: "blue" },
  { href: "/finance/approvals", label: "Approvals", icon: CheckSquare, color: "amber" },
  { href: "/finance/allocation", label: "Allocation", icon: PieChart, color: "purple" },
  { href: "/finance/cost-per-outcome", label: "Cost / Outcome", icon: Target, color: "cyan" },
  { href: "/finance/budget", label: "Budget", icon: Wallet, color: "green" },
  { href: "/finance/close", label: "Monthly Close", icon: ClipboardCheck, color: "rose" },
  { href: "/finance/registers", label: "Registers", icon: BookOpen, color: "slate" },
];
import type { CashEntry } from "@/lib/types/finance";
import type { Program } from "@/lib/types/reference";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/date";

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
        <Badge variant={row.original.direction === "inflow" ? "default" : "secondary"} className="text-[11px] capitalize">
          {row.original.direction}
        </Badge>
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
  const { entries: cashEntries } = useCashEntriesData();
  const { programs } = useProgramsData();
  const columns = buildColumns(programs);
  const totalInflow = cashEntries.filter((e) => e.direction === "inflow").reduce((s, e) => s + e.amount, 0);
  const totalOutflow = cashEntries.filter((e) => e.direction === "outflow").reduce((s, e) => s + e.amount, 0);
  const pendingCount = cashEntries.filter((e) => e.approvalStatus === "pending").length;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Financial Tracking"
        description="All cashflow in/out — donation, infusion, and other means."
        action={
          <>
            <Button asChild><Link href="/finance/entry"><Plus />New Entry</Link></Button>
            <ModuleSubNav items={SUB_NAV} />
          </>
        }
      />

      <KpiGrid>
        <KpiCard label="Total Inflow" value={formatCurrency(totalInflow)} icon={TrendingUp} color="green" />
        <KpiCard label="Total Outflow" value={formatCurrency(totalOutflow)} icon={TrendingDown} color="rose" />
        <KpiCard label="Net" value={formatCurrency(totalInflow - totalOutflow)} icon={Scale} color="blue" />
        <KpiCard label="Pending Approvals" value={pendingCount} icon={Clock} color="amber" />
      </KpiGrid>

      <DataTable columns={columns} data={cashEntries} searchPlaceholder="Search cashflow…" pageSize={12} />
    </div>
  );
}
