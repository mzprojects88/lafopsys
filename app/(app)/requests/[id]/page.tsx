"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, CircleDashed, Clock, Printer, SkipForward } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { SectionCard } from "@/components/patterns/section-card";
import { LoadingState } from "@/components/patterns/loading-state";
import { EmptyState } from "@/components/patterns/empty-state";
import { ReasonDialog } from "@/components/patterns/reason-dialog";
import { RequestForm } from "@/components/modules/requests/request-form";
import { PrepareDialog } from "@/components/modules/requests/prepare-dialog";
import { VoucherFiles } from "@/components/modules/requests/voucher-files";
import { VoucherStatusBadge } from "@/components/modules/requests/status-badge";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { actOnVoucher, useVouchers, voucherFilesStore } from "@/lib/hooks/use-vouchers";
import { useSetupRows } from "@/lib/hooks/use-finance-setup";
import { useStaffRoster } from "@/lib/hooks/use-staff-roster";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import { useNow } from "@/lib/hooks/use-now";
import { useRole } from "@/lib/rbac/use-role";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/date";
import { durationWords, KIND_LABEL, OPEN, PAY_LABEL, trackSteps } from "@/lib/utils/vouchers";
import { cn } from "@/lib/utils";

const ACTION_WORDS: Record<string, string> = {
  submit: "sent it", skip_endorse: "Endorsement not needed", endorse: "endorsed it", prepare: "prepared the voucher", review: "reviewed it", approve: "approved it",
  return: "sent it back", reject: "rejected it", cancel: "cancelled it", history: "recorded in the register",
};
const SIGN: Record<string, { action: string; label: string }> = { endorse: { action: "endorse", label: "Endorse" }, review: { action: "review", label: "Mark reviewed" }, approve: { action: "approve", label: "Approve" } };

/**
 * One request's tracker (0134): where it is, who signed each step and when, how long each took and who it waits
 * for; its items and their coding, its papers, its full history; and, for whoever it waits for, the buttons.
 */
export default function RequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { staffId: me } = useRole();
  const { canEdit } = useModuleAccess();
  const { vouchers, lines: allLines, events: allEvents, queue, loading, linesLoading } = useVouchers();
  const { data: codes } = useSetupRows("fin_codes");
  const { data: accounts } = useSetupRows("coa_accounts");
  const { data: categories } = useSetupRows("recipient_categories");
  const { staff } = useStaffRoster();
  const [canAttach, setCanAttach] = React.useState(false);
  const [preparing, setPreparing] = React.useState(false);
  const [asking, setAsking] = React.useState<null | "return" | "reject" | "cancel">(null);
  const [busy, setBusy] = React.useState(false);
  const now = useNow().getTime();

  const v = vouchers.find((x) => x.id === id);
  const lines = allLines.filter((l) => l.voucherId === id).sort((a, b) => a.sort - b.sort);
  const events = allEvents.filter((e) => e.voucherId === id).sort((a, b) => a.at.localeCompare(b.at));

  React.useEffect(() => {
    if (!v) return;
    void createClient().schema("ops").rpc("voucher_can_attach", { p_id: v.id }).then(({ data }) => setCanAttach(Boolean(data)));
  }, [v?.id, v?.status]); // eslint-disable-line react-hooks/exhaustive-deps -- re-asked when the request moves

  // The form and the prepare dialog start from the items, so they wait for them (a blank list would be saved over them).
  if ((loading && !v) || linesLoading) return <LoadingState />;
  if (!v) return <EmptyState title="No such request" description="It doesn't exist, or it isn't one you can see." />;

  const name = (who: string | null) => {
    const s = who ? staff.find((x) => x.id === who) : null;
    return s ? `${s.firstName} ${s.lastName}` : "—";
  };
  const code = (cid: string | null) => String(codes.find((c) => c.id === cid)?.code ?? "");
  const account = (aid: string | null) => accounts.find((a) => a.id === aid);
  const mine = v.requestedBy === me;
  const editable = mine && (v.status === "draft" || v.status === "returned") && v.source === "app";
  const queued = queue.find((q) => q.voucherId === v.id)?.step ?? null;
  const waitingStep = queued === "returned" ? null : queued;
  const canCancel = OPEN.includes(v.status) || v.status === "returned" ? (mine && ["returned", "submitted", "endorsed"].includes(v.status)) || canEdit("finance") : false;
  const steps = trackSteps(v.status, events, now);

  async function act(action: string, note?: string) {
    setBusy(true);
    const r = await actOnVoucher(v!.id, action, note);
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    if (r.value === "discarded") {
      toast.success("Draft discarded");
      return void router.push("/requests");
    }
    toast.success("Done");
    void voucherFilesStore.refetch();
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title={v.voucherNumber ?? v.legacyNumber ?? v.requestNumber ?? "Draft request"}
        description={v.purpose}
        action={
          <div className="flex flex-wrap gap-2">
            {waitingStep && SIGN[waitingStep] ? <Button disabled={busy} onClick={() => void act(SIGN[waitingStep].action)}>{SIGN[waitingStep].label}</Button> : null}
            {waitingStep === "validate" ? <Button onClick={() => setPreparing(true)}>Prepare voucher</Button> : null}
            {waitingStep ? <Button variant="outline" disabled={busy} onClick={() => setAsking("return")}>Send back</Button> : null}
            {waitingStep ? <Button variant="outline" className="text-destructive" disabled={busy} onClick={() => setAsking("reject")}>Reject</Button> : null}
            {canCancel ? <Button variant="ghost" disabled={busy} onClick={() => setAsking("cancel")}>Cancel request</Button> : null}
            {mine && v.status === "draft" && !v.requestNumber ? <Button variant="ghost" className="text-destructive" disabled={busy} onClick={() => confirm("Discard this draft?") && void act("discard")}>Discard draft</Button> : null}
            {v.status !== "draft" ? (
              <Button variant="outline" onClick={() => window.open(`/requests/${v.id}/print`, "_blank", "noopener")}>
                <Printer /> Print
              </Button>
            ) : null}
          </div>
        }
      />

      <SectionCard
        title={<span className="flex flex-wrap items-center gap-2">{v.requestNumber ?? "Not sent yet"}<VoucherStatusBadge status={v.status} />{v.urgent ? <span className="text-theme-xs font-medium text-warning-foreground">Urgent: {v.urgentReason}</span> : null}</span>}
      >
        <dl className="grid gap-x-6 gap-y-2 text-theme-sm sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["Kind", KIND_LABEL[v.kind]],
            ...(v.toPerson ? [["Pay to (a person)", `${v.recipientName ?? "—"} · ${String(categories.find((c) => c.id === v.recipientCategoryId)?.name ?? "")}`]] : []),
            ["Requested by", name(v.requestedBy) !== "—" ? name(v.requestedBy) : (v.payeeText ?? "—")],
            ["Fund", code(v.t2Id) || "—"],
            ["Paid by", PAY_LABEL[v.payMethod]],
            ["Needed by", v.neededBy ? formatDate(v.neededBy) : "—"],
            ["Total", formatCurrency(v.total, "PHP", true)],
            ...(v.t4Code ? [["Employee (T4)", v.t4Code]] : []),
            ...(v.legacyLink ? [["Papers (register)", v.legacyLink]] : []),
          ].map(([k, val]) => (
            <div key={k} className="flex flex-col">
              <dt className="text-theme-xs text-muted-foreground">{k}</dt>
              <dd className="break-words font-medium">{val}</dd>
            </div>
          ))}
        </dl>
      </SectionCard>

      {editable ? (
        <>
          {v.status === "returned" ? (
            <p className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-theme-sm">
              Sent back: {events.filter((e) => e.action === "return").at(-1)?.note}. Change what is needed and send it again.
            </p>
          ) : null}
          <RequestForm key={lines.map((l) => l.id).join()} voucher={v} lines={lines} />
        </>
      ) : (
        <SectionCard title="Where it is">
          <ol className="flex flex-col">
            {steps.map((s, n) => (
              <li key={s.label} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span
                    className={cn(
                      "flex size-7 items-center justify-center rounded-full border",
                      s.state === "done" && "border-success bg-success/15 text-success",
                      s.state === "skipped" && "border-border bg-muted text-muted-foreground",
                      s.state === "current" && "border-primary bg-primary/10 text-primary",
                      s.state === "todo" && "border-border text-muted-foreground"
                    )}
                  >
                    {s.state === "done" ? <Check className="size-4" /> : s.state === "skipped" ? <SkipForward className="size-3.5" /> : s.state === "current" ? <Clock className="size-3.5" /> : <CircleDashed className="size-3.5" />}
                  </span>
                  {n < steps.length - 1 ? <span className="w-px flex-1 bg-border" /> : null}
                </div>
                <div className="pb-4 text-theme-sm">
                  <p className={cn("font-medium", s.state === "todo" && "text-muted-foreground")}>{s.label}</p>
                  {s.at ? (
                    <p className="text-theme-xs text-muted-foreground">
                      {s.actor ? `${name(s.actor)} · ` : ""}{formatDate(s.at, "MMM d, yyyy h:mm a")}{s.tookMs != null ? ` · took ${durationWords(s.tookMs)}` : ""}
                    </p>
                  ) : null}
                  {s.state === "current" ? <p className="text-theme-xs text-primary">Waiting{s.waitingMs != null ? ` ${durationWords(s.waitingMs)}` : ""}{waitingStep ? " · it waits for you" : ""}</p> : null}
                </div>
              </li>
            ))}
          </ol>
          {["returned", "rejected", "cancelled"].includes(v.status) ? (
            <p className="text-theme-sm text-muted-foreground">
              {ACTION_WORDS[events.at(-1)?.action ?? ""] ? `${name(events.at(-1)?.actor ?? null)} ${ACTION_WORDS[events.at(-1)!.action]}` : ""}{events.at(-1)?.note ? `: ${events.at(-1)?.note}` : ""}
            </p>
          ) : null}
        </SectionCard>
      )}

      {!editable ? (
        <SectionCard flush title="Items" description="Account, cost center and program as Finance coded them (or as the expense type proposed, until Finance prepares it).">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-theme-sm">
              <thead>
                <tr className="border-b border-border text-left text-theme-xs text-muted-foreground">
                  <th className="h-10 px-4 font-medium">Item</th>
                  <th className="h-10 px-4 font-medium">OR / invoice</th>
                  <th className="h-10 px-4 font-medium">Account</th>
                  <th className="h-10 px-4 font-medium">Class</th>
                  <th className="h-10 px-4 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5">{l.description}<span className="block text-theme-xs text-muted-foreground">{l.qty} × {formatCurrency(l.unitCost, "PHP", true)}</span></td>
                    <td className="px-4 py-2.5">{l.orNumber ?? "—"}</td>
                    <td className="px-4 py-2.5">{[account(l.accountId)?.code ?? l.legacyCode, account(l.accountId)?.name].filter(Boolean).join(" ") || "—"}</td>
                    <td className="px-4 py-2.5">{[code(l.t1Id), code(l.t3Id)].filter(Boolean).join(":") || "—"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(l.amount, "PHP", true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      ) : null}

      {v.status !== "draft" || v.requestNumber || mine ? (
        <SectionCard title="Receipts and papers">
          <VoucherFiles voucherId={v.id} canAttach={canAttach} />
        </SectionCard>
      ) : null}

      {events.length ? (
        <SectionCard flush title="History">
          <ul className="divide-y divide-border">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap gap-x-3 gap-y-1 px-5 py-2.5 text-theme-sm">
                <span className="tabular-nums text-muted-foreground">{formatDate(e.at, "MMM d, yyyy h:mm a")}</span>
                <span>
                  {e.action === "skip_endorse" ? ACTION_WORDS.skip_endorse : `${e.actor ? name(e.actor) : (e.signerText ?? "—")} ${ACTION_WORDS[e.action] ?? e.action}`}
                  {e.note ? `: ${e.note}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      {waitingStep === "validate" && preparing ? <PrepareDialog key={lines.map((l) => l.id).join()} voucher={v} lines={lines} open={preparing} onOpenChange={setPreparing} /> : null}
      <ReasonDialog
        open={!!asking}
        onOpenChange={(o) => !o && setAsking(null)}
        title={asking === "return" ? "Send it back to the requester" : asking === "reject" ? "Reject this request" : "Cancel this request"}
        description={asking === "return" ? "Say what needs changing; they can fix it and send it again." : "Say why. The request keeps its numbers and its history."}
        confirmLabel={asking === "return" ? "Send back" : asking === "reject" ? "Reject" : "Cancel request"}
        requireReason
        destructive={asking !== "return"}
        onConfirm={(reason) => {
          const a = asking;
          setAsking(null);
          if (a) void act(a, reason);
        }}
      />
    </div>
  );
}
