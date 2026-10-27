"use client";

import * as React from "react";
import { toast } from "sonner";
import { Landmark, Pencil, Plus, Wallet } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { EmptyState } from "@/components/patterns/empty-state";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAccountsData } from "@/lib/hooks/use-accounts-collection";
import { useBankTransactionsData } from "@/lib/hooks/use-bank-transactions-collection";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate, todayIso } from "@/lib/utils/date";
import type { Account } from "@/lib/types/finance";

type Draft = Omit<Account, "id">;
const BLANK: Draft = { name: "", entity: "PH_SEC", currency: "PHP", balance: 0, type: "cash_on_hand", balanceAsOf: null };

/**
 * Finance › Accounts (0115): the foundation's bank and cash-on-hand accounts. A bank account
 * with imported statement lines shows the bank's own closing balance; a cash box shows the
 * balance finance typed and the day it was counted.
 */
export default function AccountsPage() {
  const { accounts, addAccount, updateAccount, deleteAccount } = useAccountsData();
  const { transactions } = useBankTransactionsData();
  const canEdit = useModuleAccess().canEdit("finance");
  const [editing, setEditing] = React.useState<{ id: string | null; draft: Draft } | null>(null);
  const [saving, setSaving] = React.useState(false);

  // The last statement line per account: the bank's balance and its date.
  const fromStatement = React.useMemo(() => {
    const last = new Map<string, { balance: number; asOf: string; seq: number }>();
    for (const t of transactions) {
      const prev = last.get(t.accountId);
      if (!prev || t.postingDate > prev.asOf || (t.postingDate === prev.asOf && t.rowSeq > prev.seq)) last.set(t.accountId, { balance: t.runningBalance, asOf: t.postingDate, seq: t.rowSeq });
    }
    return last;
  }, [transactions]);

  const shown = (a: Account) => {
    const s = a.type === "bank" ? fromStatement.get(a.id) : undefined;
    return s ? { balance: s.balance, asOf: s.asOf, source: "Last statement line" } : { balance: a.balance, asOf: a.balanceAsOf ?? null, source: a.type === "bank" ? "Typed (no statement imported)" : "Counted" };
  };
  const totalPhp = accounts.filter((a) => a.currency === "PHP").reduce((s, a) => s + shown(a).balance, 0);

  async function save() {
    if (!editing) return;
    const d = editing.draft;
    if (!d.name.trim()) return void toast.error("Name the account.");
    if (!Number.isFinite(d.balance)) return void toast.error("Check the balance.");
    setSaving(true);
    const draft = { ...d, name: d.name.trim(), balanceAsOf: d.type === "cash_on_hand" ? d.balanceAsOf || todayIso() : d.balanceAsOf };
    const r = editing.id ? await updateAccount(editing.id, draft) : await addAccount(draft);
    setSaving(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success(editing.id ? "Account saved" : "Account added");
    setEditing(null);
  }

  async function remove(a: Account) {
    const r = await deleteAccount(a.id);
    if (!r.ok) return void toast.error(r.error);
    toast.success(`${a.name} removed`);
  }

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setEditing((e) => (e ? { ...e, draft: { ...e.draft, [k]: v } } : e));

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Accounts"
        description="Bank and cash-on-hand balances. A bank account shows its last imported statement line; cash on hand shows what was last counted."
        action={canEdit ? <Button onClick={() => setEditing({ id: null, draft: { ...BLANK, balanceAsOf: todayIso() } })}><Plus /> Add account</Button> : null}
      />
      {accounts.length === 0 ? (
        <EmptyState title="No accounts on file" description="Add the bank and cash-on-hand accounts to see their balances here." />
      ) : (
        <>
          <KpiGrid>
            <KpiCard label="All peso accounts" value={formatCurrency(totalPhp)} icon={Landmark} />
            {accounts.map((a) => {
              const s = shown(a);
              return <KpiCard key={a.id} label={a.name} value={formatCurrency(s.balance, a.currency)} sublabel={s.asOf ? `${s.source} · ${formatDate(s.asOf)}` : s.source} icon={a.type === "bank" ? Landmark : Wallet} />;
            })}
          </KpiGrid>
          {canEdit ? (
            <div className="overflow-x-auto rounded-2xl border border-border bg-card">
              <table className="w-full min-w-[560px] text-theme-sm">
                <thead>
                  <tr className="border-b border-border text-left text-theme-xs text-muted-foreground">
                    <th className="h-10 px-4 font-medium">Account</th>
                    <th className="h-10 px-4 font-medium">Kind</th>
                    <th className="h-10 px-4 text-right font-medium">Balance</th>
                    <th className="h-10 px-4" />
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((a) => (
                    <tr key={a.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-2.5 font-medium">{a.name}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{a.type === "bank" ? "Bank" : "Cash on hand"} · {a.entity === "US_501C3" ? "US" : "PH"}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(shown(a).balance, a.currency)}</td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" aria-label={`Edit ${a.name}`} onClick={() => setEditing({ id: a.id, draft: { name: a.name, entity: a.entity, currency: a.currency, balance: a.balance, type: a.type, balanceAsOf: a.balanceAsOf ?? null } })}>
                            <Pencil className="size-3.5" />
                          </Button>
                          {!fromStatement.has(a.id) ? (
                            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void remove(a)}>
                              Remove
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit account" : "Add account"}</DialogTitle>
          </DialogHeader>
          {editing ? (
            <div className="flex flex-col gap-3">
              <Field>
                <FieldLabel htmlFor="acct-name">Name</FieldLabel>
                <Input id="acct-name" value={editing.draft.name} maxLength={80} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Petty cash, LAF House" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel htmlFor="acct-type">Kind</FieldLabel>
                  <Select value={editing.draft.type} onValueChange={(v) => set("type", v as Draft["type"])}>
                    <SelectTrigger id="acct-type" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bank">Bank</SelectItem>
                      <SelectItem value="cash_on_hand">Cash on hand</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="acct-entity">Entity</FieldLabel>
                  <Select value={editing.draft.entity} onValueChange={(v) => { set("entity", v as Draft["entity"]); set("currency", v === "US_501C3" ? "USD" : "PHP"); }}>
                    <SelectTrigger id="acct-entity" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PH_SEC">Philippines (PHP)</SelectItem>
                      <SelectItem value="US_501C3">United States (USD)</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              {editing.id && fromStatement.has(editing.id) ? (
                <p className="text-theme-xs text-muted-foreground">This account&apos;s balance comes from its imported bank statement.</p>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <Field>
                    <FieldLabel htmlFor="acct-balance">Balance</FieldLabel>
                    <Input id="acct-balance" type="number" inputMode="decimal" value={String(editing.draft.balance)} onChange={(e) => set("balance", Number(e.target.value))} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="acct-asof">Counted on</FieldLabel>
                    <Input id="acct-asof" type="date" max={todayIso()} value={editing.draft.balanceAsOf ?? ""} onChange={(e) => set("balanceAsOf", e.target.value || null)} />
                  </Field>
                </div>
              )}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
