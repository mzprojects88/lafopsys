"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Clock, Download, FileCheck2, Inbox, Plus, Wallet } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { LoadingState } from "@/components/patterns/loading-state";
import { PeriodPresetsBar, usePeriodPresets } from "@/components/patterns/period-presets";
import { ClearFilters, FilterSelect, useFilters } from "@/components/patterns/filters";
import { VoucherStatusBadge } from "@/components/modules/requests/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCollection } from "@/lib/data/collection-store";
import { useVouchers, voucherFilesStore, type Voucher, type VoucherLine } from "@/lib/hooks/use-vouchers";
import { useSetupRows } from "@/lib/hooks/use-finance-setup";
import { useStaffRoster } from "@/lib/hooks/use-staff-roster";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import { useNow } from "@/lib/hooks/use-now";
import { useRole } from "@/lib/rbac/use-role";
import { holdsPower } from "@/lib/rbac/roles";
import { optionsOf, words } from "@/lib/utils/filters";
import { csvLines, downloadCsv } from "@/lib/utils/csv";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/date";
import { dayKey } from "@/lib/utils/dtr";
import { daysWaiting, KIND_LABEL, OPEN, PAY_LABEL, shownAmount, STATUS_LABEL } from "@/lib/utils/vouchers";

type Basis = "requested" | "prepared" | "approved";
const BASIS: Record<Basis, string> = { requested: "Requested on", prepared: "Voucher date", approved: "Approved on" };

export default function RequestsPage() {
  return (
    <React.Suspense fallback={<LoadingState />}>
      <RequestsContent />
    </React.Suspense>
  );
}

/**
 * Payment Requests (0134): every request and voucher the person can see (their own; Finance and the signers
 * once sent), with what waits for them, filters by transaction, code, people, dates and amounts, and a view by
 * line for spending by code. A request opens on its tracker.
 */
function RequestsContent() {
  const router = useRouter();
  const { roles } = useRole();
  const { canEdit } = useModuleAccess();
  const { vouchers, lines, events, queue, loading } = useVouchers();
  const { data: files } = useCollection(voucherFilesStore);
  const { data: codes } = useSetupRows("fin_codes");
  const { data: accounts } = useSetupRows("coa_accounts");
  const { staff } = useStaffRoster();
  const period = usePeriodPresets("requests", "this_month", true);
  const [tab, setTab] = React.useState<"waiting" | "all">("all");
  const [view, setView] = React.useState<"requests" | "lines">("requests");
  const [basis, setBasis] = React.useState<Basis>("requested");
  const [query, setQuery] = React.useState("");
  const [minAmount, setMinAmount] = React.useState("");
  const [maxAmount, setMaxAmount] = React.useState("");
  const f = useFilters("type", "kind", "status", "account", "group", "t1", "t3", "t2", "requester", "signer", "pay", "flag");
  const now = useNow().getTime();

  const name = (id: string | null) => {
    const s = id ? staff.find((x) => x.id === id) : null;
    return s ? `${s.firstName} ${s.lastName}` : "";
  };
  const code = (id: unknown) => String(codes.find((c) => c.id === id)?.code ?? "");
  const account = (id: unknown) => accounts.find((a) => a.id === id);
  const groupOf = (id: unknown) => String(account(account(id)?.parent_id)?.code ?? "");
  const waitingIds = new Set(queue.map((q) => q.voucherId));
  const linesOf = React.useMemo(() => {
    const m = new Map<string, VoucherLine[]>();
    for (const l of lines) m.set(l.voucherId, [...(m.get(l.voucherId) ?? []), l]);
    return m;
  }, [lines]);
  const eventsOf = React.useMemo(() => {
    const m = new Map<string, typeof events>();
    for (const e of events) m.set(e.voucherId, [...(m.get(e.voucherId) ?? []), e]);
    return m;
  }, [events]);
  const filesOf = new Set(files.map((x) => x.voucherId));
  const dateOf = (v: Voucher): string | null => {
    // The Manila day: a request sent at 7:30 AM on the 1st belongs to the 1st, not the 30th (UTC).
    if (basis === "requested") return dayKey(v.submittedAt ?? v.createdAt);
    const ev = (eventsOf.get(v.id) ?? []).filter((e) => e.action === (basis === "prepared" ? "prepare" : "approve")).at(-1);
    return ev ? dayKey(ev.at) : null;
  };
  const lastMove = (v: Voucher) => (eventsOf.get(v.id) ?? []).at(-1)?.at ?? v.createdAt;
  const flags = (v: Voucher) => {
    const out: string[] = [];
    if (v.urgent) out.push("urgent");
    if ((linesOf.get(v.id) ?? []).some((l) => !l.orNumber)) out.push("missing_or");
    if (!filesOf.has(v.id) && !v.legacyLink) out.push("no_attachment");
    if (v.source === "sheet") out.push("history");
    if (v.needsCleanup) out.push("needs_cleanup");
    return out;
  };
  const FLAG_LABEL: Record<string, string> = { urgent: "Urgent", missing_or: "An item without OR no.", no_attachment: "No attachment", history: "From history", needs_cleanup: "Needs clean-up" };

  // Line-level filters: a request passes when any of its lines does; with one set, its amount counts only those lines.
  const codeFilter = ["account", "group", "t1", "t3"].some((k) => f.values[k as "account"] !== "all");
  const lineOk = (l: VoucherLine) => f.ok("account", l.accountId) && f.ok("group", groupOf(l.accountId)) && f.ok("t1", l.t1Id) && f.ok("t3", l.t3Id);
  const w = period.window;
  const min = Number(minAmount) || 0;
  const max = maxAmount ? Number(maxAmount) : Infinity;
  const q = query.trim().toLowerCase();
  const shown = vouchers.filter((v) => {
    const d = dateOf(v);
    const amount = shownAmount(v.total, linesOf.get(v.id) ?? [], codeFilter ? lineOk : null);
    return (
      (tab === "all" || waitingIds.has(v.id)) &&
      // What waits for someone waits whatever its date.
      (tab === "waiting" || !w || (!!d && d >= w.from && d <= w.to)) &&
      f.ok("type", v.voucherType ?? "none") &&
      f.ok("kind", v.kind) &&
      f.ok("status", v.status) &&
      f.ok("t2", v.t2Id) &&
      f.ok("requester", v.requestedBy) &&
      f.ok("pay", v.payMethod) &&
      (f.values.signer === "all" || (eventsOf.get(v.id) ?? []).some((e) => e.actor === f.values.signer)) &&
      (f.values.flag === "all" || flags(v).includes(f.values.flag)) &&
      (!codeFilter || (linesOf.get(v.id) ?? []).some(lineOk)) &&
      amount >= min &&
      amount <= max &&
      (!q || [v.requestNumber, v.voucherNumber, v.legacyNumber, v.purpose, ...(linesOf.get(v.id) ?? []).flatMap((l) => [l.description, l.orNumber])].some((x) => x?.toLowerCase().includes(q)))
    );
  });
  const amountOf = (v: Voucher) => shownAmount(v.total, linesOf.get(v.id) ?? [], codeFilter ? lineOk : null);
  const shownLines = shown.flatMap((v) => (linesOf.get(v.id) ?? []).filter((l) => !codeFilter || lineOk(l)).map((l) => ({ v, l })));

  const total = shown.reduce((s, v) => s + amountOf(v), 0);
  const approved = shown.filter((v) => v.status === "approved").reduce((s, v) => s + amountOf(v), 0);
  const moving = shown.filter((v) => OPEN.includes(v.status));

  const opt = {
    type: optionsOf(vouchers, (v) => v.voucherType ?? "none", (x) => (x === "none" ? "Not yet a voucher" : x)),
    kind: optionsOf(vouchers, (v) => v.kind, (k) => KIND_LABEL[k as keyof typeof KIND_LABEL] ?? words(k)),
    status: optionsOf(vouchers, (v) => v.status, (s) => STATUS_LABEL[s as keyof typeof STATUS_LABEL] ?? words(s)),
    account: optionsOf(lines, (l) => l.accountId, (id) => [account(id)?.code, account(id)?.name].filter(Boolean).join(" ")),
    group: optionsOf(lines, (l) => groupOf(l.accountId), (c) => `${c} ${String(accounts.find((a) => a.code === c)?.name ?? "")}`),
    t1: optionsOf(lines, (l) => l.t1Id, (id) => code(id)),
    t3: optionsOf(lines, (l) => l.t3Id, (id) => code(id)),
    t2: optionsOf(vouchers, (v) => v.t2Id, (id) => code(id)),
    requester: optionsOf(vouchers, (v) => v.requestedBy, (id) => name(id) || "—"),
    signer: optionsOf(events, (e) => e.actor, (id) => name(id) || "—"),
    pay: optionsOf(vouchers, (v) => v.payMethod, (p) => PAY_LABEL[p] ?? p),
    flag: optionsOf(vouchers.flatMap((v) => flags(v)), (x) => x, (x) => FLAG_LABEL[x] ?? x),
  };
  const active = f.active + (minAmount ? 1 : 0) + (maxAmount ? 1 : 0);

  const numberOf = (v: Voucher) => v.voucherNumber ?? v.legacyNumber ?? v.requestNumber ?? "Draft";
  const requestColumns: ColumnDef<Voucher>[] = [
    { id: "number", header: "No.", accessorFn: numberOf, cell: ({ row }) => <span className="font-medium tabular-nums">{numberOf(row.original)}</span> },
    { id: "date", header: BASIS[basis], accessorFn: (v) => dateOf(v) ?? "", cell: ({ row }) => formatDate(dateOf(row.original)) },
    { id: "purpose", header: "For", accessorFn: (v) => v.purpose, cell: ({ row }) => <span className="line-clamp-2 max-w-72">{row.original.purpose}</span> },
    { id: "requester", header: "Requested by", accessorFn: (v) => name(v.requestedBy) || v.payeeText || "" },
    { id: "amount", header: codeFilter ? "Amount (matching items)" : "Amount", accessorFn: amountOf, cell: ({ row }) => <span className="tabular-nums">{formatCurrency(amountOf(row.original), "PHP", true)}</span> },
    { id: "status", header: "Status", accessorFn: (v) => v.status, cell: ({ row }) => <VoucherStatusBadge status={row.original.status} /> },
    {
      id: "waiting",
      header: "Waiting",
      accessorFn: (v) => (OPEN.includes(v.status) ? daysWaiting(lastMove(v), now) : -1),
      cell: ({ row }) => (OPEN.includes(row.original.status) ? `${daysWaiting(lastMove(row.original), now)} d` : "—"),
    },
  ];
  type LineRow = { v: Voucher; l: VoucherLine };
  const lineColumns: ColumnDef<LineRow>[] = [
    { id: "number", header: "No.", accessorFn: (r) => numberOf(r.v), cell: ({ row }) => <span className="font-medium tabular-nums">{numberOf(row.original.v)}</span> },
    { id: "date", header: BASIS[basis], accessorFn: (r) => dateOf(r.v) ?? "", cell: ({ row }) => formatDate(dateOf(row.original.v)) },
    { id: "item", header: "Item", accessorFn: (r) => r.l.description },
    { id: "account", header: "Account", accessorFn: (r) => [account(r.l.accountId)?.code ?? r.l.legacyCode, account(r.l.accountId)?.name].filter(Boolean).join(" ") },
    { id: "class", header: "Class", accessorFn: (r) => [code(r.l.t1Id), code(r.l.t3Id)].filter(Boolean).join(":") },
    { id: "fund", header: "Fund", accessorFn: (r) => code(r.v.t2Id) },
    { id: "amount", header: "Amount", accessorFn: (r) => r.l.amount, cell: ({ row }) => <span className="tabular-nums">{formatCurrency(row.original.l.amount, "PHP", true)}</span> },
  ];

  const canExport = holdsPower(roles, "finance_export");
  function exportCsv() {
    const header = ["No.", "Request no.", "Voucher type", BASIS[basis], "Status", "Kind", "Purpose", "Requested by", "Fund", "Item", "Account", "Account name", "Class", "OR / invoice", "Amount"];
    const rows = shownLines.map(({ v, l }) => [
      numberOf(v), v.requestNumber ?? "", v.voucherType ?? "", dateOf(v) ?? "", STATUS_LABEL[v.status], KIND_LABEL[v.kind], v.purpose, name(v.requestedBy) || v.payeeText || "", code(v.t2Id),
      l.description, String(account(l.accountId)?.code ?? l.legacyCode ?? ""), String(account(l.accountId)?.name ?? ""), [code(l.t1Id), code(l.t3Id)].filter(Boolean).join(":"), l.orNumber ?? "", l.amount.toFixed(2),
    ]);
    downloadCsv(csvLines(header, rows), `payment-requests-${w ? `${w.from}-to-${w.to}` : "all"}.csv`);
  }

  if (loading && vouchers.length === 0) return <LoadingState />;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Payment Requests"
        description="Ask for a payment, a reimbursement or a cash advance and follow it to approval. Signers find what waits for them here."
        action={
          <>
            {canExport ? <Button variant="outline" onClick={exportCsv}><Download /> CSV</Button> : null}
            {canEdit("requests") ? <Button asChild><Link href="/requests/new"><Plus /> New request</Link></Button> : null}
          </>
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as "waiting" | "all")}>
        <TabsList>
          <TabsTrigger value="waiting">Waiting for me ({queue.length})</TabsTrigger>
          <TabsTrigger value="all">All I can see</TabsTrigger>
        </TabsList>
      </Tabs>

      <PeriodPresetsBar state={period.state} onChange={period.setState} today={period.today} allowAll years />

      <KpiGrid>
        <KpiCard label="Requests" value={shown.length} sublabel={period.label} icon={Inbox} />
        <KpiCard label={codeFilter ? "Amount (matching items)" : "Amount"} value={formatCurrency(total, "PHP", true)} sublabel={period.label} icon={Wallet} />
        <KpiCard label="Approved" value={formatCurrency(approved, "PHP", true)} sublabel={`${shown.filter((v) => v.status === "approved").length} requests`} icon={FileCheck2} tone="positive" />
        <KpiCard
          label="Still moving"
          value={moving.length}
          sublabel={moving.length ? (["submitted", "endorsed", "prepared", "reviewed"] as const).map((st) => `${moving.filter((v) => v.status === st).length} ${STATUS_LABEL[st].toLowerCase()}`).join(" · ") : "Nothing waiting"}
          icon={Clock}
          tone={moving.length ? "warning" : "default"}
        />
      </KpiGrid>

      <div className="flex flex-wrap items-center gap-2">
        <Input className="w-56" placeholder="Search no., purpose, OR…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search requests" />
        <Select value={basis} onValueChange={(v) => setBasis(v as Basis)}>
          <SelectTrigger className="w-40" aria-label="Which date the period uses"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(BASIS) as Basis[]).map((b) => (
              <SelectItem key={b} value={b}>{BASIS[b]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FilterSelect all="All vouchers" value={f.values.type} onChange={f.set("type")} options={opt.type} />
        <FilterSelect all="All kinds" value={f.values.kind} onChange={f.set("kind")} options={opt.kind} className="w-48" />
        <FilterSelect all="All statuses" value={f.values.status} onChange={f.set("status")} options={opt.status} className="w-48" />
        <FilterSelect all="All accounts" value={f.values.account} onChange={f.set("account")} options={opt.account} className="w-56" />
        <FilterSelect all="All account groups" value={f.values.group} onChange={f.set("group")} options={opt.group} className="w-52" />
        <FilterSelect all="All cost centers" value={f.values.t1} onChange={f.set("t1")} options={opt.t1} />
        <FilterSelect all="All programs" value={f.values.t3} onChange={f.set("t3")} options={opt.t3} />
        <FilterSelect all="All funds" value={f.values.t2} onChange={f.set("t2")} options={opt.t2} />
        <FilterSelect all="Everyone who asked" value={f.values.requester} onChange={f.set("requester")} options={opt.requester} className="w-48" />
        <FilterSelect all="Signed by anyone" value={f.values.signer} onChange={f.set("signer")} options={opt.signer} className="w-48" />
        <FilterSelect all="Any payment" value={f.values.pay} onChange={f.set("pay")} options={opt.pay} />
        <FilterSelect all="No flag" value={f.values.flag} onChange={f.set("flag")} options={opt.flag} className="w-48" />
        <Input className="w-28" type="number" inputMode="decimal" placeholder="₱ from" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} aria-label="Amount from" />
        <Input className="w-28" type="number" inputMode="decimal" placeholder="₱ to" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} aria-label="Amount to" />
        <ClearFilters
          active={active}
          onClear={() => {
            f.clear();
            setMinAmount("");
            setMaxAmount("");
          }}
        />
      </div>

      <Tabs value={view} onValueChange={(v) => setView(v as "requests" | "lines")}>
        <TabsList>
          <TabsTrigger value="requests">By request</TabsTrigger>
          <TabsTrigger value="lines">By item and code</TabsTrigger>
        </TabsList>
      </Tabs>

      {view === "requests" ? (
        <DataTable columns={requestColumns} data={shown} onRowClick={(v) => router.push(`/requests/${v.id}`)} emptyMessage={tab === "waiting" ? "Nothing waits for you." : "No requests match."} />
      ) : (
        <DataTable columns={lineColumns} data={shownLines} onRowClick={(r) => router.push(`/requests/${r.v.id}`)} emptyMessage="No items match." />
      )}
    </div>
  );
}
