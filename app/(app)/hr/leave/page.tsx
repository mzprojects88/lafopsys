"use client";

import * as React from "react";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { StatusBadge } from "@/components/patterns/status-badge";
import { DataTable } from "@/components/patterns/data-table";
import { ApprovalQueue } from "@/components/patterns/approval-queue";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HrSubNav } from "@/components/modules/hr/hr-subnav";
import { LeaveRequestDialog } from "@/components/modules/hr/leave-request-dialog";
import { LeaveAdjustmentDialog } from "@/components/modules/hr/leave-adjustment-dialog";
import { useEmployees } from "@/lib/hooks/use-employees-collection";
import { useLeaveRequests, useLeaveAdjustments, leaveRequestsStore } from "@/lib/hooks/use-leave-collections";
import { useLeaveTypes } from "@/lib/hooks/use-hr-reference-collections";
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import { useNow } from "@/lib/hooks/use-now";
import { useRole } from "@/lib/rbac/use-role";
import { canManageHr } from "@/lib/rbac/roles";
import { dayKey } from "@/lib/utils/dtr";
import { formatDate } from "@/lib/utils/date";
import { leaveBalance } from "@/lib/utils/leave";
import { cancelLeaveRequest, decideLeaveRequest } from "./actions";
import { LEAVE_REQUEST_STATUSES, employeeFullName, type Employee, type LeaveRequest, type LeaveType } from "@/lib/types/hr";

const STATUS_LABEL = Object.fromEntries(LEAVE_REQUEST_STATUSES.map((s) => [s.value, s.label]));

/**
 * Leave. Everyone: their balances for the year, their requests, a button
 * to file one. HR and admins: the pending queue to decide, every request,
 * and balance adjustments (opening balances, carry-in, conversions).
 */
export default function LeavePage() {
  const { role, isHr, staffId } = useRole();
  const manages = canManageHr(role, isHr);
  const { employees } = useEmployees();
  const { requests, loading, error } = useLeaveRequests();
  const { adjustments } = useLeaveAdjustments();
  const { leaveTypes } = useLeaveTypes();
  const settings = useAppSettings();
  const today = dayKey(useNow());
  const year = Number(today.slice(0, 4));
  const me = employees.find((e) => e.staffId === staffId) ?? null;
  const [who, setWho] = React.useState<string>("all");

  const focus: Employee | null = manages ? (who === "all" ? null : who === "me" ? me : (employees.find((e) => e.id === who) ?? null)) : me;
  const byId = new Map(employees.map((e) => [e.id, e]));
  const typeById = new Map(leaveTypes.map((t) => [t.id, t]));

  function entitlement(t: LeaveType) {
    return t.entitlementSource === "settings_vl" ? settings.vlDaysPerYear : t.entitlementSource === "settings_sl" ? settings.slDaysPerYear : (t.daysDefault ?? 0);
  }

  const balances =
    focus === null
      ? []
      : leaveTypes
          .filter((t) => t.active && t.paid && !t.eligibility.perEvent && entitlement(t) > 0)
          .map((t) =>
            leaveBalance({
              typeId: t.id,
              year,
              entitlementPerYear: entitlement(t),
              hireDate: focus.hireDate,
              asOf: today,
              separationDate: focus.separationDate,
              adjustments: adjustments.filter((a) => a.employeeId === focus.id),
              requests: requests.filter((r) => r.employeeId === focus.id),
            })
          );

  const pending = requests.filter((r) => r.status === "pending");

  async function decide(id: string, decision: "approved" | "rejected", note: string) {
    const result = await decideLeaveRequest(id, decision, note);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    await leaveRequestsStore.refetch();
    toast.success(decision === "approved" ? "Leave approved." : "Leave rejected.");
  }

  async function withdraw(id: string) {
    const result = await cancelLeaveRequest(id);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    await leaveRequestsStore.refetch();
    toast.success("Request withdrawn.");
  }

  const columns: ColumnDef<LeaveRequest>[] = [
    ...(manages
      ? [{ id: "who", header: "Employee", accessorFn: (r: LeaveRequest) => employeeFullName(byId.get(r.employeeId) ?? { firstName: "?", lastName: "", suffix: null }) } as ColumnDef<LeaveRequest>]
      : []),
    { id: "type", header: "Leave", accessorFn: (r) => typeById.get(r.leaveTypeId)?.name ?? r.leaveTypeId },
    {
      id: "dates",
      header: "Dates",
      accessorFn: (r) => r.startsOn,
      cell: ({ row }) => {
        const r = row.original;
        return (
          <span>
            {formatDate(r.startsOn, "MMM d")}
            {r.endsOn !== r.startsOn ? ` – ${formatDate(r.endsOn, "MMM d")}` : ""}
            {r.startHalf || r.endHalf ? <span className="text-xs text-muted-foreground"> · half day</span> : null}
          </span>
        );
      },
    },
    { id: "days", header: "Days", accessorFn: (r) => r.days, cell: ({ row }) => <span className="tabular-nums">{row.original.days}</span> },
    {
      id: "status",
      header: "Status",
      accessorFn: (r) => r.status,
      cell: ({ row }) => <StatusBadge dot domain="leave" status={row.original.status} label={STATUS_LABEL[row.original.status]} />,
    },
    {
      id: "note",
      header: "Reason / decision",
      accessorFn: (r) => r.reason ?? "",
      cell: ({ row }) => (
        <span className="block max-w-[32ch] truncate text-xs text-muted-foreground" title={[row.original.reason, row.original.decisionNote].filter(Boolean).join(" — ")}>
          {row.original.reason ?? ""}
          {row.original.decisionNote ? ` — ${row.original.decisionNote}` : ""}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) =>
        row.original.status === "pending" && (row.original.employeeId === me?.id || manages) ? (
          <Button variant="ghost" size="sm" onClick={() => withdraw(row.original.id)}>
            Withdraw
          </Button>
        ) : null,
    },
  ];

  const shown = manages ? (who === "all" ? requests : requests.filter((r) => r.employeeId === focus?.id)) : requests;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title={manages ? "Leave" : "My Leave"} description="Vacation, sick and statutory leave — balances, requests and approvals." action={<HrSubNav />} />

      {error ? <EmptyState title="Couldn't load leave" description={error} /> : null}

      {manages && pending.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">To decide ({pending.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ApprovalQueue
              items={pending.map((r) => ({
                id: r.id,
                title: `${employeeFullName(byId.get(r.employeeId) ?? { firstName: "?", lastName: "", suffix: null })} · ${typeById.get(r.leaveTypeId)?.name ?? r.leaveTypeId}`,
                subtitle: `${formatDate(r.startsOn)}${r.endsOn !== r.startsOn ? ` – ${formatDate(r.endsOn)}` : ""} · ${r.days} day(s)${r.reason ? ` — ${r.reason}` : ""}`,
                meta: r.documentUrl ? (
                  <a href={r.documentUrl} target="_blank" rel="noreferrer" className="text-xs underline">
                    Document
                  </a>
                ) : undefined,
              }))}
              onApprove={(id, note) => decide(id, "approved", note)}
              onReject={(id, note) => decide(id, "rejected", note)}
              approveLabel="Approve"
              rejectLabel="Reject"
            />
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        {manages ? (
          <Select value={who} onValueChange={setWho}>
            <SelectTrigger className="w-64" aria-label="Whose leave">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Everyone</SelectItem>
              {me ? <SelectItem value="me">My own</SelectItem> : null}
              {employees
                .filter((e) => e.status === "active" || e.status === "on_leave")
                .map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {employeeFullName(e)}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          {manages && focus ? <LeaveAdjustmentDialog employee={focus} leaveTypes={leaveTypes} year={year} /> : null}
          {focus || manages ? <LeaveRequestDialog leaveTypes={leaveTypes} employees={employees} forEmployee={focus} hr={manages} /> : null}
        </div>
      </div>

      {focus ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {balances.map((b) => (
            <Card key={b.typeId} className="py-4">
              <CardContent className="flex flex-col gap-0.5 px-4">
                <span className="text-sm font-medium text-muted-foreground">{typeById.get(b.typeId)?.name}</span>
                <span className="text-2xl font-bold tabular-nums">{b.available.toFixed(2)}</span>
                <span className="text-xs text-muted-foreground">
                  {b.accrued} accrued of {b.entitled} · {b.used} used{b.pending ? ` · ${b.pending} pending` : ""}
                  {b.carriedIn ? ` · ${b.carriedIn} carried in` : ""}
                  {b.converted ? ` · ${b.converted} converted` : ""}
                </span>
              </CardContent>
            </Card>
          ))}
          {balances.length === 0 ? <p className="col-span-full text-sm text-muted-foreground">No accruing leave types are switched on.</p> : null}
        </div>
      ) : !manages && !loading ? (
        <EmptyState title="No employee record linked to your login" description="Ask HR to link it; your balances and requests will appear here." />
      ) : manages ? (
        <p className="text-xs text-muted-foreground">Pick a person to see their balances.</p>
      ) : null}

      <DataTable columns={columns} data={shown} emptyMessage={loading ? "Loading…" : "No leave requests."} pageSize={20} searchPlaceholder="Search…" />
    </div>
  );
}
