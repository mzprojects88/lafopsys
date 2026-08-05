"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { documents } from "@/lib/mock-data";
import type { DocumentRecord } from "@/lib/types/reports";
import { formatDate } from "@/lib/utils/date";

const columns: ColumnDef<DocumentRecord>[] = [
  { accessorKey: "title", header: "Document" },
  { accessorKey: "category", header: "Category", cell: ({ row }) => <Badge variant="secondary">{row.original.category}</Badge> },
  { accessorKey: "uploadedAt", header: "Uploaded", cell: ({ row }) => formatDate(row.original.uploadedAt) },
  { accessorKey: "uploadedBy", header: "Uploaded By" },
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
          toast.success(`Downloading ${row.original.title} (demo)`);
        }}
      >
        <Download className="size-3.5" />
      </Button>
    ),
  },
];

export default function DocumentsPage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Document Library" description="Policies, licenses, MOAs, and the determination letter." />
      <DataTable columns={columns} data={documents} searchPlaceholder="Search documents…" />
    </div>
  );
}
