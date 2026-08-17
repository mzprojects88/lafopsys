"use client";

import { toast } from "sonner";
import { PageHeader } from "@/components/patterns/page-header";
import { ApprovalQueue, type ApprovalQueueItem } from "@/components/patterns/approval-queue";
import { useCashEntriesData } from "@/lib/hooks/use-cash-entries-collection";
import { useProgramsData } from "@/lib/hooks/use-programs-collection";
import { formatCurrency } from "@/lib/utils/currency";

export default function ApprovalsPage() {
  const { entries, setApprovalStatus } = useCashEntriesData();
  const { programs } = useProgramsData();
  const pending = entries.filter((e) => e.approvalStatus === "pending");

  const queueItems: ApprovalQueueItem[] = pending.map((e) => ({
    id: e.id,
    title: `${e.description} — ${formatCurrency(e.amount, e.currency)}`,
    subtitle: `${e.direction === "inflow" ? "Inflow" : "Outflow"} · ${programs.find((p) => p.id === e.programId)?.name ?? e.entity}`,
  }));

  async function handleApprove(id: string, reason?: string) {
    const result = await setApprovalStatus(id, "approved");
    if (!result.ok) {
      toast.error(`Couldn't approve: ${result.error}`);
      return;
    }
    toast.success("Entry approved" + (reason ? ` — ${reason}` : ""));
  }

  async function handleReject(id: string, reason: string) {
    const result = await setApprovalStatus(id, "rejected");
    if (!result.ok) {
      toast.error(`Couldn't reject: ${result.error}`);
      return;
    }
    toast.error("Entry rejected: " + reason);
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Approvals" description="Entries above configurable thresholds require approval before posting." />
      <ApprovalQueue items={queueItems} onApprove={handleApprove} onReject={handleReject} />
    </div>
  );
}
