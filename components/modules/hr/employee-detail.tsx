"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, FileBadge } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useEmployees } from "@/lib/hooks/use-employees-collection";
import { useNow } from "@/lib/hooks/use-now";
import { useRole } from "@/lib/rbac/use-role";
import { canDeleteFiles, canManageHr, canUploadFiles } from "@/lib/rbac/roles";
import { FileLibrary } from "@/components/patterns/file-library";
import { useDocumentTypes } from "@/lib/hooks/use-document-types-collection";
import { dayKey } from "@/lib/utils/dtr";
import { formatDate } from "@/lib/utils/date";
import { probationMilestones, serviceMonths } from "@/lib/utils/employment";
import { EMPLOYMENT_STATUSES, EMPLOYMENT_TYPES, employeeFullName, type Employee, type EmployeePrivate } from "@/lib/types/hr";
import { EmployeeFormDialog } from "./employee-form-dialog";
import { LinkStaffAccountDialog } from "./link-staff-account-dialog";
import { EmploymentTab } from "./employment-tab";
import { CompensationTab } from "./compensation-tab";
import { ScheduleTab } from "./schedule-tab";
import { DocumentChecklist } from "./document-checklist";
import { PrivateDetailsForm } from "./private-details-form";

const TYPE_LABEL = Object.fromEntries(EMPLOYMENT_TYPES.map((t) => [t.value, t.label]));
const STATUS_LABEL = Object.fromEntries(EMPLOYMENT_STATUSES.map((t) => [t.value, t.label]));

export function EmployeeDetail({ employeeId, privateRecord }: { employeeId: string; privateRecord: EmployeePrivate | null }) {
  const { employees, loading, error } = useEmployees();
  const { role, isHr } = useRole();
  const today = dayKey(useNow());
  const manages = canManageHr(role, isHr);
  const employee = employees.find((e) => e.id === employeeId);
  const { documentTypes } = useDocumentTypes();
  const documentTypeOptions = React.useMemo(() => [{ value: "other", label: "Other" }, ...documentTypes.filter((t) => t.active).map((t) => ({ value: t.id, label: t.name }))], [documentTypes]);

  if (error) return <EmptyState title="Couldn't load this employee" description={error} />;
  if (loading && !employee) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!employee) {
    return <EmptyState title="Not found" description="No employee record with that id, or it is not yours to see." action={<BackButton />} />;
  }

  const months = serviceMonths(employee.hireDate, today);
  const probation = employee.employmentType === "probationary" ? probationMilestones(employee.hireDate) : null;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title={employeeFullName(employee)}
        description={`${employee.employeeCode} · ${employee.position}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge dot domain="employee" status={employee.status} label={STATUS_LABEL[employee.status]} />
            <StatusBadge domain="employee" status={employee.employmentType} label={TYPE_LABEL[employee.employmentType]} />
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href={`/hr/reports/coe/${employee.id}`} target="_blank">
                <FileBadge className="size-3.5" />
                Certificate of Employment
              </Link>
            </Button>
            <BackButton />
          </div>
        }
      />

      {probation ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          On probation: evaluate by {formatDate(probation.evaluateBy)}; regular by law from {formatDate(probation.endsOn)} unless separated for failing the standards given at hiring (Art. 296).
        </p>
      ) : null}

      <Tabs defaultValue="profile">
        <TabsList className="flex-wrap">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="employment">Employment</TabsTrigger>
          <TabsTrigger value="compensation">Compensation</TabsTrigger>
          <TabsTrigger value="schedule">Schedule</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="private">IDs &amp; Bank</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="pt-4">
          <ProfileTab employee={employee} months={months} manages={manages} />
        </TabsContent>
        <TabsContent value="employment" className="pt-4">
          <EmploymentTab employee={employee} manages={manages} />
        </TabsContent>
        <TabsContent value="compensation" className="pt-4">
          <CompensationTab employee={employee} manages={manages} today={today} />
        </TabsContent>
        <TabsContent value="schedule" className="pt-4">
          <ScheduleTab employee={employee} manages={manages} />
        </TabsContent>
        <TabsContent value="documents" className="flex flex-col gap-6 pt-4">
          <DocumentChecklist employee={employee} manages={manages} today={today} />
          <FileLibrary
            recordType="employee"
            recordId={employee.id}
            subKeyOptions={documentTypeOptions}
            subKeyLabel="201 document"
            canUpload={canUploadFiles("hr", role, isHr)}
            canDelete={canDeleteFiles("hr", role, isHr)}
            title="201 files"
            description={`Scans and signed copies, kept under HR / 201 Files / ${employee.lastName}, ${employee.firstName} (${employee.employeeCode}). The employee sees their own.`}
          />
        </TabsContent>
        <TabsContent value="private" className="pt-4">
          <PrivateDetailsForm employee={employee} record={privateRecord} manages={manages} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function BackButton() {
  return (
    <Button asChild variant="outline" size="sm">
      <Link href="/hr/employees">
        <ArrowLeft />
        Employees
      </Link>
    </Button>
  );
}

function ProfileTab({ employee, months, manages }: { employee: Employee; months: number; manages: boolean }) {
  const ec = employee.emergencyContact;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Personal</CardTitle>
          {manages ? <EmployeeFormDialog employee={employee} /> : null}
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <Item label="Full name" value={[employee.firstName, employee.middleName, employee.lastName, employee.suffix].filter(Boolean).join(" ")} />
          <Item label="Employee ID" value={employee.employeeCode} />
          <Item label="Birthdate" value={employee.birthdate ? formatDate(employee.birthdate) : "—"} />
          <Item label="Sex" value={employee.sex ? employee.sex[0].toUpperCase() + employee.sex.slice(1) : "—"} />
          <Item label="Civil status" value={employee.civilStatus ?? "—"} />
          <Item label="Department" value={employee.department ?? "—"} />
          <Item label="Contact" value={employee.contactNumber ?? "—"} />
          <Item label="Email" value={employee.email ?? "—"} />
          <Item label="Address" value={employee.address ?? "—"} className="col-span-2" />
          {employee.notes ? <Item label="Notes" value={employee.notes} className="col-span-2" /> : null}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Service</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <Item label="Date hired" value={formatDate(employee.hireDate)} />
            <Item label="Length of service" value={months >= 12 ? `${Math.floor(months / 12)} yr ${months % 12} mo` : `${months} mo`} />
            <Item label="Regularised" value={employee.regularizationDate ? formatDate(employee.regularizationDate) : "—"} />
            <Item label="Separated" value={employee.separationDate ? formatDate(employee.separationDate) : "—"} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Emergency contact</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <Item label="Name" value={ec.name ?? "—"} />
            <Item label="Relationship" value={ec.relationship ?? "—"} />
            <Item label="Contact" value={ec.phone ?? "—"} />
            <Item label="Address" value={ec.address ?? "—"} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Login</CardTitle>
            {manages ? <LinkStaffAccountDialog employee={employee} /> : null}
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {employee.staffId
              ? "Linked to a staff login. They can see their own record, and later their payslips and leave, under HR."
              : "No login linked. Create the account under Settings → Users, then link it here so they can see their own record."}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function Item({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col gap-0.5 ${className ?? ""}`}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
