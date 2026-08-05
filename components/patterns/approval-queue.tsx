"use client";

import * as React from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ReasonDialog } from "@/components/patterns/reason-dialog";
import { EmptyState } from "@/components/patterns/empty-state";

export interface ApprovalQueueItem {
  id: string;
  title: string;
  subtitle?: string;
  meta?: React.ReactNode;
}

interface ApprovalQueueProps {
  items: ApprovalQueueItem[];
  onApprove: (id: string, reason: string) => void;
  onReject: (id: string, reason: string) => void;
  approveLabel?: string;
  rejectLabel?: string;
  emptyMessage?: string;
}

export function ApprovalQueue({
  items,
  onApprove,
  onReject,
  approveLabel = "Approve",
  rejectLabel = "Reject",
  emptyMessage = "Nothing pending approval.",
}: ApprovalQueueProps) {
  const [dialog, setDialog] = React.useState<{ id: string; action: "approve" | "reject" } | null>(null);

  if (items.length === 0) {
    return <EmptyState title="All caught up" description={emptyMessage} />;
  }

  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <Card key={item.id} className="flex-row items-center justify-between gap-3 p-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-sm font-medium">{item.title}</span>
            {item.subtitle && <span className="truncate text-xs text-muted-foreground">{item.subtitle}</span>}
            {item.meta}
          </div>
          <div className="flex shrink-0 gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500/30 dark:text-emerald-400 dark:hover:bg-emerald-500/10"
              onClick={() => setDialog({ id: item.id, action: "approve" })}
            >
              <Check className="size-3.5" />
              {approveLabel}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 border-red-200 text-red-700 hover:bg-red-50 dark:border-red-500/30 dark:text-red-400 dark:hover:bg-red-500/10"
              onClick={() => setDialog({ id: item.id, action: "reject" })}
            >
              <X className="size-3.5" />
              {rejectLabel}
            </Button>
          </div>
        </Card>
      ))}

      <ReasonDialog
        open={!!dialog}
        onOpenChange={(open) => !open && setDialog(null)}
        title={dialog?.action === "approve" ? approveLabel : rejectLabel}
        description="This reason is captured for the audit log."
        confirmLabel={dialog?.action === "approve" ? approveLabel : rejectLabel}
        destructive={dialog?.action === "reject"}
        onConfirm={(reason) => {
          if (!dialog) return;
          if (dialog.action === "approve") onApprove(dialog.id, reason);
          else onReject(dialog.id, reason);
        }}
      />
    </div>
  );
}
