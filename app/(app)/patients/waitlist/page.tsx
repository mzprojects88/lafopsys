"use client";

import { CalendarDays, Clock, Stethoscope } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { PersonAvatar, colorForName } from "@/components/patterns/person-avatar";
import { CATEGORY_COLOR_CLASSES } from "@/lib/utils/category-colors";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useReferralsData } from "@/lib/hooks/use-referrals-collection";
import { formatDate, daysUntil } from "@/lib/utils/date";
import { cn } from "@/lib/utils";

export default function WaitlistPage() {
  const { referrals, updateReferral } = useReferralsData();
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
        <div className="flex flex-col gap-3">
          {waitlisted.map((r) => {
            const waitingDays = Math.abs(daysUntil(r.date));
            const tint = CATEGORY_COLOR_CLASSES[colorForName(r.patientName)];
            return (
              <Card key={r.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
                  <div className="flex items-center gap-3.5">
                    <PersonAvatar name={r.patientName} size="lg" />
                    <div className="flex flex-col gap-1">
                      <span className="text-base font-semibold">{r.patientName}</span>
                      <span className={cn("flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", tint.bg, tint.text)}>
                        <Stethoscope className="size-3" />
                        {r.department}
                      </span>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
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
                    <span className={cn("rounded-full px-3 py-1 text-xs font-medium", tint.bg, tint.text)}>
                      {waitingDays}d wait
                    </span>
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
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
