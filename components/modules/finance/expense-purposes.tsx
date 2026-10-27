"use client";

import * as React from "react";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { SectionCard } from "@/components/patterns/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { REIMBURSEMENT, useBankTransactionsData, type BankTransaction } from "@/lib/hooks/use-bank-transactions-collection";
import { formatDate } from "@/lib/utils/date";
import { STATUS_TONE_CLASSES } from "@/lib/utils/status-colors";
import { cn } from "@/lib/utils";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 });
const TH = "h-10 px-4 text-theme-xs font-medium text-muted-foreground";

interface ExecSummarySettings {
  purposes: string[];
  confirm_from: number;
}

/**
 * Bank import > What the money was spent on (0114). Each debit of a month with its purpose: the
 * app suggests one, finance confirms -- the large ones (Settings > Executive summary) are flagged
 * until confirmed. The purposes feed the month's Key monthly drivers on the Executive page.
 */
export function ExpensePurposes({ canEdit }: { canEdit: boolean }) {
  const { transactions, setPurpose } = useBankTransactionsData();
  const [settings, setSettings] = React.useState<ExecSummarySettings | null>(null);
  const [month, setMonth] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    void createClient()
      .schema("shared")
      .from("app_settings")
      .select("exec_summary")
      .eq("id", true)
      .maybeSingle()
      .then(({ data }) => setSettings((data?.exec_summary as ExecSummarySettings | null) ?? { purposes: [], confirm_from: 10000 }));
  }, []);

  const months = React.useMemo(() => [...new Set(transactions.filter((t) => t.debit > 0).map((t) => t.postingDate.slice(0, 7)))].sort().reverse(), [transactions]);
  const shown = month ?? months[0] ?? null;
  const debits = React.useMemo(() => (shown ? transactions.filter((t) => t.debit > 0 && t.postingDate.startsWith(shown)).sort((a, b) => b.debit - a.debit) : []), [transactions, shown]);
  if (!settings || !shown) return null;

  const confirmFrom = Number(settings.confirm_from) || 0;
  const untagged = debits.filter((d) => !d.purpose).length;
  const suggested = debits.filter((d) => d.purpose && !d.purposeConfirmed);
  const needLook = suggested.filter((d) => d.debit >= confirmFrom).length + debits.filter((d) => !d.purpose && d.debit >= confirmFrom).length;
  const confirmed = debits.filter((d) => d.purposeConfirmed).length;

  async function suggest() {
    setBusy(true);
    try {
      const r = (await (await fetch("/api/finance/month-drivers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ month: shown, step: "purposes" }) })).json()) as { ok: boolean; suggested?: number; error?: string };
      if (!r.ok) toast.error(r.error ?? "Couldn't suggest purposes.");
      else toast.success(`${r.suggested ?? 0} purpose${r.suggested === 1 ? "" : "s"} suggested`);
    } catch {
      toast.error("Couldn't reach the server.");
    }
    setBusy(false);
  }

  async function confirmAll() {
    setBusy(true);
    const groups = new Map<string, string[]>();
    for (const d of suggested) groups.set(d.purpose!, [...(groups.get(d.purpose!) ?? []), d.id]);
    for (const [purpose, ids] of groups) {
      const r = await setPurpose(ids, purpose, null);
      if (!r.ok) {
        toast.error(r.error);
        break;
      }
    }
    setBusy(false);
  }

  return (
    <SectionCard
      flush
      className="overflow-hidden"
      title="What the money was spent on"
      description={`Each debit's purpose feeds the month's Key monthly drivers on the Executive page. The app suggests one; confirm the large ones (from ${peso.format(confirmFrom)}, set in Settings).`}
      actions={
        <Select value={shown} onValueChange={setMonth}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {months.map((m) => (
              <SelectItem key={m} value={m}>
                {monthLabel(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 text-theme-xs text-muted-foreground">
        <span>
          {confirmed} of {debits.length} confirmed{needLook ? ` · ${needLook} large one${needLook === 1 ? "" : "s"} to look at` : ""}
        </span>
        {canEdit && untagged > 0 ? (
          <Button size="sm" variant="outline" className="h-7 gap-1.5" disabled={busy} onClick={suggest}>
            <Sparkles className="size-3.5" />
            {busy ? "Suggesting…" : `Suggest purposes (${untagged})`}
          </Button>
        ) : null}
        {canEdit && suggested.length > 0 ? (
          <Button size="sm" className="h-7" disabled={busy} onClick={confirmAll}>
            Confirm all suggestions ({suggested.length})
          </Button>
        ) : null}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-theme-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className={TH}>Date</th>
              <th className={cn(TH, "text-right")}>Amount</th>
              <th className={TH}>Bank says</th>
              <th className={TH}>Purpose</th>
            </tr>
          </thead>
          <tbody>
            {debits.map((d) => (
              <PurposeRow key={d.id} debit={d} purposes={settings.purposes} large={d.debit >= confirmFrom} canEdit={canEdit} onSet={setPurpose} />
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

function PurposeRow({ debit, purposes, large, canEdit, onSet }: { debit: BankTransaction; purposes: string[]; large: boolean; canEdit: boolean; onSet: (ids: string[], purpose: string, settles: string | null) => Promise<{ ok: true } | { ok: false; error: string }> }) {
  const [saving, setSaving] = React.useState(false);
  const status = debit.purposeConfirmed ? null : !debit.purpose ? (large ? "Needs a purpose" : "Not tagged") : large ? "Suggested · check" : "Suggested";
  const tone = debit.purposeConfirmed ? null : large ? "warning" : "neutral";
  const options = debit.purpose && !purposes.includes(debit.purpose) ? [debit.purpose, ...purposes] : purposes;

  async function save(purpose: string, settles: string | null) {
    setSaving(true);
    const r = await onSet([debit.id], purpose, settles);
    setSaving(false);
    if (!r.ok) toast.error(r.error);
  }

  return (
    <tr className="border-b border-border align-top hover:bg-muted/60">
      <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">{formatDate(debit.postingDate, "MMM d")}</td>
      <td className="px-4 py-2.5 text-right tabular-nums">{peso.format(debit.debit)}</td>
      <td className="px-4 py-2.5 text-theme-xs">{[debit.description, debit.memo].filter(Boolean).join(" · ")}</td>
      <td className="px-4 py-2.5">
        <div className="flex flex-col gap-1.5">
          {canEdit ? (
            <Select value={debit.purpose ?? ""} onValueChange={(v) => save(v, debit.settlesMonth)} disabled={saving}>
              <SelectTrigger className="h-8 w-56" aria-label="Purpose">
                <SelectValue placeholder="Choose a purpose" />
              </SelectTrigger>
              <SelectContent>
                {options.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span>{debit.purpose ?? "—"}</span>
          )}
          {debit.purpose === REIMBURSEMENT ? (
            <label className="flex items-center gap-1.5 text-theme-xs text-muted-foreground">
              Advanced in
              <Input type="month" className="h-8 w-40" value={debit.settlesMonth ?? ""} disabled={!canEdit || saving} onChange={(e) => e.target.value && save(REIMBURSEMENT, e.target.value)} />
            </label>
          ) : null}
          {status && tone ? <Badge className={cn("w-fit", STATUS_TONE_CLASSES[tone])}>{status}</Badge> : null}
        </div>
      </td>
    </tr>
  );
}
