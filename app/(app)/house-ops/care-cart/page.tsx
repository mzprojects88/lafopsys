"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Banknote, HandHeart, HeartPulse, Users } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useKitchenRecords, type CareCartRun } from "@/lib/hooks/use-kitchen-records";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate, todayIso } from "@/lib/utils/date";
import { formatTime12 } from "@/lib/utils/time12";

// As LAF Inventory names them (lib/utils/care-cart.ts there).
const SOURCE: Record<string, string> = { laf_pantry: "LAF pantry", donation: "Donation", sponsor: "Sponsor" };
const STATUS: Record<string, string> = { scheduled: "Scheduled", cooked: "Cooked", delivered: "Served", cancelled: "Cancelled" };

const columns: ColumnDef<CareCartRun>[] = [
  { accessorKey: "date", header: "Date", cell: ({ row }) => formatDate(row.original.date) },
  { accessorKey: "timeSlot", header: "Time", cell: ({ row }) => (/^\d{1,2}:\d{2}/.test(row.original.timeSlot ?? "") ? formatTime12(row.original.timeSlot) : (row.original.timeSlot ?? "—")) },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <Badge variant={row.original.status === "delivered" ? "secondary" : "outline"}>{STATUS[row.original.status] ?? row.original.status}</Badge>,
  },
  { accessorKey: "dishes", header: "Served", cell: ({ row }) => row.original.dishes ?? "—" },
  { accessorKey: "served", header: "People", cell: ({ row }) => row.original.served ?? "—" },
  {
    accessorKey: "source",
    header: "Source",
    cell: ({ row }) => [SOURCE[row.original.source ?? ""] ?? row.original.source, row.original.sponsor].filter(Boolean).join(" · ") || "—",
  },
  { accessorKey: "volunteerNames", header: "Volunteers", cell: ({ row }) => row.original.volunteerNames ?? (row.original.volunteers ? String(row.original.volunteers) : "—") },
  { id: "cost", header: "Stock used", cell: ({ row }) => (row.original.drawValue === null ? "—" : formatCurrency(row.original.drawValue, "PHP")) },
];

/**
 * Care Cart (0102): every run LAF Inventory recorded -- when, what was served, to how many, from
 * which source, who helped and the stock drawn -- read only. Runs are recorded in LAF Inventory ›
 * Care Cart.
 */
export default function CareCartPage() {
  const [month, setMonth] = React.useState(todayIso().slice(0, 7));
  const from = `${month}-01`;
  const to = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const { rows, error } = useKitchenRecords("house_care_cart", from, to);
  const runs = rows ?? [];
  const served = runs.filter((r) => r.status === "delivered");
  const people = served.reduce((s, r) => s + (r.served ?? 0), 0);
  const stock = runs.reduce((s, r) => s + (r.drawValue ?? 0), 0);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Care Cart"
        description="Care Cart runs recorded in LAF Inventory: what was served, to how many, and the stock used. Read only: runs are recorded in LAF Inventory › Care Cart."
        action={<Input type="month" aria-label="Month" className="w-44" value={month} max={todayIso().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} />}
      />
      <KpiGrid>
        <KpiCard label="Runs served" value={served.length.toLocaleString()} icon={HeartPulse} sublabel={runs.length > served.length ? `${runs.length - served.length} scheduled or cancelled` : undefined} />
        <KpiCard label="People served" value={people.toLocaleString()} icon={Users} />
        <KpiCard label="Volunteers" value={served.reduce((s, r) => s + (r.volunteers ?? 0), 0).toLocaleString()} icon={HandHeart} />
        <KpiCard label="Stock used" value={formatCurrency(stock, "PHP")} icon={Banknote} />
      </KpiGrid>
      {error ? (
        <p className="text-theme-sm text-destructive">{error}</p>
      ) : rows === null ? (
        <p className="text-theme-sm text-muted-foreground">Loading Care Cart runs…</p>
      ) : (
        <DataTable columns={columns} data={runs} searchPlaceholder="Search by dish, source or volunteer…" pageSize={21} />
      )}
    </div>
  );
}
