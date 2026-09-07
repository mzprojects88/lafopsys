"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle } from "lucide-react";
import { DataTable } from "@/components/patterns/data-table";
import { StatusBadge } from "@/components/patterns/status-badge";
import { useBankStatementImportsData, type BankStatementImport } from "@/lib/hooks/use-bank-transactions-collection";
import { formatDate } from "@/lib/utils/date";

const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2, maximumFractionDigits: 2 });

const SOURCE_LABEL: Record<BankStatementImport["source"], string> = {
  csv_upload: "Uploaded",
  workbook_backfill: "Backfilled",
  quickbooks: "QuickBooks",
};

/** Every statement that has ever been brought in, newest first -- including
 * the ones that added nothing, so a re-upload explains itself. */
export function BankImportHistory() {
  const { imports, loading } = useBankStatementImportsData();

  const columns: ColumnDef<BankStatementImport>[] = [
    { id: "when", header: "Imported", accessorFn: (i) => i.createdAt, cell: ({ row }) => formatDate(row.original.createdAt, "MMM d, yyyy HH:mm") },
    { id: "file", header: "File", accessorFn: (i) => i.fileName, cell: ({ row }) => <span className="max-w-[28ch] truncate" title={row.original.fileName}>{row.original.fileName}</span> },
    { id: "source", header: "Source", accessorFn: (i) => SOURCE_LABEL[i.source], cell: ({ row }) => <StatusBadge domain="finance" status={row.original.source === "quickbooks" ? "approved" : "pending"} label={SOURCE_LABEL[row.original.source]} /> },
    { id: "covers", header: "Covers", accessorFn: (i) => i.coversFrom, cell: ({ row }) => `${formatDate(row.original.coversFrom, "MMM d")} – ${formatDate(row.original.coversTo, "MMM d, yyyy")}` },
    {
      id: "rows",
      header: "Rows",
      accessorFn: (i) => i.rowCount,
      cell: ({ row }) => (
        <span className="tabular-nums">
          {row.original.insertedCount} new
          {row.original.skippedCount > 0 ? <span className="text-muted-foreground"> · {row.original.skippedCount} already in</span> : null}
        </span>
      ),
    },
    { id: "closing", header: "Closing balance", accessorFn: (i) => i.closingBalance ?? 0, cell: ({ row }) => <span className="tabular-nums">{row.original.closingBalance === undefined ? "—" : peso.format(row.original.closingBalance)}</span> },
    {
      id: "warnings",
      header: "Continuity",
      accessorFn: (i) => i.continuityWarnings,
      cell: ({ row }) =>
        row.original.continuityWarnings > 0 ? (
          <span className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
            <AlertTriangle className="size-3.5" />
            {row.original.continuityWarnings} day{row.original.continuityWarnings === 1 ? "" : "s"}
          </span>
        ) : (
          <span className="text-muted-foreground">Clean</span>
        ),
    },
  ];

  return <DataTable columns={columns} data={imports} searchPlaceholder="Search imports…" emptyMessage={loading ? "Loading…" : "No statements imported yet."} pageSize={10} />;
}
