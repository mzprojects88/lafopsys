"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Inbox, CheckCircle2, Clock, XCircle, BedDouble, Building2 } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { BoardColumns, type BoardColumn } from "@/components/patterns/board-columns";
import { ReasonDialog } from "@/components/patterns/reason-dialog";
import { CheckInDialog } from "@/components/modules/patients/check-in-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { hospitals } from "@/lib/mock-data";
import { useReferralsData } from "@/lib/hooks/use-referrals-collection";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import type { Referral, ReferralStatus } from "@/lib/types/patient";
import { formatDate } from "@/lib/utils/date";
import type { LucideIcon } from "lucide-react";

const STATUSES: { id: ReferralStatus; title: string; icon: LucideIcon }[] = [
  { id: "submitted", title: "Submitted", icon: Inbox },
  { id: "approved", title: "Approved", icon: CheckCircle2 },
  { id: "waitlisted", title: "Waitlisted", icon: Clock },
  { id: "declined", title: "Declined", icon: XCircle },
  { id: "admitted", title: "Admitted", icon: BedDouble },
];

export default function ReferralsPage() {
  const { referrals, updateReferral } = useReferralsData();
  const canEdit = useModuleAccess().canEdit("patients");
  const [declineTarget, setDeclineTarget] = React.useState<string | null>(null);
  const [arrivalTarget, setArrivalTarget] = React.useState<string | null>(null);

  const columns: BoardColumn<Referral>[] = STATUSES.map((s) => ({
    id: s.id,
    title: s.title,
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
          canEdit && (
            <Button asChild>
              <Link href="/patients/admit">
                <Plus />
                New Referral
              </Link>
            </Button>
          )
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
                  <span className="text-theme-sm font-medium">{r.patientName}</span>
                  <span className="text-theme-xs text-muted-foreground">{r.referringPerson}</span>
                </div>
                {hospital && (
                  <span className="flex w-fit items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-theme-xs font-medium text-muted-foreground">
                    <Building2 className="size-3" />
                    {hospital.code}
                  </span>
                )}
                <div className="flex items-center justify-between gap-2 text-theme-xs text-muted-foreground">
                  <span>{r.department}</span>
                  <span>{formatDate(r.date)}</span>
                </div>
                {r.urgency !== "routine" && (
                  <span className="w-fit rounded-full bg-destructive/10 px-2 py-0.5 text-theme-xs font-medium text-destructive dark:bg-destructive/15">
                    {r.urgency}
                  </span>
                )}
                {r.reason && <span className="text-theme-xs italic text-muted-foreground">{r.reason}</span>}
                {canEdit && r.status === "submitted" && (
                  <div className="flex gap-1.5 pt-1">
                    <Button size="xs" className="flex-1" onClick={() => setStatus(r.id, "approved")}>
                      Approve
                    </Button>
                    <Button size="xs" variant="outline" className="flex-1" onClick={() => setStatus(r.id, "waitlisted")}>
                      Waitlist
                    </Button>
                    <Button size="xs" variant="destructive" className="flex-1" onClick={() => setDeclineTarget(r.id)}>
                      Decline
                    </Button>
                  </div>
                )}
                {canEdit && r.status === "approved" && (
                  <div className="flex gap-1.5 pt-1">
                    <Button size="xs" className="flex-1" onClick={() => setArrivalTarget(r.id)}>
                      <BedDouble />
                      Check in
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

      <CheckInDialog
        key={arrivalReferral?.id}
        target={arrivalReferral ? { referral: arrivalReferral } : null}
        onOpenChange={(open) => !open && setArrivalTarget(null)}
      />
    </div>
  );
}
