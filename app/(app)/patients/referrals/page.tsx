"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Inbox, CheckCircle2, Clock, XCircle } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { BoardColumns, type BoardColumn } from "@/components/patterns/board-columns";
import { ReasonDialog } from "@/components/patterns/reason-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { referrals as seedReferrals } from "@/lib/mock-data";
import { useLocalCollection } from "@/lib/store/use-mock-store";
import type { Referral, ReferralStatus } from "@/lib/types/patient";
import type { CategoryColor } from "@/lib/utils/category-colors";
import { formatDate } from "@/lib/utils/date";
import type { LucideIcon } from "lucide-react";

const STATUSES: { id: ReferralStatus; title: string; color: CategoryColor; icon: LucideIcon }[] = [
  { id: "submitted", title: "Submitted", color: "blue", icon: Inbox },
  { id: "approved", title: "Approved", color: "green", icon: CheckCircle2 },
  { id: "waitlisted", title: "Waitlisted", color: "amber", icon: Clock },
  { id: "declined", title: "Declined", color: "red", icon: XCircle },
];

export default function ReferralsPage() {
  const { items, updateItem } = useLocalCollection<Referral>("referrals", seedReferrals);
  const [declineTarget, setDeclineTarget] = React.useState<string | null>(null);

  const columns: BoardColumn<Referral>[] = STATUSES.map((s) => ({
    id: s.id,
    title: s.title,
    color: s.color,
    icon: s.icon,
    items: items.filter((r) => r.status === s.id),
  }));

  function setStatus(id: string, status: ReferralStatus, reason?: string) {
    updateItem(id, { status, reason });
    toast.success(`Referral marked ${status}`);
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Referrals"
        description="NCH referral intake — approve, waitlist, or decline with reason captured."
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
        getItemKey={(r) => r.id}
        renderItem={(r) => (
          <Card>
            <CardContent className="flex flex-col gap-2 p-2.5">
              <div className="flex flex-col">
                <span className="text-sm font-medium">{r.patientName}</span>
                <span className="text-xs text-muted-foreground">{r.referringPerson}</span>
              </div>
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
            </CardContent>
          </Card>
        )}
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
    </div>
  );
}
