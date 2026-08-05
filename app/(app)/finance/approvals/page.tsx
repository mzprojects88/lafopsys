"use client";

import { toast } from "sonner";
import { PageHeader } from "@/components/patterns/page-header";
import { ApprovalQueue, type ApprovalQueueItem } from "@/components/patterns/approval-queue";
import { cashEntries as seedEntries, programs } from "@/lib/mock-data";
import { useLocalCollection } from "@/lib/store/use-mock-store";
import type { CashEntry } from "@/lib/types/finance";
import { formatCurrency } from "@/lib/utils/currency";

export default function ApprovalsPage() {
  const { items, updateItem } = useLocalCollection<CashEntry>("cash-entries", seedEntries);
  const pending = items.filter((e) => e.approvalStatus === "pending");

  const queueItems: ApprovalQueueItem[] = pending.map((e) => ({
    id: e.id,
    title: `${e.description} — ${formatCurrency(e.amount, e.currency)}`,
    subtitle: `${e.direction === "inflow" ? "Inflow" : "Outflow"} · ${programs.find((p) => p.id === e.programId)?.name ?? e.entity}`,
  }));

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Approvals" description="Entries above configurable thresholds require approval before posting." />
      <ApprovalQueue
        items={queueItems}
        onApprove={(id, reason) => {
          updateItem(id, { approvalStatus: "approved" });
          toast.success("Entry approved" + (reason ? ` — ${reason}` : ""));
        }}
        onReject={(id, reason) => {
          updateItem(id, { approvalStatus: "rejected" });
          toast.error("Entry rejected: " + reason);
        }}
      />
    </div>
  );
}
