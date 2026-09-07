"use client";

import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HrSubNav } from "@/components/modules/hr/hr-subnav";
import { HolidaysEditor } from "@/components/modules/hr/holidays-editor";
import { RateTablesEditor } from "@/components/modules/hr/rate-tables-editor";
import { LeaveTypesEditor } from "@/components/modules/hr/leave-types-editor";
import { DocumentTypesEditor } from "@/components/modules/hr/document-types-editor";
import { useRole } from "@/lib/rbac/use-role";
import { canManageHr } from "@/lib/rbac/roles";

/**
 * The reference data HR keeps current: the year's holidays, the government
 * tables (a new circular is a new version, never an edit of the one that
 * priced last month's payslips), leave types and the 201 checklist. The
 * foundation's own policy numbers (VL/SL days, pay dates) live under
 * Settings, admin-only.
 */
export default function HrSettingsPage() {
  const { role, isHr } = useRole();
  if (!canManageHr(role, isHr)) return <EmptyState title="HR only" description="Reference data is maintained by admins and HR." />;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="HR Settings" description="Holidays, government tables, leave types and the 201 checklist." action={<HrSubNav />} />
      <Tabs defaultValue="holidays">
        <TabsList className="flex-wrap">
          <TabsTrigger value="holidays">Holidays</TabsTrigger>
          <TabsTrigger value="rates">Government tables</TabsTrigger>
          <TabsTrigger value="leave">Leave types</TabsTrigger>
          <TabsTrigger value="documents">201 checklist</TabsTrigger>
        </TabsList>
        <TabsContent value="holidays" className="pt-4">
          <HolidaysEditor />
        </TabsContent>
        <TabsContent value="rates" className="pt-4">
          <RateTablesEditor />
        </TabsContent>
        <TabsContent value="leave" className="pt-4">
          <LeaveTypesEditor />
        </TabsContent>
        <TabsContent value="documents" className="pt-4">
          <DocumentTypesEditor />
        </TabsContent>
      </Tabs>
    </div>
  );
}
