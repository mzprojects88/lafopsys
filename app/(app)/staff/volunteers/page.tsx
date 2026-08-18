"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Award } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { PersonAvatar } from "@/components/patterns/person-avatar";
import { Button } from "@/components/ui/button";
import { useVolunteersData } from "@/lib/hooks/use-volunteers-collection";
import type { Volunteer } from "@/lib/types/staff";
import { formatDate } from "@/lib/utils/date";

export default function VolunteersPage() {
  const { volunteers, incrementCertificates } = useVolunteersData();

  const columns: ColumnDef<Volunteer>[] = [
    {
      id: "name",
      header: "Name",
      accessorFn: (v) => `${v.firstName} ${v.lastName}`,
      cell: ({ row }) => {
        const name = `${row.original.firstName} ${row.original.lastName}`;
        return (
          <div className="flex items-center gap-2.5">
            <PersonAvatar name={name} size="sm" />
            <span className="font-medium">{name}</span>
          </div>
        );
      },
    },
    { accessorKey: "focusArea", header: "Focus Area" },
    { accessorKey: "totalHours", header: "Total Hours" },
    {
      accessorKey: "lastSessionDate",
      header: "Last Session",
      cell: ({ row }) => formatDate(row.original.lastSessionDate),
    },
    { accessorKey: "certificatesIssued", header: "Certificates" },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5"
          onClick={(e) => {
            e.stopPropagation();
            incrementCertificates(row.original.id, row.original.certificatesIssued);
            toast.success(`Service certificate count updated for ${row.original.firstName} ${row.original.lastName}`);
          }}
        >
          <Award className="size-3.5" />
          Generate Certificate
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Volunteers" description="Separate sign-in from staff — tracks hours and generates service certificates." />
      <DataTable columns={columns} data={volunteers} searchPlaceholder="Search volunteers…" />
    </div>
  );
}
