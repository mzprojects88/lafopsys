"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Inbox, CheckCircle2, Clock, XCircle, BedDouble, Building2 } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { BoardColumns, type BoardColumn } from "@/components/patterns/board-columns";
import { ReasonDialog } from "@/components/patterns/reason-dialog";
import { ConfirmArrivalDialog } from "@/components/modules/patients/confirm-arrival-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { hospitals } from "@/lib/mock-data";
import { useReferralsData } from "@/lib/hooks/use-referrals-collection";
import type { Referral, ReferralStatus } from "@/lib/types/patient";
import type { CategoryColor } from "@/lib/utils/category-colors";
import { formatDate } from "@/lib/utils/date";
import { TODAY_ISO } from "@/lib/utils/seeded-random";
import type { LucideIcon } from "lucide-react";

const STATUSES: { id: ReferralStatus; title: string; color: CategoryColor; icon: LucideIcon }[] = [
  { id: "submitted", title: "Submitted", color: "blue", icon: Inbox },
  { id: "approved", title: "Approved", color: "green", icon: CheckCircle2 },
  { id: "waitlisted", title: "Waitlisted", color: "amber", icon: Clock },
  { id: "declined", title: "Declined", color: "red", icon: XCircle },
  { id: "admitted", title: "Admitted", color: "indigo", icon: BedDouble },
];

export default function ReferralsPage() {
  const { referrals, updateReferral } = useReferralsData();
  const [declineTarget, setDeclineTarget] = React.useState<string | null>(null);
  const [arrivalTarget, setArrivalTarget] = React.useState<string | null>(null);

  const columns: BoardColumn<Referral>[] = STATUSES.map((s) => ({
    id: s.id,
    title: s.title,
    color: s.color,
    icon: s.icon,
    items: referrals.filter((r) => r.status === s.id),
  }));

  async function setStatus(id: string, status: ReferralStatus, reason?: string) {
    const result = await updateReferral(id, { status, reason });
    if (!result.ok) {
      toast.error(`Couldn't update the referral: ${result.error}`);
      return;
    }
    toast.success(`Referral marked ${status}`);
  }

  const arrivalReferral = referrals.find((r) => r.id === arrivalTarget) ?? null;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Referrals"
        description="Partner hospital referral intake — approve, waitlist, decline, or confirm arrival with reason captured."
        action={
          <Button asChild>
            <Link href="/patients/referrals/new">
              <Plus />
              New Referral
            </Link>
          </Button>
        }
      />

      <BoardColumns
        columns={columns}
        className="sm:grid-cols-2 lg:grid-cols-5"
        getItemKey={(r) => r.id}
        renderItem={(r) => {
          const hospital = r.hospitalId ? hospitals.find((h) => h.id === r.hospitalId) : undefined;
          return (
            <Card>
              <CardContent className="flex flex-col gap-2 p-2.5">
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{r.patientName}</span>
                  <span className="text-xs text-muted-foreground">{r.referringPerson}</span>
                </div>
                {hospital && (
                  <span className="flex w-fit items-center gap-1 rounded-full bg-cyan-50 px-2 py-0.5 text-[10px] font-medium text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-400">
                    <Building2 className="size-3" />
                    {hospital.code}
                  </span>
                )}
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>{r.department}</span>
                  <span>{formatDate(r.date)}</span>
                </div>
                {r.urgency !== "routine" && (
                  <span className="w-fit rounded-sm bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-500/10 dark:text-red-400">
                    {r.urgency}
                  </span>
                )}
                {r.reason && <span className="text-[11px] italic text-muted-foreground">{r.reason}</span>}
                {r.status === "submitted" && (
                  <div className="flex gap-1.5 pt-1">
                    <Button size="sm" className="h-6 flex-1 text-[11px]" onClick={() => setStatus(r.id, "approved")}>
                      Approve
                    </Button>
                    <Button size="sm" variant="outline" className="h-6 flex-1 text-[11px]" onClick={() => setStatus(r.id, "waitlisted")}>
                      Waitlist
                    </Button>
                    <Button size="sm" variant="outline" className="h-6 flex-1 text-[11px] text-red-600" onClick={() => setDeclineTarget(r.id)}>
                      Decline
                    </Button>
                  </div>
                )}
                {r.status === "approved" && (
                  <div className="flex gap-1.5 pt-1">
                    <Button size="sm" className="h-6 flex-1 gap-1 text-[11px]" onClick={() => setArrivalTarget(r.id)}>
                      <BedDouble className="size-3" />
                      Confirm Arrival & Admit
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        }}
      />

      <ReasonDialog
        open={!!declineTarget}
        onOpenChange={(open) => !open && setDeclineTarget(null)}
        title="Decline referral"
        description="The decline reason is what makes unmet demand reportable to grantmakers."
        confirmLabel="Decline"
        destructive
        onConfirm={(reason) => declineTarget && setStatus(declineTarget, "declined", reason)}
      />

      <ConfirmArrivalDialog
        referral={arrivalReferral}
        onOpenChange={(open) => !open && setArrivalTarget(null)}
        onAdmitted={async (patientId) => {
          if (!arrivalTarget) return;
          const result = await updateReferral(arrivalTarget, {
            status: "admitted",
            admittedPatientId: patientId,
            admittedAt: TODAY_ISO,
          });
          if (!result.ok) {
            toast.error(`Patient admitted, but couldn't update the referral record: ${result.error}`);
            setArrivalTarget(null);
            return;
          }
          toast.success(`${arrivalReferral?.patientName} admitted to LAF House`);
          setArrivalTarget(null);
        }}
      />
    </div>
  );
}
