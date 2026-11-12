"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Download, ListTree, Printer, Wallet } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { LoadingState } from "@/components/patterns/loading-state";
import { SectionCard } from "@/components/patterns/section-card";
import { PeriodPresetsBar, usePeriodPresets } from "@/components/patterns/period-presets";
import { ClearFilters, FilterSelect, useFilters } from "@/components/patterns/filters";
import { QuickBooksExport } from "@/components/modules/requests/quickbooks-export";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useVouchers, type Voucher, type VoucherLine } from "@/lib/hooks/use-vouchers";
import { useSetupRows } from "@/lib/hooks/use-finance-setup";
import { useStaffRoster } from "@/lib/hooks/use-staff-roster";
import { useRole } from "@/lib/rbac/use-role";
import { holdsPower } from "@/lib/rbac/roles";
import { optionsOf } from "@/lib/utils/filters";
import { csvLines, downloadCsv } from "@/lib/utils/csv";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate, todayIso } from "@/lib/utils/date";
import { KIND_LABEL, settledAdvances, STATUS_LABEL } from "@/lib/utils/vouchers";
import { BASIS_LABEL, ledgerDay, ledgerTotals, STAGE_LABEL, STAGES, stageOf, type Basis, type Stage } from "@/lib/utils/voucher-ledger";

const peso = (n: number) => formatCurrency(n, "PHP", true);
const STATE_LABEL: Record<string, string> = { paid: "Paid", unpaid: "Not paid yet", exported: "Exported to QuickBooks", not_exported: "Paid, not exported", matched: "Matched to the bank", unmatched: "Paid, not matched to the bank" };
type Row = { v: Voucher; l: VoucherLine; stage: Stage; day: string | null };

export default function LedgerPage() {
  return (
    <React.Suspense fallback={<LoadingState />}>
      <LedgerContent />
    </React.Suspense>
  );
}

/**
 * Financial › Ledger (0140): every request and voucher by its coded items, from the request to the payment, for
 * Finance (the CEO and the Trustees view it). By account, like a general ledger, or item by item; filtered by
 * stage, account or its heading, cost center, program, fund, employee, payee, dates on the chosen basis and more.
 */
function LedgerContent() {
  const router = useRouter();
  const { roles } = useRole();
  const { vouchers, lines, events, loading } = useVouchers();
  const { data: codes } = useSetupRows("fin_codes");
  const { data: accounts } = useSetupRows("coa_accounts");
  const { data: payees } = useSetupRows("payees");
  const { staff } = useStaffRoster();
  const period = usePeriodPresets("ledger", "this_month", true);
  const [view, setView] = React.useState<"summary" | "accounts" | "items">("accounts");
  const [basis, setBasis] = React.useState<Basis>("voucher");
  const [query, setQuery] = React.useState("");
  const [minAmount, setMinAmount] = React.useState("");
  const [maxAmount, setMaxAmount] = React.useState("");
  const [exporting, setExporting] = React.useState(false);
  const f = useFilters("stage", "account", "group", "t1", "t3", "t2", "t4", "type", "kind", "payto", "requester", "state", "source");

  const name = (id: string | null) => {
    const s = id ? staff.find((x) => x.id === id) : null;
    return s ? `${s.firstName} ${s.lastName}` : "";
  };
  const code = (id: unknown) => String(codes.find((c) => c.id === id)?.code ?? "");
  const account = (id: unknown) => accounts.find((a) => a.id === id);
  const accountName = (id: string | null, legacy: string | null) => [account(id)?.code ?? legacy, account(id)?.name].filter(Boolean).join(" ") || "Uncoded";
  const groupOf = (id: unknown) => String(account(account(id)?.parent_id)?.code ?? "");
  // Who is paid: the person, the supplier Finance linked, the register's payee, else the requester (their own advance or reimbursement).
  const payeeName = React.useMemo(() => new Map(payees.map((p) => [String(p.id), String(p.name)])), [payees]);
  const payTo = (v: Voucher) => (v.toPerson ? v.recipientName : null) ?? (v.payeeId ? payeeName.get(v.payeeId) : undefined) ?? v.payeeText ?? name(v.requestedBy);
  const states = (v: Voucher) =>
    v.status === "released" ? ["paid", v.exportedAt ? "exported" : "not_exported", v.bankTransactionId ? "matched" : "unmatched"] : ["unpaid"];
  const eventsOf = React.useMemo(() => {
    const m = new Map<string, typeof events>();
    for (const e of events) (m.get(e.voucherId) ?? m.set(e.voucherId, []).get(e.voucherId)!).push(e);
    return m;
  }, [events]);

  const all: Row[] = React.useMemo(() => {
    const byId = new Map(vouchers.map((v) => [v.id, v]));
    return lines.flatMap((l) => {
      const v = byId.get(l.voucherId);
      const stage = v ? stageOf(v.status) : null;
      return v && stage ? [{ v, l, stage, day: ledgerDay(basis, v, eventsOf.get(v.id) ?? []) }] : [];
    });
  }, [vouchers, lines, basis, eventsOf]);

  // Spending counted once: a top-up refills what its slips spent, and an advance gives way to its liquidation once
  // that counts. Both show when their kind is picked.
  const settled = React.useMemo(() => settledAdvances(vouchers), [vouchers]);
  const w = period.window;
  const q = query.trim().toLowerCase();
  const min = Number(minAmount) || 0;
  const max = maxAmount ? Number(maxAmount) : Infinity;
  const shown = React.useMemo(() => all.filter(({ v, l, stage, day }) =>
    (f.values.stage === "all" ? stage !== "stopped" : stage === f.values.stage) &&
    (f.values.kind === "all" ? v.kind !== "fund_topup" && !(v.kind === "cash_advance" && settled.has(v.id)) : v.kind === f.values.kind) &&
    l.amount >= min &&
    l.amount <= max &&
    (!w || (!!day && day >= w.from && day <= w.to)) &&
    f.ok("account", l.accountId) &&
    f.ok("group", groupOf(l.accountId)) &&
    f.ok("t1", l.t1Id) &&
    f.ok("t3", l.t3Id) &&
    f.ok("t2", v.t2Id ?? "none") &&
    f.ok("t4", v.t4Code) &&
    f.ok("type", v.voucherType ?? "none") &&
    f.ok("payto", payTo(v)) &&
    f.ok("requester", v.requestedBy) &&
    (f.values.state === "all" || states(v).includes(f.values.state)) &&
    f.ok("source", v.source) &&
    (!q || [v.requestNumber, v.voucherNumber, v.legacyNumber, v.purpose, l.description, l.orNumber, v.payReference, l.legacyCode].some((x) => x?.toLowerCase().includes(q)))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the helpers read accounts, payees and staff, listed here
  ), [all, f.values, w, q, min, max, settled, payeeName, accounts, staff]);
  const sum = ledgerTotals(shown.map((r) => r.l));
  const sections = React.useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of shown) {
      const key = r.l.accountId ?? r.l.legacyCode ?? "";
      (m.get(key) ?? m.set(key, []).get(key)!).push(r);
    }
    return [...m.values()].sort((a, b) => accountName(a[0].l.accountId, a[0].l.legacyCode).localeCompare(accountName(b[0].l.accountId, b[0].l.legacyCode)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- accountName reads accounts, listed here
  }, [shown, accounts]);

  const opt = {
    stage: STAGES.map((s) => ({ value: s.key, label: s.label })),
    account: optionsOf(all, (r) => r.l.accountId, (id) => accountName(id, null)),
    group: optionsOf(all, (r) => groupOf(r.l.accountId), (c) => `${c} ${String(accounts.find((a) => a.code === c)?.name ?? "")}`),
    t1: optionsOf(all, (r) => r.l.t1Id, (id) => `${code(id)} ${String(codes.find((c) => c.id === id)?.name ?? "")}`),
    t3: optionsOf(all, (r) => r.l.t3Id, (id) => `${code(id)} ${String(codes.find((c) => c.id === id)?.name ?? "")}`),
    t2: optionsOf(all, (r) => r.v.t2Id ?? "none", (id) => (id === "none" ? "Fund not chosen yet" : `${code(id)} ${String(codes.find((c) => c.id === id)?.name ?? "")}`)),
    t4: optionsOf(all, (r) => r.v.t4Code, (x) => x),
    type: optionsOf(all, (r) => r.v.voucherType ?? "none", (x) => (x === "none" ? "Not yet a voucher" : x)),
    kind: optionsOf(all, (r) => r.v.kind, (k) => KIND_LABEL[k as keyof typeof KIND_LABEL] ?? k),
    payto: optionsOf(all, (r) => payTo(r.v), (x) => x),
    requester: optionsOf(all, (r) => r.v.requestedBy, (id) => name(id) || "—"),
    state: optionsOf(all.flatMap((r) => states(r.v)), (x) => x, (x) => STATE_LABEL[x] ?? x),
    source: optionsOf(all, (r) => r.v.source, (x) => (x === "sheet" ? "From the registers" : "In the app")),
  };
  const numberOf = (v: Voucher) => v.voucherNumber ?? v.legacyNumber ?? v.requestNumber ?? "—";
  const classOf = (l: VoucherLine) => [code(l.t1Id), code(l.t3Id)].filter(Boolean).join(":");
  const fundOf = (v: Voucher) => code(v.t2Id) || "Not chosen";

  const columns: ColumnDef<Row>[] = [
    { id: "day", header: BASIS_LABEL[basis], accessorFn: (r) => r.day ?? "", cell: ({ row }) => formatDate(row.original.day) },
    { id: "number", header: "No.", accessorFn: (r) => numberOf(r.v), cell: ({ row }) => <span className="font-medium tabular-nums">{numberOf(row.original.v)}</span> },
    { id: "stage", header: "Stage", accessorFn: (r) => STAGE_LABEL[r.stage] },
    { id: "account", header: "Account", accessorFn: (r) => accountName(r.l.accountId, r.l.legacyCode) },
    { id: "class", header: "Class", accessorFn: (r) => classOf(r.l) },
    { id: "fund", header: "Fund", accessorFn: (r) => fundOf(r.v) },
    { id: "t4", header: "Employee", accessorFn: (r) => r.v.t4Code ?? "" },
    { id: "payto", header: "Pay to", accessorFn: (r) => payTo(r.v) },
    { id: "item", header: "Item", accessorFn: (r) => r.l.description, cell: ({ row }) => <span className="line-clamp-2 max-w-64">{row.original.l.description}</span> },
    { id: "gross", header: "Gross", accessorFn: (r) => r.l.amount, cell: ({ row }) => <span className="tabular-nums">{peso(row.original.l.amount)}</span> },
    { id: "net", header: "Net", accessorFn: (r) => r.l.amount - r.l.ewtAmount, cell: ({ row }) => <span className="tabular-nums">{peso(row.original.l.amount - row.original.l.ewtAmount)}</span> },
  ];

  const canExport = holdsPower(roles, "finance_export");
  function exportCsv() {
    const header = ["Stage", BASIS_LABEL[basis], "No.", "Request no.", "Voucher type", "Status", "Kind", "Account", "Account name", "Class", "Fund", "Employee", "Pay to", "Item", "OR / invoice", "Gross", "Withheld", "Net", "Source"];
    const rows = shown.map(({ v, l, stage, day }) => [
      STAGE_LABEL[stage], day ?? "", numberOf(v), v.requestNumber ?? "", v.voucherType ?? "", STATUS_LABEL[v.status], KIND_LABEL[v.kind],
      String(account(l.accountId)?.code ?? l.legacyCode ?? ""), String(account(l.accountId)?.name ?? ""), classOf(l), code(v.t2Id), v.t4Code ?? "", payTo(v), l.description, l.orNumber ?? "",
      l.amount.toFixed(2), l.ewtAmount.toFixed(2), (l.amount - l.ewtAmount).toFixed(2), v.source === "sheet" ? "Register" : "App",
    ]);
    downloadCsv(csvLines(header, rows), `ledger-${w ? `${w.from}-to-${w.to}` : "all"}.csv`);
  }

  // Print the shown vouchers together for filing (one sheet a page), up to 50 at a time.
  const printable = [...new Set(shown.map((r) => r.v.id))];
  const PRINT_MAX = 50;
  function printVouchers() {
    if (printable.length > PRINT_MAX && !confirm(`${printable.length} vouchers match; the first ${PRINT_MAX} print now. Narrow the filters for the rest.`)) return;
    window.open(`/requests/print?ids=${printable.slice(0, PRINT_MAX).join(",")}`, "_blank", "noopener");
  }

  if (loading && vouchers.length === 0) return <LoadingState />;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Ledger"
        description="Every request and voucher by its codes, from the request to the payment. Filter by account, cost center, program, fund, employee, payee and dates."
        action={
          <>
            {printable.length ? <Button variant="outline" onClick={printVouchers}><Printer /> Print vouchers ({Math.min(printable.length, PRINT_MAX)})</Button> : null}
            {canExport ? (
              <>
                <Button variant="outline" onClick={exportCsv}><Download /> CSV</Button>
                <Button variant="outline" onClick={() => setExporting(true)}><Download /> QuickBooks</Button>
              </>
            ) : null}
          </>
        }
      />
      {exporting ? <QuickBooksExport from={w?.from ?? "2000-01-01"} to={w?.to ?? todayIso()} vouchers={vouchers} open={exporting} onOpenChange={setExporting} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        <PeriodPresetsBar state={period.state} onChange={period.setState} today={period.today} allowAll years />
        <Select value={basis} onValueChange={(v) => setBasis(v as Basis)}>
          <SelectTrigger className="w-40" aria-label="Date"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(BASIS_LABEL) as Basis[]).map((b) => <SelectItem key={b} value={b}>{BASIS_LABEL[b]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <KpiGrid>
        <KpiCard label="Items" value={shown.length} sublabel={STAGES.map((s) => [s.label, shown.filter((r) => r.stage === s.key).length] as const).filter(([, n]) => n > 0).map(([l, n]) => `${n} ${l.toLowerCase()}`).join(" · ") || period.label} icon={ListTree} />
        <KpiCard label="Gross" value={peso(sum.gross)} sublabel={period.label} icon={Wallet} />
        <KpiCard label="Withheld (EWT)" value={peso(sum.ewt)} sublabel="Taken from payees" icon={Wallet} />
        <KpiCard label="Net" value={peso(sum.net)} sublabel="Paid or to pay" icon={Wallet} tone="positive" />
      </KpiGrid>

      <div className="flex flex-wrap items-center gap-2">
        <Input className="w-56" placeholder="Search number, item, OR, reference" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search" />
        <FilterSelect all="Every stage (not stopped)" value={f.values.stage} onChange={f.set("stage")} options={opt.stage} className="w-52" />
        <FilterSelect all="All accounts" value={f.values.account} onChange={f.set("account")} options={opt.account} className="w-56" />
        <FilterSelect all="All account groups" value={f.values.group} onChange={f.set("group")} options={opt.group} className="w-52" />
        <FilterSelect all="All cost centers" value={f.values.t1} onChange={f.set("t1")} options={opt.t1} />
        <FilterSelect all="All programs" value={f.values.t3} onChange={f.set("t3")} options={opt.t3} />
        <FilterSelect all="All funds" value={f.values.t2} onChange={f.set("t2")} options={opt.t2} />
        <FilterSelect all="All employees" value={f.values.t4} onChange={f.set("t4")} options={opt.t4} />
        <FilterSelect all="All voucher types" value={f.values.type} onChange={f.set("type")} options={opt.type} />
        <FilterSelect all="All spending" value={f.values.kind} onChange={f.set("kind")} options={opt.kind} className="w-48" />
        <FilterSelect all="Paid to anyone" value={f.values.payto} onChange={f.set("payto")} options={opt.payto} className="w-48" />
        <FilterSelect all="Everyone who asked" value={f.values.requester} onChange={f.set("requester")} options={opt.requester} className="w-48" />
        <FilterSelect all="Paid or not" value={f.values.state} onChange={f.set("state")} options={opt.state} className="w-52" />
        <FilterSelect all="App and registers" value={f.values.source} onChange={f.set("source")} options={opt.source} />
        <Input className="w-28" type="number" inputMode="decimal" placeholder="₱ from" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} aria-label="Item amount from" />
        <Input className="w-28" type="number" inputMode="decimal" placeholder="₱ to" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} aria-label="Item amount to" />
        <ClearFilters active={f.active + (query ? 1 : 0) + (minAmount ? 1 : 0) + (maxAmount ? 1 : 0)} onClear={() => (f.clear(), setQuery(""), setMinAmount(""), setMaxAmount(""))} />
      </div>

      <Tabs value={view} onValueChange={(v) => setView(v as "summary" | "accounts" | "items")}>
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="accounts">By account</TabsTrigger>
          <TabsTrigger value="items">All items</TabsTrigger>
        </TabsList>
      </Tabs>

      {view === "summary" ? (
        <SectionCard flush title="Totals by account" description="Pick an account to see its items.">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-theme-sm">
              <thead>
                <tr className="border-b border-border text-left text-theme-xs text-muted-foreground">
                  <th className="h-9 px-4 font-medium">Account</th>
                  <th className="h-9 px-4 text-right font-medium">Items</th>
                  <th className="h-9 px-4 text-right font-medium">Gross</th>
                  <th className="h-9 px-4 text-right font-medium">Withheld</th>
                  <th className="h-9 px-4 text-right font-medium">Net</th>
                </tr>
              </thead>
              <tbody>
                {sections.map((rows) => {
                  const t = ledgerTotals(rows.map((r) => r.l));
                  const id = rows[0].l.accountId;
                  return (
                    <tr key={id ?? rows[0].l.legacyCode ?? "none"} className={`border-b border-border last:border-0 ${id || rows[0].l.legacyCode ? "cursor-pointer hover:bg-muted/40" : ""}`}
                      onClick={() => {
                        // An account by its filter; a register line known only by its code, by the search.
                        if (id) f.set("account")(id);
                        else if (rows[0].l.legacyCode) setQuery(rows[0].l.legacyCode);
                        else return;
                        setView("accounts");
                      }}>
                      <td className="px-4 py-2 font-medium">{accountName(id, rows[0].l.legacyCode)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{rows.length}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{peso(t.gross)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{t.ewt ? peso(t.ewt) : "—"}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{peso(t.net)}</td>
                    </tr>
                  );
                })}
                {sections.length ? (
                  <tr className="border-t border-border font-semibold">
                    <td className="px-4 py-2">Total</td>
                    <td className="px-4 py-2 text-right tabular-nums">{shown.length}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{peso(sum.gross)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{peso(sum.ewt)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{peso(sum.net)}</td>
                  </tr>
                ) : (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No items match.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>
      ) : view === "items" ? (
        <DataTable columns={columns} data={shown} onRowClick={(r) => router.push(`/requests/${r.v.id}`)} emptyMessage="No items match." />
      ) : sections.length === 0 ? (
        <p className="py-8 text-center text-theme-sm text-muted-foreground">No items match.</p>
      ) : (
        sections.map((rows) => {
          const t = ledgerTotals(rows.map((r) => r.l));
          return (
            <SectionCard key={rows[0].l.accountId ?? rows[0].l.legacyCode ?? "none"} flush title={accountName(rows[0].l.accountId, rows[0].l.legacyCode)}
              actions={<span className="text-theme-sm tabular-nums">{rows.length} item{rows.length === 1 ? "" : "s"} · {peso(t.gross)}{t.ewt ? ` · net ${peso(t.net)}` : ""}</span>}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-theme-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-theme-xs text-muted-foreground">
                      <th className="h-9 px-4 font-medium">{BASIS_LABEL[basis]}</th>
                      <th className="h-9 px-4 font-medium">No.</th>
                      <th className="h-9 px-4 font-medium">Stage</th>
                      <th className="h-9 px-4 font-medium">Class</th>
                      <th className="h-9 px-4 font-medium">Fund</th>
                      <th className="h-9 px-4 font-medium">Pay to</th>
                      <th className="h-9 px-4 font-medium">Item</th>
                      <th className="h-9 px-4 text-right font-medium">Gross</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...rows].sort((a, b) => (a.day ?? "").localeCompare(b.day ?? "")).map((r) => (
                      <tr key={r.l.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                        <td className="px-4 py-2">{formatDate(r.day)}</td>
                        <td className="px-4 py-2"><Link className="font-medium tabular-nums text-primary hover:underline" href={`/requests/${r.v.id}`}>{numberOf(r.v)}</Link></td>
                        <td className="px-4 py-2">{STAGE_LABEL[r.stage]}</td>
                        <td className="px-4 py-2">{classOf(r.l) || "—"}</td>
                        <td className="px-4 py-2">{fundOf(r.v)}</td>
                        <td className="px-4 py-2">{payTo(r.v)}</td>
                        <td className="px-4 py-2"><span className="line-clamp-2 max-w-72">{r.l.description}</span></td>
                        <td className="px-4 py-2 text-right tabular-nums">{peso(r.l.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          );
        })
      )}
    </div>
  );
}
