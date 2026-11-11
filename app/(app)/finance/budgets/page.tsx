"use client";

import * as React from "react";
import { toast } from "sonner";
import { CheckCircle2, Plus } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { SectionCard } from "@/components/patterns/section-card";
import { EmptyState } from "@/components/patterns/empty-state";
import { ReasonDialog } from "@/components/patterns/reason-dialog";
import { BudgetSuggestions } from "@/components/modules/finance/budget-suggestions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { approveBudget, removeBudgetItem, reviseBudget, saveBudgetItem, startBudget, useBudgets, type BudgetItem } from "@/lib/hooks/use-budgets";
import { useSetupRows } from "@/lib/hooks/use-finance-setup";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import { useProgramImpact } from "@/lib/hooks/use-program-impact";
import { useStaffRoster } from "@/lib/hooks/use-staff-roster";
import { useVouchers } from "@/lib/hooks/use-vouchers";
import { useRole } from "@/lib/rbac/use-role";
import { MEASURES, measureTotal, spreadYear, type Measure } from "@/lib/utils/budgets";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate, todayIso } from "@/lib/utils/date";
import { countedDay, settledAdvances } from "@/lib/utils/vouchers";
import { STATUS_TONE_CLASSES } from "@/lib/utils/status-colors";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ORG = "__org";
const NONE = "__none";
const peso = (n: number) => formatCurrency(n, "PHP", true);
const num = (n: number) => n.toLocaleString("en-PH", { maximumFractionDigits: 2 });
type Draft = { id: string | null; t3: string; label: string; unit: string; measure: string; account: string; mode: "year" | "month"; yearQty: string; yearAmt: string; qty: string[]; amt: string[] };

/**
 * Financial › Budgets (0137): a year's budget by program, with the items its creator adds (people housed, meals
 * served, trips...), each with a quantity and/or an amount per month. Finance and the CEO key in a draft; only the
 * CEO approves it, which locks it; a change afterwards is a revision with a reason. Budget vs actual compares the
 * approved months with the vouchers' spending and what ArkOS counted.
 */
export default function BudgetsPage() {
  const { roles } = useRole();
  const { canEdit } = useModuleAccess();
  const editor = canEdit("finance") || roles.includes("ceo") || roles.includes("admin");
  const isCeo = roles.includes("ceo");
  const readsGoals = roles.includes("ceo") || roles.includes("admin");
  const { budgets, items, values } = useBudgets();
  const { data: codes } = useSetupRows("fin_codes");
  const { data: accounts } = useSetupRows("coa_accounts");
  const { staff } = useStaffRoster();
  const { vouchers, lines, events } = useVouchers();
  const thisYear = Number(todayIso().slice(0, 4));
  const [year, setYear] = React.useState(thisYear + 1);
  const [tab, setTab] = React.useState<"budget" | "actual">("budget");
  const [month, setMonth] = React.useState(Number(todayIso().slice(5, 7)));
  const [editing, setEditing] = React.useState<Draft | null>(null);
  const [revising, setRevising] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const ofYear = budgets.filter((b) => b.year === year);
  const draft = ofYear.find((b) => b.status === "draft");
  const approved = ofYear.find((b) => b.status === "approved");
  const shown = tab === "actual" ? approved : (draft ?? approved);
  const shownItems = items.filter((i) => i.budgetId === shown?.id).sort((a, b) => a.sort - b.sort);
  const valuesOf = (itemId: string) => Array.from({ length: 12 }, (_, m) => values.find((v) => v.itemId === itemId && v.month === m + 1) ?? { itemId, month: m + 1, quantity: null, amount: null });
  const t3 = codes.filter((c) => c.tier === "T3" && c.active);
  const programName = (id: string | null) => (id ? String(codes.find((c) => c.id === id)?.name ?? "") : "Whole foundation");
  const usable = accounts.filter((a) => !a.is_header && a.active !== false && a.code);
  const years = [...new Set([thisYear, thisYear + 1, ...budgets.map((b) => b.year)])].sort();
  const sum = (xs: (number | null)[]) => xs.reduce<number>((s, x) => s + (x ?? 0), 0);

  // Actuals for Budget vs actual: the vouchers' lines (prepared and on), by program and month of preparing; and the measures.
  const impact = useProgramImpact({ from: `${year}-01-01`, to: `${year}-12-31` }, "month");
  const preparedOn = new Map(events.filter((e) => e.action === "prepare").map((e) => [e.voucherId, e.at]));
  const settled = settledAdvances(vouchers);
  const monthOf = new Map(vouchers.map((v) => [v.id, countedDay(v, preparedOn.get(v.id), settled)]));
  const spent = (pick: (l: (typeof lines)[number]) => boolean, upTo: number, only?: number) =>
    lines.filter((l) => {
      const d = monthOf.get(l.voucherId);
      if (!d || !d.startsWith(String(year)) || !pick(l)) return false;
      const m = Number(d.slice(5, 7));
      return only ? m === only : m <= upTo;
    }).reduce((s, l) => s + l.amount, 0);
  const measureActual = (m: Measure, upTo: number, only?: number) =>
    measureTotal(impact.rows.filter((r) => r.bucket.startsWith(String(year)) && (only ? Number(r.bucket.slice(5, 7)) === only : Number(r.bucket.slice(5, 7)) <= upTo)), m);

  const open = (i: BudgetItem | null) => {
    const vs = i ? valuesOf(i.id) : [];
    setEditing({
      id: i?.id ?? null, t3: i?.t3Id ?? ORG, label: i?.label ?? "", unit: i?.unit ?? "", measure: i?.measure ?? NONE, account: i?.accountId ?? NONE, mode: i ? "month" : "year",
      yearQty: "", yearAmt: "", qty: vs.map((v) => (v.quantity == null ? "" : String(v.quantity))), amt: vs.map((v) => (v.amount == null ? "" : String(v.amount))),
    });
  };

  async function save() {
    if (!editing || !shown) return;
    if (!editing.label.trim()) return void toast.error("Name the item.");
    const months = editing.mode === "year"
      ? (() => {
          const q = editing.yearQty ? spreadYear(Number(editing.yearQty)) : null;
          const a = editing.yearAmt ? spreadYear(Number(editing.yearAmt)) : null;
          return Array.from({ length: 12 }, (_, m) => ({ quantity: q ? q[m] : null, amount: a ? a[m] : null }));
        })()
      : Array.from({ length: 12 }, (_, m) => ({ quantity: editing.qty[m] ? Number(editing.qty[m]) : null, amount: editing.amt[m] ? Number(editing.amt[m]) : null }));
    setBusy(true);
    const r = await saveBudgetItem(editing.id, {
      budgetId: shown.id, t3Id: editing.t3 === ORG ? null : editing.t3, label: editing.label.trim(), unit: editing.unit.trim() || null,
      measure: editing.measure === NONE ? null : (editing.measure as Measure), accountId: editing.account === NONE ? null : editing.account,
      sort: editing.id ? (shownItems.find((x) => x.id === editing.id)?.sort ?? 0) : shownItems.length + 1,
    }, months);
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success("Item saved");
    setEditing(null);
  }

  const groups = [...new Set(shownItems.map((i) => i.t3Id ?? ORG))];
  const name = (id: string | null) => {
    const s = id ? staff.find((x) => x.id === id) : null;
    return s ? `${s.firstName} ${s.lastName}` : "—";
  };

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Budgets"
        description="The year's budget by program: the items, with a quantity and an amount each month. Finance and the CEO key it in; only the CEO approves it. Next year's budget is due before January 1."
        action={
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-32" aria-label="Year"><SelectValue /></SelectTrigger>
            <SelectContent>
              {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
        }
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as "budget" | "actual")}>
        <TabsList>
          <TabsTrigger value="budget">Budget</TabsTrigger>
          <TabsTrigger value="actual">Budget vs actual</TabsTrigger>
        </TabsList>
      </Tabs>

      {!shown ? (
        <EmptyState
          title={tab === "actual" ? `No approved budget for ${year}` : `No budget for ${year} yet`}
          description={tab === "actual" ? "Budget vs actual compares once the CEO has approved the year's budget." : editor ? "Start it, then add the items of each program." : "Finance or the CEO keys it in."}
          action={tab === "budget" && editor ? <Button disabled={busy} onClick={async () => { setBusy(true); const r = await startBudget(year); setBusy(false); if (!r.ok) toast.error(r.error); }}><Plus /> Start the {year} budget</Button> : undefined}
        />
      ) : (
        <SectionCard
          title={<span className="flex flex-wrap items-center gap-2">{year} budget · version {shown.version}<Badge className={STATUS_TONE_CLASSES[shown.status === "approved" ? "positive" : "warning"]}>{shown.status === "approved" ? "Approved" : "Draft"}</Badge></span>}
          description={shown.status === "approved" ? `Approved by ${name(shown.approvedBy)} on ${formatDate(shown.approvedAt?.slice(0, 10))}.` : shown.revisionReason ? `A revision: ${shown.revisionReason}` : "A draft: Finance and the CEO can change it until the CEO approves it."}
          actions={
            tab === "budget" ? (
              <div className="flex flex-wrap gap-2">
                {shown.status === "draft" && readsGoals ? <BudgetSuggestions budgetId={shown.id} year={year} sortFrom={shownItems.length} /> : null}
                {shown.status === "draft" && editor ? <Button size="sm" variant="outline" onClick={() => open(null)}><Plus /> Add item</Button> : null}
                {shown.status === "draft" && isCeo ? <Button size="sm" disabled={busy} onClick={async () => { if (!confirm(`Approve the ${year} budget? It is then locked; changes become a revision.`)) return; setBusy(true); const r = await approveBudget(shown.id); setBusy(false); if (!r.ok) toast.error(r.error); else toast.success("Approved"); }}><CheckCircle2 /> Approve</Button> : null}
                {shown.status === "approved" && editor && !draft ? <Button size="sm" variant="outline" onClick={() => setRevising(true)}>Revise</Button> : null}
              </div>
            ) : (
              <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                <SelectTrigger className="w-32" aria-label="Month"><SelectValue /></SelectTrigger>
                <SelectContent>{MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
              </Select>
            )
          }
          flush
        >
          {shownItems.length === 0 ? <p className="px-5 py-6 text-center text-theme-sm text-muted-foreground">No items yet.{shown.status === "draft" && editor ? " Add the first one." : ""}</p> : null}
          {groups.map((g) => {
            const its = shownItems.filter((i) => (i.t3Id ?? ORG) === g);
            const progAmount = sum(its.flatMap((i) => valuesOf(i.id).map((v) => v.amount)));
            return (
              <div key={g} className="border-t border-border first:border-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-4 pb-2">
                  <h4 className="font-medium">{programName(g === ORG ? null : g)}</h4>
                  {tab === "budget" ? (
                    <span className="text-theme-sm tabular-nums text-muted-foreground">{peso(progAmount)} for the year</span>
                  ) : (
                    <span className="text-theme-sm tabular-nums text-muted-foreground">
                      Spent {peso(spent((l) => (g === ORG ? !l.t3Id : l.t3Id === g), month, month))} of {peso(sum(its.map((i) => valuesOf(i.id)[month - 1].amount)))} in {MONTHS[month - 1]}; {peso(spent((l) => (g === ORG ? !l.t3Id : l.t3Id === g), month))} of {peso(sum(its.flatMap((i) => valuesOf(i.id).slice(0, month).map((v) => v.amount))))} to date
                    </span>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-theme-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-theme-xs text-muted-foreground">
                        <th className="h-9 px-5 font-medium">Item</th>
                        {tab === "budget" ? (
                          <>
                            <th className="h-9 px-3 text-right font-medium">Quantity (year)</th>
                            <th className="h-9 px-3 text-right font-medium">Amount (year)</th>
                            <th className="h-9 px-3 font-medium">Compared with</th>
                          </>
                        ) : (
                          <>
                            <th className="h-9 px-3 text-right font-medium">Quantity {MONTHS[month - 1]}: budget / actual</th>
                            <th className="h-9 px-3 text-right font-medium">To date</th>
                            <th className="h-9 px-3 text-right font-medium">Amount {MONTHS[month - 1]}: budget / spent</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {its.map((i) => {
                        const vs = valuesOf(i.id);
                        const acct = accounts.find((a) => a.id === i.accountId);
                        return (
                          <tr key={i.id} className={`border-b border-border last:border-0 ${shown.status === "draft" && editor && tab === "budget" ? "cursor-pointer hover:bg-muted/40" : ""}`} onClick={() => shown.status === "draft" && editor && tab === "budget" && open(i)}>
                            <td className="px-5 py-2.5">{i.label}{i.unit ? <span className="text-theme-xs text-muted-foreground"> · {i.unit}</span> : null}</td>
                            {tab === "budget" ? (
                              <>
                                <td className="px-3 py-2.5 text-right tabular-nums">{vs.some((v) => v.quantity != null) ? num(sum(vs.map((v) => v.quantity))) : "—"}</td>
                                <td className="px-3 py-2.5 text-right tabular-nums">{vs.some((v) => v.amount != null) ? peso(sum(vs.map((v) => v.amount))) : "—"}</td>
                                <td className="px-3 py-2.5 text-theme-xs text-muted-foreground">{[i.measure ? MEASURES[i.measure].label : null, acct ? `${String(acct.code)} ${String(acct.name)}` : null].filter(Boolean).join(" · ") || "—"}</td>
                              </>
                            ) : (
                              <>
                                <td className="px-3 py-2.5 text-right tabular-nums">{vs[month - 1].quantity != null ? `${num(vs[month - 1].quantity ?? 0)} / ${i.measure ? num(measureActual(i.measure, month, month)) : "—"}` : "—"}</td>
                                <td className="px-3 py-2.5 text-right tabular-nums">{vs.some((v) => v.quantity != null) && i.measure ? `${num(sum(vs.slice(0, month).map((v) => v.quantity)))} / ${num(measureActual(i.measure, month))}` : "—"}</td>
                                <td className="px-3 py-2.5 text-right tabular-nums">{vs[month - 1].amount != null ? `${peso(vs[month - 1].amount ?? 0)} / ${i.accountId ? peso(spent((l) => l.accountId === i.accountId && (i.t3Id ? l.t3Id === i.t3Id : !l.t3Id), month, month)) : "by program"}` : "—"}</td>
                              </>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </SectionCard>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit item" : "Add item"}</DialogTitle>
          </DialogHeader>
          {editing ? (
            <div className="flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field>
                  <FieldLabel>Program</FieldLabel>
                  <Select value={editing.t3} onValueChange={(v) => setEditing((e) => (e ? { ...e, t3: v } : e))}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ORG}>Whole foundation (admin)</SelectItem>
                      {t3.map((c) => <SelectItem key={String(c.id)} value={String(c.id)}>{String(c.name)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="bi-label">Item</FieldLabel>
                  <Input id="bi-label" maxLength={160} value={editing.label} onChange={(e) => setEditing((d) => (d ? { ...d, label: e.target.value } : d))} placeholder="e.g. Patients and carers housed" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="bi-unit">Unit (for the quantity)</FieldLabel>
                  <Input id="bi-unit" maxLength={40} value={editing.unit} onChange={(e) => setEditing((d) => (d ? { ...d, unit: e.target.value } : d))} placeholder="e.g. people-nights, meals, trips" />
                </Field>
                <Field>
                  <FieldLabel>Compare the quantity with</FieldLabel>
                  <Select value={editing.measure} onValueChange={(v) => setEditing((e) => (e ? { ...e, measure: v } : e))}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Nothing counted in ArkOS</SelectItem>
                      {(Object.keys(MEASURES) as Measure[]).map((m) => <SelectItem key={m} value={m}>{MEASURES[m].label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field className="sm:col-span-2">
                  <FieldLabel>Compare the amount with an account (optional)</FieldLabel>
                  <Select value={editing.account} onValueChange={(v) => setEditing((e) => (e ? { ...e, account: v } : e))}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>The program&apos;s spending as a whole</SelectItem>
                      {usable.map((a) => <SelectItem key={String(a.id)} value={String(a.id)}>{String(a.code)} {String(a.name)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <Tabs value={editing.mode} onValueChange={(v) => setEditing((e) => (e ? { ...e, mode: v as Draft["mode"] } : e))}>
                <TabsList>
                  <TabsTrigger value="year">For the year</TabsTrigger>
                  <TabsTrigger value="month">Month by month</TabsTrigger>
                </TabsList>
              </Tabs>
              {editing.mode === "year" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="bi-yq">Quantity for the year</FieldLabel>
                    <Input id="bi-yq" type="number" inputMode="decimal" min={0} value={editing.yearQty} onChange={(e) => setEditing((d) => (d ? { ...d, yearQty: e.target.value } : d))} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="bi-ya">Amount for the year (₱)</FieldLabel>
                    <Input id="bi-ya" type="number" inputMode="decimal" min={0} value={editing.yearAmt} onChange={(e) => setEditing((d) => (d ? { ...d, yearAmt: e.target.value } : d))} />
                  </Field>
                  <FieldDescription className="sm:col-span-2">Spread evenly over the 12 months; switch to month by month to change a month. Leave one empty when it doesn&apos;t apply.</FieldDescription>
                </div>
              ) : (
                <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-x-3 gap-y-2 text-theme-sm">
                  <span />
                  <span className="text-theme-xs text-muted-foreground">Quantity</span>
                  <span className="text-theme-xs text-muted-foreground">Amount (₱)</span>
                  {MONTHS.map((m, i) => (
                    <React.Fragment key={m}>
                      <span className="w-10 font-medium">{m}</span>
                      <Input type="number" inputMode="decimal" min={0} aria-label={`${m} quantity`} value={editing.qty[i] ?? ""} onChange={(e) => setEditing((d) => (d ? { ...d, qty: Object.assign([...d.qty], { [i]: e.target.value }) } : d))} />
                      <Input type="number" inputMode="decimal" min={0} aria-label={`${m} amount`} value={editing.amt[i] ?? ""} onChange={(e) => setEditing((d) => (d ? { ...d, amt: Object.assign([...d.amt], { [i]: e.target.value }) } : d))} />
                    </React.Fragment>
                  ))}
                </div>
              )}
            </div>
          ) : null}
          <DialogFooter className="gap-2">
            {editing?.id ? (
              <Button variant="ghost" className="mr-auto text-destructive" disabled={busy} onClick={async () => {
                if (!editing.id || !confirm("Remove this item?")) return;
                const r = await removeBudgetItem(editing.id);
                if (!r.ok) return void toast.error(r.error);
                setEditing(null);
              }}>Remove</Button>
            ) : null}
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReasonDialog
        open={revising}
        onOpenChange={setRevising}
        title={`Revise the ${year} budget`}
        description="A new draft version is made from the approved one; the approved version stands until the CEO approves the revision."
        confirmLabel="Start the revision"
        requireReason
        onConfirm={async (reason) => {
          setRevising(false);
          const r = approved ? await reviseBudget(approved.id, reason) : null;
          if (r && !r.ok) toast.error(r.error);
        }}
      />
    </div>
  );
}
