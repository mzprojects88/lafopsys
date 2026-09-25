"use client";

import * as React from "react";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/patterns/empty-state";
import { LoadingState } from "@/components/patterns/loading-state";
import { STATUS_TONE_CLASSES } from "@/lib/utils/status-colors";
import { invalidateTables, useCollection } from "@/lib/data/collection-store";
import { timeEntriesStore } from "@/lib/hooks/use-time-entries-collection";
import { correctionRequestsStore, useCorrectionRequests, type CorrectionRequest } from "@/lib/hooks/use-correction-requests";

const STATUS: Record<CorrectionRequest["status"], { label: string; className: string }> = {
  pending: { label: "Waiting", className: STATUS_TONE_CLASSES.warning },
  approved: { label: "Approved", className: STATUS_TONE_CLASSES.positive },
  rejected: { label: "Rejected", className: STATUS_TONE_CLASSES.negative },
};

const manila = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * DTR correction requests (0061/0062). Admins and HR see everyone's and
 * approve or reject; everyone else sees their own and what became of them.
 * Pending first, then the latest decisions.
 */
export function CorrectionRequestsPanel({ canDecide, myId, staffName }: { canDecide: boolean; myId: string | undefined; staffName: (id: string) => string }) {
  const { requests, loading } = useCorrectionRequests();
  const { data: entries } = useCollection(timeEntriesStore);
  const entryById = React.useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);
  const shown = [...requests].sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending") || b.createdAt.localeCompare(a.createdAt)).slice(0, 60);

  if (loading && shown.length === 0) return <LoadingState />;
  if (!loading && shown.length === 0) {
    return <EmptyState title="No correction requests" description="When someone reports a missed clock-out, it appears here for admins and HR to check." />;
  }
  return (
    <div className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
      {shown.map((r) => (
        <RequestCard key={r.id} request={r} entry={entryById.get(r.timeEntryId)} canDecide={canDecide && r.staffId !== myId} showName={canDecide} staffName={staffName} />
      ))}
    </div>
  );
}

function RequestCard({
  request: r,
  entry,
  canDecide,
  showName,
  staffName,
}: {
  request: CorrectionRequest;
  entry: { date: string; clockIn?: string | null } | undefined;
  canDecide: boolean;
  showName: boolean;
  staffName: (id: string) => string;
}) {
  const [rejecting, setRejecting] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function decide(decision: "approve" | "reject") {
    setBusy(true);
    try {
      const res = (await (
        await fetch("/api/dtr/corrections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id, decision, note }) })
      ).json()) as { ok: boolean; error?: string };
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't save the decision.");
        return;
      }
      toast.success(decision === "approve" ? "Approved; the clock-out is on the record." : "Rejected; they can ask again.");
      await Promise.all([correctionRequestsStore.refetch(), timeEntriesStore.refetch(), invalidateTables([{ schema: "ops", table: "time_punches" }])]);
    } catch {
      toast.error("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const s = STATUS[r.status];
  return (
    <div className="flex flex-col gap-2 px-5 py-3 text-theme-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          {showName ? `${staffName(r.staffId)} · ` : ""}
          {entry ? format(parseISO(entry.date), "EEE, MMM d") : "A day"}: missed clock-out
        </span>
        <Badge className={s.className}>{s.label}</Badge>
      </div>
      <span className="text-muted-foreground">
        {entry?.clockIn ? `Clocked in ${entry.clockIn} · ` : ""}says they left <b className="text-foreground">{manila(r.requestedAt)}</b> · &ldquo;{r.reason}&rdquo;
      </span>
      {r.status !== "pending" ? (
        <span className="text-theme-xs text-muted-foreground">
          {r.status === "approved" ? "Approved" : "Rejected"} by {r.decidedBy ? staffName(r.decidedBy) : "—"}
          {r.decidedAt ? `, ${manila(r.decidedAt)}` : ""}
          {r.decisionNote ? ` · ${r.decisionNote}` : ""}
        </span>
      ) : null}
      {r.status === "pending" && canDecide ? (
        rejecting ? (
          <div className="flex flex-wrap gap-2">
            <Input className="h-8 min-w-48 flex-1" placeholder="Why? They will see this." value={note} onChange={(e) => setNote(e.target.value)} />
            <Button size="sm" variant="destructive" className="h-8" disabled={busy || note.trim().length < 3} onClick={() => decide("reject")}>
              Reject
            </Button>
            <Button size="sm" variant="ghost" className="h-8" disabled={busy} onClick={() => setRejecting(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button size="sm" className="h-8 gap-1.5" disabled={busy} onClick={() => decide("approve")}>
              <Check className="size-3.5" />
              {busy ? "Saving…" : "Approve"}
            </Button>
            <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={busy} onClick={() => setRejecting(true)}>
              <X className="size-3.5" />
              Reject
            </Button>
          </div>
        )
      ) : null}
    </div>
  );
}
