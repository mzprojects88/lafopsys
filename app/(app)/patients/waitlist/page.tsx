"use client";

import { CalendarDays, Clock, Stethoscope } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { PersonAvatar } from "@/components/patterns/person-avatar";
import { Button } from "@/components/ui/button";
import { useReferralsData } from "@/lib/hooks/use-referrals-collection";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import { formatDate, daysUntil } from "@/lib/utils/date";

export default function WaitlistPage() {
  const { referrals, updateReferral } = useReferralsData();
  const canEdit = useModuleAccess().canEdit("patients");
  const waitlisted = referrals
    .filter((r) => r.status === "waitlisted")
    .sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Waitlist"
        description="Bed availability forecast against expected check-outs — currently invisible without this board."
      />

      {waitlisted.length === 0 ? (
        <EmptyState title="Waitlist is empty" description="No referrals are currently waitlisted." />
      ) : (
        <div className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-card">
          {waitlisted.map((r) => {
            const waitingDays = Math.abs(daysUntil(r.date));
            return (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                <div className="flex items-center gap-3.5">
                  <PersonAvatar name={r.patientName} size="lg" />
                  <div className="flex flex-col gap-1">
                    <span className="text-base font-medium text-foreground">{r.patientName}</span>
                    <span className="flex w-fit items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-theme-xs font-medium text-muted-foreground">
                      <Stethoscope className="size-3" />
                      {r.department}
                    </span>
                    <div className="flex items-center gap-3 text-theme-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <CalendarDays className="size-3.5" />
                        Referred {formatDate(r.date)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="size-3.5" />
                        Waiting {waitingDays}d
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="rounded-full bg-muted px-3 py-1 text-theme-xs font-medium text-foreground tabular-nums">
                    {waitingDays}d wait
                  </span>
                  {canEdit && (
                    <Button
                      onClick={async () => {
                        const result = await updateReferral(r.id, { status: "approved" });
                        if (!result.ok) {
                          toast.error(`Couldn't approve: ${result.error}`);
                          return;
                        }
                        toast.success(`${r.patientName} approved from waitlist`);
                      }}
                    >
                      Approve
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
