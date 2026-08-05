"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Download, FileText, CalendarClock, CheckCircle2, Wrench, Send, FolderOpen } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { ModuleSubNav, type ModuleSubNavItem } from "@/components/patterns/module-subnav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { reportDefinitions } from "@/lib/mock-data";

const SUB_NAV: ModuleSubNavItem[] = [
  { href: "/reports/builder", label: "Report Builder", icon: Wrench, color: "blue" },
  { href: "/reports/schedule", label: "Scheduled Delivery", icon: Send, color: "purple" },
  { href: "/reports/documents", label: "Documents", icon: FolderOpen, color: "slate" },
];
import type { ReportDefinition } from "@/lib/types/reports";

const columns: ColumnDef<ReportDefinition>[] = [
  { accessorKey: "name", header: "Report" },
  { accessorKey: "category", header: "Category", cell: ({ row }) => <Badge variant="secondary">{row.original.category}</Badge> },
  { accessorKey: "schedule", header: "Schedule", cell: ({ row }) => row.original.schedule?.replace("_", " ") ?? "—" },
  { accessorKey: "lastGeneratedAt", header: "Last Generated", cell: ({ row }) => row.original.lastGeneratedAt ?? "Never" },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => (
      <Button
        size="sm"
        variant="outline"
        className="h-7 gap-1.5 text-xs"
        onClick={(e) => {
          e.stopPropagation();
          toast.success(`Generated ${row.original.name} (demo)`);
        }}
      >
        <Download className="size-3.5" />
        Generate
      </Button>
    ),
  },
];

export default function ReportsPage() {
  const scheduledCount = reportDefinitions.filter((r) => r.schedule).length;
  const generatedCount = reportDefinitions.filter((r) => r.lastGeneratedAt).length;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Reports & Documentation"
        description="DSWD, BIR, US 501(c)(3), Board pack, grant reports, and the impact report — generated rather than hand-built."
        action={<ModuleSubNav items={SUB_NAV} />}
      />

      <KpiGrid>
        <KpiCard label="Total Reports" value={reportDefinitions.length} icon={FileText} color="slate" />
        <KpiCard label="Scheduled" value={scheduledCount} icon={CalendarClock} color="blue" />
        <KpiCard label="Generated" value={generatedCount} icon={CheckCircle2} color="green" />
      </KpiGrid>

      <DataTable columns={columns} data={reportDefinitions} searchPlaceholder="Search reports…" />
    </div>
  );
}
