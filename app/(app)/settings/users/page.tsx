"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { Badge } from "@/components/ui/badge";
import { staff } from "@/lib/mock-data";
import { ROLES, type Role } from "@/lib/types/common";
import type { Staff } from "@/lib/types/staff";

const ROLE_LABEL: Record<Role, string> = Object.fromEntries(ROLES.map((r) => [r.value, r.label])) as Record<Role, string>;

const columns: ColumnDef<Staff>[] = [
  { id: "name", header: "Name", accessorFn: (s) => `${s.firstName} ${s.lastName}` },
  { accessorKey: "position", header: "Position" },
  { accessorKey: "role", header: "Role", cell: ({ row }) => <Badge variant="secondary">{ROLE_LABEL[row.original.role]}</Badge> },
  { accessorKey: "hireDate", header: "Hire Date" },
  { accessorKey: "active", header: "Status", cell: ({ row }) => (row.original.active ? "Active" : "Inactive") },
];

export default function UsersPage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Users & Roles"
        description="Demo listing only — this prototype has no real authentication. Use the role switcher in the sidebar to preview each role's view."
      />
      <DataTable columns={columns} data={staff} searchPlaceholder="Search staff…" />
    </div>
  );
}
