"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CheckCircle2, CircleDashed, Lock, LockOpen } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { SectionCard } from "@/components/patterns/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import { useBankTransactionsData } from "@/lib/hooks/use-bank-transactions-collection";
import { useStaffRoster } from "@/lib/hooks/use-staff-roster";
import { useRole } from "@/lib/rbac/use-role";
import { holdsPower } from "@/lib/rbac/roles";
import { STATUS_TONE_CLASSES } from "@/lib/utils/status-colors";
import { formatDate, todayIso } from "@/lib/utils/date";
import { cn } from "@/lib/utils";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const label = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

interface CloseRow {
  month: string;
  closed: boolean;
  closed_by: string | null;
  closed_at: string | null;
  reopened_by: string | null;
  reopened_at: string | null;
  reopen_reason: string | null;
}
interface Checklist {
  ready: boolean;
  items: { key: string; label: string; done: boolean; detail: string }[];
}

/** Where to fix each item. */
const FIX: Record<string, { href: string; label: string }> = {
  statement: { href: "/finance/bank-import", label: "Bank import" },
  purposes: { href: "/finance/bank-import", label: "What the money was spent on" },
  drivers: { href: "/executive", label: "Executive" },
  reconcile: { href: "/finance/approvals", label: "Approvals › To reconcile" },
  gifts: { href: "/donors", label: "Donors › Cash gifts" },
};

const closesStore = createCollection<CloseRow[]>({
  key: "ops.month_closes",
  empty: [],
  tables: [{ schema: "ops", table: "month_closes" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("ops").from("month_closes").select("*").order("month", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as CloseRow[];
  },
});

/**
 * Finance › Monthly close (0117): the month's checklist, answered by the records themselves, and
 * the close that locks the month's bank lines, cash gifts and summary note. The CEO, finance or
 * the Super Admin closes; the Super Admin reopens, with a reason.
 */
export default function MonthlyClosePage() {
  const { data: closes } = useCollection(closesStore);
  const { transactions } = useBankTransactionsData();
  const { staff } = useStaffRoster();
  const { roles } = useRole();
  const canClose = holdsPower(roles, "confirm_summary");
  const canReopen = roles.includes("admin");
  const nameOf = (id: string | null) => {
    const s = id ? staff.find((x) => x.id === id) : null;
    return s ? `${s.firstName} ${s.lastName}` : "—";
  };

  // Months with a statement, plus last month (the one normally being closed), newest first.
  const months = React.useMemo(() => {
    const set = new Set<string>(transactions.map((t) => t.postingDate.slice(0, 7)));
    const d = new Date(`${todayIso().slice(0, 7)}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 1);
    set.add(d.toISOString().slice(0, 7));
    for (const c of closes) set.add(c.month);
    return [...set].sort().reverse();
  }, [transactions, closes]);
  const firstOpen = months.slice().reverse().find((m) => !closes.some((c) => c.month === m && c.closed));
  const [month, setMonth] = React.useState<string | null>(null);
  const shown = month ?? firstOpen ?? months[0];
  const close = closes.find((c) => c.month === shown);

  const [check, setCheck] = React.useState<Checklist | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [reopening, setReopening] = React.useState(false);
  const [reason, setReason] = React.useState("");

  const load = React.useCallback(async () => {
    if (!shown) return;
    const { data, error } = await createClient().schema("ops").rpc("month_close_checklist", { p_month: shown });
    if (error) toast.error(error.message);
    else setCheck(data as Checklist);
  }, [shown]);
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the checklist is read from the database
    void load();
  }, [load, transactions]);

  async function doClose() {
    setBusy(true);
    const { error } = await createClient().schema("ops").rpc("close_month", { p_month: shown });
    setBusy(false);
    if (error) return void toast.error(error.message);
    await closesStore.refetch();
    toast.success(`${label(shown)} is closed`);
  }

  async function doReopen() {
    setBusy(true);
    const { error } = await createClient().schema("ops").rpc("reopen_month", { p_month: shown, p_reason: reason });
    setBusy(false);
    if (error) return void toast.error(error.message);
    await closesStore.refetch();
    setReopening(false);
    setReason("");
    toast.success(`${label(shown)} is open again`);
  }

  const done = check?.items.filter((i) => i.done).length ?? 0;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Monthly Close" description="Close a month once its records are complete: the bank lines, cash gifts and the summary note are then locked." />
      <SectionCard
        title={shown ? label(shown) : "No months yet"}
        description={close?.closed ? `Closed by ${nameOf(close.closed_by)} on ${formatDate(close.closed_at?.slice(0, 10))}.` : check ? `${done} of ${check.items.length} done.` : "Checking…"}
        actions={
          <div className="flex items-center gap-2">
            {close?.closed ? <Badge className={STATUS_TONE_CLASSES.positive}><Lock className="mr-1 size-3" />Closed</Badge> : <Badge className={STATUS_TONE_CLASSES.neutral}>Open</Badge>}
            <Select value={shown} onValueChange={setMonth}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                {months.map((m) => (
                  <SelectItem key={m} value={m}>
                    {label(m)}{closes.some((c) => c.month === m && c.closed) ? " · closed" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      >
        {close?.closed ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">This month&apos;s bank lines, cash gifts and Key monthly drivers can&apos;t be changed while it is closed.</p>
            {canReopen ? (
              <Button variant="outline" className="w-fit" onClick={() => setReopening(true)}>
                <LockOpen /> Reopen {MONTHS[Number(shown.slice(5, 7)) - 1]}
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {(check?.items ?? []).map((i) => (
              <div key={i.key} className="flex flex-wrap items-center gap-3 rounded-xl border border-border px-3 py-2.5">
                {i.done ? <CheckCircle2 className="size-5 text-success" /> : <CircleDashed className="size-5 text-muted-foreground" />}
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm font-medium", !i.done && "text-foreground")}>{i.label}</p>
                  <p className="text-theme-xs text-muted-foreground">{i.detail}</p>
                </div>
                {!i.done && FIX[i.key] ? (
                  <Link href={FIX[i.key].href} className="text-theme-xs font-medium text-primary hover:underline">
                    {FIX[i.key].label} →
                  </Link>
                ) : null}
              </div>
            ))}
            {canClose ? (
              <Button className="mt-2 w-fit" disabled={busy || !check?.ready} onClick={doClose}>
                <Lock /> {busy ? "Closing…" : `Close ${MONTHS[Number(shown.slice(5, 7)) - 1]}`}
              </Button>
            ) : null}
            {canClose && check && !check.ready ? <p className="text-theme-xs text-muted-foreground">Close becomes available when every item is done.</p> : null}
          </div>
        )}
        {close && !close.closed && close.reopened_at ? (
          <p className="mt-3 text-theme-xs text-muted-foreground">
            Reopened by {nameOf(close.reopened_by)} on {formatDate(close.reopened_at.slice(0, 10))}: {close.reopen_reason}
          </p>
        ) : null}
      </SectionCard>

      {closes.length > 0 ? (
        <SectionCard flush className="overflow-hidden" title="Closed months">
          <table className="w-full text-theme-sm">
            <tbody>
              {closes.map((c) => (
                <tr key={c.month} className="border-b border-border last:border-0">
                  <td className="px-5 py-2.5 font-medium">{label(c.month)}</td>
                  <td className="px-5 py-2.5 text-muted-foreground">{c.closed ? `Closed by ${nameOf(c.closed_by)} · ${formatDate(c.closed_at?.slice(0, 10))}` : `Reopened by ${nameOf(c.reopened_by)} · ${formatDate(c.reopened_at?.slice(0, 10))}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>
      ) : null}

      <Dialog open={reopening} onOpenChange={setReopening}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reopen {shown ? label(shown) : ""}</DialogTitle>
            <DialogDescription>The month&apos;s records can be changed again until it is closed once more. The reason is kept.</DialogDescription>
          </DialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={300} placeholder="e.g. A late bank adjustment for the 30th" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReopening(false)}>Cancel</Button>
            <Button disabled={busy || reason.trim().length < 5} onClick={doReopen}>{busy ? "Reopening…" : "Reopen"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
