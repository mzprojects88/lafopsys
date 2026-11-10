"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Banknote, HandHeart, HeartPulse, Users } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { Badge } from "@/components/ui/badge";
import { LoadingState } from "@/components/patterns/loading-state";
import { PeriodPresetsBar, usePeriodPresets } from "@/components/patterns/period-presets";
import { ClearFilters, FilterSelect, useFilters } from "@/components/patterns/filters";
import { optionsOf } from "@/lib/utils/filters";
import { useKitchenRecords, type CareCartRun } from "@/lib/hooks/use-kitchen-records";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/date";
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
  return (
    <React.Suspense fallback={<LoadingState />}>
      <CareCartContent />
    </React.Suspense>
  );
}

function CareCartContent() {
  const period = usePeriodPresets("house-care-cart", "this_month");
  const { from, to } = period.window!;
  const { rows, error } = useKitchenRecords("house_care_cart", from, to);
  const f = useFilters("status", "slot");
  const slotLabel = (v: string) => (/^\d{1,2}:\d{2}/.test(v) ? formatTime12(v) : v);
  const runs = (rows ?? []).filter((r) => f.ok("status", r.status) && f.ok("slot", r.timeSlot));
  const served = runs.filter((r) => r.status === "delivered");
  const people = served.reduce((s, r) => s + (r.served ?? 0), 0);
  const stock = runs.reduce((s, r) => s + (r.drawValue ?? 0), 0);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Care Cart"
        description="Care Cart runs recorded in LAF Inventory: what was served, to how many, and the stock used. Read only: runs are recorded in LAF Inventory › Care Cart."
      />
      <PeriodPresetsBar state={period.state} onChange={period.setState} today={period.today} />
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
        <DataTable
          columns={columns}
          data={runs}
          searchPlaceholder="Search by dish, source or volunteer…"
          pageSize={21}
          toolbar={
            <>
              <FilterSelect all="Any status" value={f.values.status} onChange={f.set("status")} options={optionsOf(rows ?? [], (r) => r.status, (v) => STATUS[v] ?? v)} className="w-36" />
              <FilterSelect all="Any time" value={f.values.slot} onChange={f.set("slot")} options={optionsOf(rows ?? [], (r) => r.timeSlot, slotLabel)} className="w-36" />
              <ClearFilters active={f.active} onClear={f.clear} />
            </>
          }
        />
      )}
    </div>
  );
}
