"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle, ChevronsUpDown, Copy } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { VoucherFiles } from "@/components/modules/requests/voucher-files";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldLabel } from "@/components/ui/field";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSetupRows } from "@/lib/hooks/use-finance-setup";
import { useStaffRoster } from "@/lib/hooks/use-staff-roster";
import { fixHistory, prepareVoucher, similarCount, useVouchers, type Voucher, type VoucherLine } from "@/lib/hooks/use-vouchers";
import { useBudgets } from "@/lib/hooks/use-budgets";
import { todayIso } from "@/lib/utils/date";
import { formatCurrency } from "@/lib/utils/currency";
import { countedDay, fundAllows, PAY_LABEL, settledAdvances } from "@/lib/utils/vouchers";

const NONE = "__none";

/** An account found by typing its code or a word of its name (polish 3: ~150 accounts are too many to scroll). */
function AccountPicker({ accounts, value, onChange, label, className }: { accounts: Record<string, unknown>[]; value: string | null; onChange: (id: string) => void; label: string; className?: string }) {
  const [open, setOpen] = React.useState(false);
  const current = accounts.find((a) => a.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" aria-label={label} className={`justify-between font-normal ${className ?? ""}`}>
          <span className="truncate">{current ? `${String(current.code)} ${String(current.name)}` : "Account"}</span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder="Code or name, e.g. 5303 or fuel" />
          <CommandList>
            <CommandEmpty>No usable account by that.</CommandEmpty>
            <CommandGroup>
              {accounts.map((a) => (
                <CommandItem key={String(a.id)} value={`${String(a.code)} ${String(a.name)}`} onSelect={() => (onChange(String(a.id)), setOpen(false))}>
                  {String(a.code)} {String(a.name)}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Finance prepares the voucher (Marivic's steps 3-4): checks the request, confirms the fund, the employee code
 * and each item's account and cost center / program, and gives it its number. The database refuses an unusable
 * account, a restricted fund paying what it may not, or someone who doesn't prepare vouchers for this amount.
 */
export function PrepareDialog({ voucher, lines, open, onOpenChange, history = false }: { voucher: Voucher; lines: VoucherLine[]; open: boolean; onOpenChange: (o: boolean) => void; /** A voucher from the registers (0136): correct its coding, nothing else. */ history?: boolean }) {
  const { data: accounts } = useSetupRows("coa_accounts");
  const { data: codes } = useSetupRows("fin_codes");
  const { data: payees } = useSetupRows("payees");
  const { data: rates } = useSetupRows("ewt_rates");
  const { staff } = useStaffRoster();
  const [payee, setPayee] = React.useState(voucher.payeeId ?? NONE);
  // 0142: Finance keeps the requester's payment method or changes it (GCash makes it a GCash Fund Voucher).
  const [payMethod, setPayMethod] = React.useState(voucher.payMethod);
  const typeOf = voucher.kind === "liquidation" ? "JV" : voucher.kind === "petty_cash" ? "PCV" : payMethod === "gcash" ? "GCV" : "PV";
  const [fund, setFund] = React.useState(voucher.t2Id ?? "");
  const [t4, setT4] = React.useState(voucher.t4StaffId ?? NONE);
  const [coding, setCoding] = React.useState(() => lines.map((l) => ({ id: l.id, account_id: l.accountId, t1_id: l.t1Id, t3_id: l.t3Id })));
  const [note, setNote] = React.useState("");
  const [similar, setSimilar] = React.useState(0);
  const [othersChecked, setOthersChecked] = React.useState(false);
  // A register voucher's flags that coding can't settle (0136): Finance checks them and says so.
  const others = voucher.cleanupReasons.filter((r) => !["no_fund", "unknown_code", "name_differs"].includes(r));
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open && !history) void similarCount(voucher.id).then(setSimilar);
  }, [open, voucher.id, history]);

  const usable = accounts.filter((a) => !a.is_header && a.active !== false && a.code && !a.review_note);
  const t1 = codes.filter((c) => c.tier === "T1" && c.active);
  const t3 = codes.filter((c) => c.tier === "T3" && c.active);
  const funds = codes.filter((c) => c.tier === "T2" && c.active);
  const chosenFund = funds.find((f) => f.id === fund);
  const set = (n: number, patch: Partial<(typeof coding)[number]>) => setCoding((c) => c.map((x, i) => (i === n ? { ...x, ...patch } : x)));
  const codeOf = (id: string | null) => String(accounts.find((a) => a.id === id)?.code ?? "");
  // Withholding (0138): the linked payee's ATC rate on each line, as the database will compute it.
  const atc = String(payees.find((p) => p.id === payee)?.ewt_atc ?? "");
  const rate = Number(rates.find((r) => r.atc === atc && r.active !== false)?.rate ?? 0);
  const withheld = lines.reduce((s, l) => s + Math.round(l.amount * rate) / 100, 0);

  // Budget left this month per program (0137): the approved budget's amounts against what other vouchers prepared
  // this month already took. Shown only once the CEO has approved the year's budget.
  const { budgets, items, values } = useBudgets();
  const { vouchers, lines: allLines, events } = useVouchers();
  const today = todayIso();
  const approved = budgets.find((b) => b.status === "approved" && b.year === Number(today.slice(0, 4)));
  const month = Number(today.slice(5, 7));
  const preparedOn = new Map(events.filter((e) => e.action === "prepare").map((e) => [e.voucherId, e.at]));
  const settled = settledAdvances(vouchers);
  const thisMonth = new Set(vouchers.filter((v) => v.id !== voucher.id && countedDay(v, preparedOn.get(v.id), settled)?.slice(0, 7) === today.slice(0, 7)).map((v) => v.id));
  const programs = [...new Set(coding.map((c) => c.t3_id).filter((x): x is string => !!x))];
  const left = approved && !history
    ? programs.map((p) => {
        const budget = items.filter((i) => i.budgetId === approved.id && i.t3Id === p).reduce((s, i) => s + (values.find((v) => v.itemId === i.id && v.month === month)?.amount ?? 0), 0);
        const used = allLines.filter((l) => thisMonth.has(l.voucherId) && l.t3Id === p).reduce((s, l) => s + l.amount, 0);
        const adds = lines.filter((_, n) => coding[n]?.t3_id === p).reduce((s, l) => s + l.amount, 0);
        return { p, budget, used, adds };
      })
    : [];

  async function prepare() {
    setBusy(true);
    if (history) {
      const r = await fixHistory(voucher.id, fund || null, coding, note, othersChecked);
      setBusy(false);
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.value ? "Corrected: cleaned up" : "Corrected; something is still to clean up");
      return void onOpenChange(false);
    }
    const r = await prepareVoucher(voucher.id, fund, t4 === NONE ? null : t4, coding, note, payee === NONE ? null : payee, payMethod);
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success(`Prepared as ${r.value}`);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{history ? `Correct the coding · ${voucher.voucherNumber}` : `Prepare the voucher · ${voucher.requestNumber}`}</DialogTitle>
          <DialogDescription>
            {history ? `From the ${voucher.voucherType} register. Correct the fund and each item's coding; amounts and the register's words stay as they are.` : <>
            Check the request and its papers, confirm the coding, then prepare: it gets its {typeOf} number and goes to the reviewer.
            The budget for the month is on <Link href="/finance/budget" className="text-primary hover:underline">Budget vs Actual</Link>.
            </>}
          </DialogDescription>
        </DialogHeader>
        {similar > 0 ? (
          <p className="flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-theme-sm">
            <AlertTriangle className="size-4 text-warning" /> {similar} other {similar === 1 ? "request looks" : "requests look"} like this one (same OR number, or same payee and amount within 30 days). Check it isn&apos;t paid twice.
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel>Fund that pays (T2)</FieldLabel>
            <Select value={fund} onValueChange={setFund}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Pick the fund" /></SelectTrigger>
              <SelectContent>
                {funds.map((f) => (
                  <SelectItem key={String(f.id)} value={String(f.id)}>{String(f.code)} · {String(f.name)}{f.restricted ? " (restricted)" : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {history ? null : (
          <Field>
            <FieldLabel>Employee (T4), for staff costs and advances</FieldLabel>
            <Select value={t4} onValueChange={setT4}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {staff.filter((s) => s.active).map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.firstName} {s.lastName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          )}
          {history || voucher.kind === "liquidation" || voucher.kind === "petty_cash" ? null : (
          <Field>
            <FieldLabel>Paid by</FieldLabel>
            <Select value={payMethod} onValueChange={(v) => setPayMethod(v as typeof payMethod)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(PAY_LABEL).map(([k, label]) => <SelectItem key={k} value={k}>{label}{k === voucher.payMethod ? " (asked)" : ""}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-theme-xs text-muted-foreground">Makes it a {typeOf === "GCV" ? "GCash Fund Voucher (GCV)" : "Payment Voucher (PV)"}.</p>
          </Field>
          )}
          {history ? null : (
          <Field className="sm:col-span-2">
            <FieldLabel>Payee for withholding (a supplier, or the person paid)</FieldLabel>
            <Select value={payee} onValueChange={setPayee}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None: nothing withheld</SelectItem>
                {payees.filter((p) => p.active !== false).map((p) => (
                  <SelectItem key={String(p.id)} value={String(p.id)}>{String(p.name)}{p.ewt_atc ? ` · ${String(p.ewt_atc)}` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-theme-xs text-muted-foreground">
              {rate ? `${atc} ${rate}%: ${formatCurrency(withheld, "PHP", true)} withheld; pays ${formatCurrency(voucher.total - withheld, "PHP", true)}.` : "No withholding: pays the full amount."}
            </p>
          </Field>
          )}
        </div>
        {left.length ? (
          <div className="flex flex-col gap-1 rounded-xl border border-border px-3 py-2 text-theme-sm">
            {left.map((x) => (
              <p key={x.p} className={x.used + x.adds > x.budget ? "text-warning-foreground" : ""}>
                {String(codes.find((c) => c.id === x.p)?.name ?? "")}: budget {formatCurrency(x.budget, "PHP", true)} this month, {formatCurrency(x.used, "PHP", true)} used; this voucher adds {formatCurrency(x.adds, "PHP", true)}{x.used + x.adds > x.budget ? " (over the budget)" : ""}.
              </p>
            ))}
          </div>
        ) : null}
        {history && others.length ? (
          <label className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-theme-sm">
            <input type="checkbox" className="mt-1" checked={othersChecked} onChange={(e) => setOthersChecked(e.target.checked)} />
            <span>Also flagged: {others.map((r) => r.replace(/_/g, " ")).join(", ")}. Tick once you have checked them against the papers.</span>
          </label>
        ) : null}
        {history ? null : (
          <details className="rounded-xl border border-border px-3 py-2 text-theme-sm" open>
            <summary className="cursor-pointer font-medium">Receipts and papers</summary>
            <div className="pt-2"><VoucherFiles voucherId={voucher.id} canAttach={false} /></div>
          </details>
        )}
        {lines.length > 1 ? (
          <Button type="button" variant="outline" size="sm" className="self-start" disabled={!coding[0]?.account_id}
            onClick={() => setCoding((c) => c.map((x) => ({ ...x, account_id: c[0].account_id, t1_id: c[0].t1_id, t3_id: c[0].t3_id })))}>
            <Copy /> Use item 1&apos;s coding for every item
          </Button>
        ) : null}
        <div className="flex flex-col gap-3">
          {lines.map((l, n) => {
            const c = coding[n];
            const blocked = chosenFund?.restricted && !fundAllows((chosenFund.account_prefixes as string[]) ?? [], codeOf(c.account_id));
            return (
              <div key={l.id} className="grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-12">
                <div className="sm:col-span-12 flex flex-wrap justify-between gap-2 text-theme-sm">
                  <span className="font-medium">{n + 1}. {l.description}{l.orNumber ? ` · OR ${l.orNumber}` : " · no OR number"}</span>
                  <span className="tabular-nums">{formatCurrency(l.amount, "PHP", true)}</span>
                </div>
                <AccountPicker accounts={usable} value={c.account_id} onChange={(v) => set(n, { account_id: v })} label={`Item ${n + 1}: account`} className="w-full sm:col-span-6" />
                <Select value={c.t1_id ?? ""} onValueChange={(v) => set(n, { t1_id: v })}>
                  <SelectTrigger className="w-full sm:col-span-3" aria-label={`Item ${n + 1}: cost center`}><SelectValue placeholder="Cost center" /></SelectTrigger>
                  <SelectContent>
                    {t1.map((x) => (
                      <SelectItem key={String(x.id)} value={String(x.id)}>{String(x.code)} · {String(x.name)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={c.t3_id ?? NONE} onValueChange={(v) => set(n, { t3_id: v === NONE ? null : v })}>
                  <SelectTrigger className="w-full sm:col-span-3" aria-label={`Item ${n + 1}: program`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No program</SelectItem>
                    {t3.map((x) => (
                      <SelectItem key={String(x.id)} value={String(x.id)}>{String(x.code)} · {String(x.name)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {blocked ? <p className="sm:col-span-12 text-theme-xs text-warning-foreground">{String(chosenFund?.name)} is restricted and may not pay for {codeOf(c.account_id)}: change the fund or the account.</p> : null}
              </div>
            );
          })}
        </div>
        <Field>
          <FieldLabel htmlFor="prep-note">Note (optional)</FieldLabel>
          <Textarea id="prep-note" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy || (!fund && !history)} onClick={() => void prepare()}>{busy ? "Saving…" : history ? "Save corrections" : "Prepare voucher"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
