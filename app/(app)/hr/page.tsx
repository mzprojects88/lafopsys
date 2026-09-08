"use client";

import * as React from "react";
import Link from "next/link";
import { Users, UserCheck, FileWarning, KeyRound, CalendarClock, ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { KpiCard } from "@/components/patterns/kpi-card";
import { EmptyState } from "@/components/patterns/empty-state";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { HrSubNav } from "@/components/modules/hr/hr-subnav";
import { useEmployees } from "@/lib/hooks/use-employees-collection";
import { useLeaveRequests } from "@/lib/hooks/use-leave-collections";
import { usePayPeriods } from "@/lib/hooks/use-pay-periods-collection";
import { allSchedulesStore } from "@/lib/hooks/use-roster";
import { useCollection } from "@/lib/data/collection-store";
import { payPeriodLabel } from "@/lib/utils/pay-period";
import { useNow } from "@/lib/hooks/use-now";
import { useRole } from "@/lib/rbac/use-role";
import { canManageHr } from "@/lib/rbac/roles";
import { dayKey } from "@/lib/utils/dtr";
import { daysBetween, probationMilestones, serviceMonths } from "@/lib/utils/employment";
import { formatDate } from "@/lib/utils/date";
import { EMPLOYMENT_TYPES, employeeFullName, type Employee } from "@/lib/types/hr";

const TYPE_LABEL = Object.fromEntries(EMPLOYMENT_TYPES.map((t) => [t.value, t.label]));

/**
 * The HR landing page. For everyone: their own 201 record as HR holds it,
 * with the self-service pages (payslips, leave) arriving in the next
 * phases. For admins and HR: the headcount that the law's thresholds turn
 * on, and what needs a decision soon.
 */
export default function HrPage() {
  const { role, isHr } = useRole();
  const { employees, loading, error } = useEmployees();
  const today = dayKey(useNow());
  const manages = canManageHr(role, isHr);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="HR"
        description={manages ? "Employees, pay, leave and the foundation's compliance calendar." : "Your record, payslips and leave."}
        action={<HrSubNav />}
      />

      {error ? <EmptyState title="Couldn't load HR" description={error} /> : manages ? <HrOverview employees={employees} loading={loading} today={today} /> : <MyRecord employees={employees} loading={loading} today={today} />}
    </div>
  );
}

function MyRecord({ employees, loading, today }: { employees: Employee[]; loading: boolean; today: string }) {
  // RLS returns only the caller's own row to a non-HR person.
  const me = employees[0];
  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!me) {
    return (
      <EmptyState
        title="No employee record linked to your login yet"
        description="HR keeps the 201 file. Once your record is linked to this account, it shows here along with your payslips and leave."
      />
    );
  }
  const months = serviceMonths(me.hireDate, today);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">My record</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <Item label="Employee ID" value={me.employeeCode} />
          <Item label="Position" value={me.position} />
          <Item label="Employment" value={TYPE_LABEL[me.employmentType] ?? me.employmentType} />
          <Item label="Status" value={<StatusBadge domain="employee" status={me.status} />} />
          <Item label="Date hired" value={formatDate(me.hireDate)} />
          <Item label="Length of service" value={months >= 12 ? `${Math.floor(months / 12)} yr ${months % 12} mo` : `${months} mo`} />
          {me.regularizationDate ? <Item label="Regularised" value={formatDate(me.regularizationDate)} /> : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Coming next</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
          <p>
            Your leave balances and requests are under{" "}
            <Link href="/hr/leave" className="underline">
              My Leave
            </Link>
            . Payslips arrive with the payroll release. Ask HR if anything above is wrong.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function HrOverview({ employees, loading, today }: { employees: Employee[]; loading: boolean; today: string }) {
  const { requests } = useLeaveRequests();
  const { periods } = usePayPeriods();
  const { data: schedules } = useCollection(allSchedulesStore);
  const active = employees.filter((e) => e.status === "active" || e.status === "on_leave");
  const pendingLeave = requests.filter((r) => r.status === "pending");
  const current = periods.find((p) => p.startsOn <= today && p.endsOn >= today) ?? null;
  const noSchedule = active.filter((e) => !schedules.some((s) => s.employeeId === e.id && s.effectiveFrom <= today && (s.effectiveTo === null || s.effectiveTo > today)));
  const probation = active
    .filter((e) => e.employmentType === "probationary")
    .map((e) => ({ e, ...probationMilestones(e.hireDate) }))
    .sort((a, b) => (a.endsOn < b.endsOn ? -1 : 1));
  const unlinked = active.filter((e) => !e.staffId);
  const headcount = active.length;

  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Active employees" value={loading ? "…" : headcount} icon={Users} color="blue" sublabel={headcount >= 10 ? "Service Incentive Leave applies (Art. 95)" : "Below 10: SIL exemption; VL of 5 days keeps it covered"} />
        <KpiCard label="On probation" value={loading ? "…" : probation.length} icon={UserCheck} color="amber" sublabel="Regular by law after six months (Art. 296)" />
        <KpiCard label="Without a login" value={loading ? "…" : unlinked.length} icon={KeyRound} color="slate" sublabel="Cannot see their own payslips or leave yet" />
        <KpiCard label="Separated this year" value={loading ? "…" : employees.filter((e) => e.separationDate && e.separationDate.startsWith(today.slice(0, 4))).length} icon={FileWarning} color="rose" sublabel="Final pay within 30 days (LA 06-20)" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">This pay period</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {current ? (
              <>
                <span className="font-medium">{payPeriodLabel({ year: current.year, seq: current.seq, from: current.startsOn, to: current.endsOn, isSecondCutoff: current.seq % 2 === 0 })}</span>
                <span className="text-xs text-muted-foreground">Pay date {formatDate(current.payDate)} · {current.status.replace(/_/g, " ")}</span>
                <Button asChild size="sm" variant="outline" className="w-fit">
                  <Link href={`/hr/timesheets?period=${current.id}`}>Timesheets</Link>
                </Button>
              </>
            ) : (
              <>
                <span className="text-muted-foreground">No pay period covers today.</span>
                <Button asChild size="sm" variant="outline" className="w-fit">
                  <Link href="/hr/periods">Generate the year</Link>
                </Button>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Leave to decide</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <span className="text-2xl font-bold tabular-nums">{pendingLeave.length}</span>
            <Button asChild size="sm" variant="outline" className="w-fit">
              <Link href="/hr/leave">Open leave</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Missing a schedule</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            {noSchedule.length === 0 ? (
              <span className="text-muted-foreground">Everyone has a weekly schedule.</span>
            ) : (
              noSchedule.map((e) => (
                <Link key={e.id} href={`/hr/employees/${e.id}`} className="underline-offset-2 hover:underline">
                  {employeeFullName(e)}
                </Link>
              ))
            )}
            <span className="text-xs text-muted-foreground">Without one, lateness, undertime and absences cannot be judged.</span>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Probation decisions</CardTitle>
            <CalendarClock className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {probation.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nobody is on probation.</p>
            ) : (
              probation.map(({ e, evaluateBy, endsOn }) => {
                const left = daysBetween(today, endsOn);
                return (
                  <Link key={e.id} href={`/hr/employees/${e.id}`} className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm hover:bg-accent/40">
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{employeeFullName(e)}</span>
                      <span className="text-xs text-muted-foreground">
                        {e.position} · evaluate by {formatDate(evaluateBy, "MMM d")} · ends {formatDate(endsOn)}
                      </span>
                    </div>
                    <StatusBadge domain="deadline" status={left < 0 ? "overdue" : left <= 30 ? "due_soon" : "ok"} label={left < 0 ? `${-left} d past` : `${left} d left`} />
                  </Link>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Employees</CardTitle>
            <Button asChild size="sm" variant="outline">
              <Link href="/hr/employees">
                All employees
                <ArrowRight />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : active.length === 0 ? (
              <p className="text-sm text-muted-foreground">No employees on file yet — add one, or run the 201 import.</p>
            ) : (
              active.slice(0, 8).map((e) => (
                <Link key={e.id} href={`/hr/employees/${e.id}`} className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm hover:bg-accent/40">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">{employeeFullName(e)}</span>
                    <span className="text-xs text-muted-foreground">
                      {e.position} · {TYPE_LABEL[e.employmentType]}
                    </span>
                  </div>
                  {!e.staffId ? <StatusBadge domain="employee" status="unlinked" label="No login" /> : null}
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
