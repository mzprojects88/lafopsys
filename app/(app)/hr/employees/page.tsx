"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { StatusBadge } from "@/components/patterns/status-badge";
import { EmptyState } from "@/components/patterns/empty-state";
import { LoadingState } from "@/components/patterns/loading-state";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HrSubNav } from "@/components/modules/hr/hr-subnav";
import { EmployeeFormDialog } from "@/components/modules/hr/employee-form-dialog";
import { useEmployees } from "@/lib/hooks/use-employees-collection";
import { useRole } from "@/lib/rbac/use-role";
import { canManageHr } from "@/lib/rbac/roles";
import { formatDate } from "@/lib/utils/date";
import { ClearFilters, FilterSelect, useFilters } from "@/components/patterns/filters";
import { optionsOf } from "@/lib/utils/filters";
import { EMPLOYMENT_STATUSES, EMPLOYMENT_TYPES, employeeFullName, type Employee, type EmploymentStatus } from "@/lib/types/hr";

const TYPE_LABEL = Object.fromEntries(EMPLOYMENT_TYPES.map((t) => [t.value, t.label]));
const STATUS_LABEL = Object.fromEntries(EMPLOYMENT_STATUSES.map((t) => [t.value, t.label]));

/** The employee register: everyone HR has on file, working or separated. */
export default function EmployeesPage() {
  const router = useRouter();
  const { role, isHr } = useRole();
  const { employees, loading, error } = useEmployees();
  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState<"working" | EmploymentStatus | "all">("working");
  const f = useFilters("department", "type");

  if (!canManageHr(role, isHr)) {
    return <EmptyState title="HR only" description="The employee register is for admins and HR." />;
  }

  const q = query.trim().toLowerCase();
  const rows = employees.filter((e) => {
    if (status === "working" ? !(e.status === "active" || e.status === "on_leave") : status !== "all" && e.status !== status) return false;
    if (!f.ok("department", e.department) || !f.ok("type", e.employmentType)) return false;
    if (!q) return true;
    return [employeeFullName(e), e.employeeCode, e.position, e.department ?? ""].some((v) => v.toLowerCase().includes(q));
  });

  const columns: ColumnDef<Employee>[] = [
    {
      id: "name",
      header: "Employee",
      accessorFn: (e) => `${e.lastName} ${e.firstName}`,
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-medium">{employeeFullName(row.original)}</span>
          <span className="text-xs text-muted-foreground">{row.original.employeeCode}</span>
        </div>
      ),
    },
    { id: "position", header: "Position", accessorFn: (e) => e.position },
    {
      id: "type",
      header: "Employment",
      accessorFn: (e) => e.employmentType,
      cell: ({ row }) => <StatusBadge domain="employee" status={row.original.employmentType} label={TYPE_LABEL[row.original.employmentType]} />,
    },
    { id: "hired", header: "Date hired", accessorFn: (e) => e.hireDate, cell: ({ row }) => formatDate(row.original.hireDate) },
    {
      id: "status",
      header: "Status",
      accessorFn: (e) => e.status,
      cell: ({ row }) => <StatusBadge dot domain="employee" status={row.original.status} label={STATUS_LABEL[row.original.status]} />,
    },
    {
      id: "login",
      header: "Login",
      accessorFn: (e) => (e.staffId ? 1 : 0),
      cell: ({ row }) => (row.original.staffId ? <span className="text-xs text-muted-foreground">Linked</span> : <StatusBadge domain="employee" status="unlinked" label="Not linked" />),
    },
  ];

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, ID, position…" className="w-56" aria-label="Search employees" />
      <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
        <SelectTrigger className="w-40" aria-label="Filter by status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="working">Working</SelectItem>
          {EMPLOYMENT_STATUSES.map((s) => (
            <SelectItem key={s.value} value={s.value}>
              {s.label}
            </SelectItem>
          ))}
          <SelectItem value="all">Everyone</SelectItem>
        </SelectContent>
      </Select>
      <FilterSelect all="All departments" value={f.values.department} onChange={f.set("department")} options={optionsOf(employees, (e) => e.department)} className="w-44" />
      <FilterSelect all="All employment types" value={f.values.type} onChange={f.set("type")} options={optionsOf(employees, (e) => e.employmentType, (v) => TYPE_LABEL[v] ?? v)} className="w-48" />
      <ClearFilters active={f.active} onClear={f.clear} />
      <span className="text-xs text-muted-foreground">{rows.length} shown</span>
    </div>
  );

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Employees" description="The 201 register — every person HR has on file." action={<HrSubNav />} />
      <div className="flex justify-end">
        <EmployeeFormDialog onCreated={(id) => router.push(`/hr/employees/${id}`)} />
      </div>
      {error ? (
        <EmptyState title="Couldn't load employees" description={error} />
      ) : loading ? (
        <LoadingState />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          toolbar={toolbar}
          onRowClick={(e) => router.push(`/hr/employees/${e.id}`)}
          emptyMessage="No employees match."
          pageSize={25}
        />
      )}
    </div>
  );
}
