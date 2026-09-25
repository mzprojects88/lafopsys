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
        <Card key={item.id} className="flex-row items-center justify-between gap-3 px-5 py-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-theme-sm font-medium text-foreground">{item.title}</span>
            {item.subtitle && <span className="truncate text-theme-xs text-muted-foreground">{item.subtitle}</span>}
            {item.meta}
          </div>
          <div className="flex shrink-0 gap-1.5">
            <Button
              size="sm"
              className="gap-1"
              onClick={() => setDialog({ id: item.id, action: "approve" })}
            >
              <Check className="size-3.5" />
              {approveLabel}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="gap-1"
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
