"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Clock, FileCheck2, Inbox, ListTree, Plus, Wallet } from "lucide-react";
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
import { createTopUp, fundStatusStore, useVouchers, voucherFilesStore, type Voucher, type VoucherLine } from "@/lib/hooks/use-vouchers";
import { toast } from "sonner";
import { useSetupRows } from "@/lib/hooks/use-finance-setup";
import { useStaffRoster } from "@/lib/hooks/use-staff-roster";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import { useNow } from "@/lib/hooks/use-now";
import { useRole } from "@/lib/rbac/use-role";
import { optionsOf, words } from "@/lib/utils/filters";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/date";
import { BASIS_LABEL as BASIS, ledgerDay, type Basis } from "@/lib/utils/voucher-ledger";
import { APPROVED, daysWaiting, KIND_LABEL, OPEN, PAY_LABEL, STATUS_LABEL } from "@/lib/utils/vouchers";


export default function RequestsPage() {
  return (
    <React.Suspense fallback={<LoadingState />}>
      <RequestsContent />
    </React.Suspense>
  );
}

/** The funds this person keeps (0138): cash on hand, and the top-up from the open slips. Nothing for anyone else. */
function CustodianFunds() {
  const router = useRouter();
  const { staffId: me } = useRole();
  const { data } = useCollection(fundStatusStore);
  const [busy, setBusy] = React.useState(false);
  const mine = data.filter((f) => f.custodianId === me);
  if (!mine.length) return null;
  async function topUp(id: string) {
    setBusy(true);
    const r = await createTopUp(id);
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success("Top-up drafted: check it and send it");
    router.push(`/requests/${r.value}`);
  }
  return (
    <KpiGrid>
      {mine.map((f) => (
        <div key={f.fundId} className="flex flex-col gap-2">
          <KpiCard label={`${f.name} (you keep it)`} value={formatCurrency(f.cashOnHand, "PHP", true)} icon={Wallet} tone={f.low ? "warning" : "default"}
            sublabel={`on hand · ${f.toRefill} slip${f.toRefill === 1 ? "" : "s"} to refill${f.topUpPending ? " · a top-up is on its way" : f.low ? " · below the top-up point" : ""}`} />
          <Button size="sm" variant={f.low ? "default" : "outline"} disabled={busy || f.toRefill === 0} onClick={() => void topUp(f.fundId)}>Ask for a top-up</Button>
        </div>
      ))}
    </KpiGrid>
  );
}

/**
 * Payment Requests (0134): every request and voucher the person can see (their own; Finance and the signers
 * once sent), with what waits for them and filters by transaction, people and dates. A request opens on its
 * tracker. Codes, totals by account and the exports are Finance's, on Financial › Ledger (0140).
 */
function RequestsContent() {
  const router = useRouter();
  const { canEdit, levelOfPath } = useModuleAccess();
  const { vouchers, lines, events, queue, loading } = useVouchers();
  const { data: files } = useCollection(voucherFilesStore);
  const { staff } = useStaffRoster();
  const period = usePeriodPresets("requests", "this_month", true);
  const [tab, setTab] = React.useState<"waiting" | "all">("all");
  const [basis, setBasis] = React.useState<Basis>("requested");
  const [query, setQuery] = React.useState("");
  const f = useFilters("type", "kind", "status", "requester", "signer", "pay", "flag", "recipient");
  const seesLedger = levelOfPath("/finance/ledger") !== "none";
  const { data: categories } = useSetupRows("recipient_categories");
  const now = useNow().getTime();

  const name = (id: string | null) => {
    const s = id ? staff.find((x) => x.id === id) : null;
    return s ? `${s.firstName} ${s.lastName}` : "";
  };
  const waitingIds = new Set(queue.map((q) => q.voucherId));
  const linesOf = React.useMemo(() => {
    const m = new Map<string, VoucherLine[]>();
    for (const l of lines) m.set(l.voucherId, [...(m.get(l.voucherId) ?? []), l]);
    return m;
  }, [lines]);
  const eventsOf = React.useMemo(() => {
    const m = new Map<string, typeof events>();
    for (const e of events) (m.get(e.voucherId) ?? m.set(e.voucherId, []).get(e.voucherId)!).push(e);
    return m;
  }, [events]);
  const filesOf = new Set(files.map((x) => x.voucherId));
  // The same Manila day as on the Ledger, for the same basis.
  const dateOf = (v: Voucher) => ledgerDay(basis, v, eventsOf.get(v.id) ?? []);
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

  const w = period.window;
  const q = query.trim().toLowerCase();
  const shown = vouchers.filter((v) => {
    const d = dateOf(v);
    return (
      (tab === "all" || waitingIds.has(v.id)) &&
      // What waits for someone waits whatever its date.
      (tab === "waiting" || !w || (!!d && d >= w.from && d <= w.to)) &&
      f.ok("type", v.voucherType ?? "none") &&
      f.ok("kind", v.kind) &&
      f.ok("status", v.status) &&
      f.ok("requester", v.requestedBy) &&
      (f.values.signer === "all" || (eventsOf.get(v.id) ?? []).some((e) => e.actor === f.values.signer)) &&
      f.ok("pay", v.payMethod) &&
      f.ok("recipient", v.toPerson ? v.recipientCategoryId : "none") &&
      (f.values.flag === "all" || flags(v).includes(f.values.flag)) &&
      (!q || [v.requestNumber, v.voucherNumber, v.legacyNumber, v.purpose, v.recipientName, ...(linesOf.get(v.id) ?? []).flatMap((l) => [l.description, l.orNumber])].some((x) => x?.toLowerCase().includes(q)))
    );
  });
  const amountOf = (v: Voucher) => v.total;

  const total = shown.reduce((s, v) => s + amountOf(v), 0);
  const approved = shown.filter((v) => APPROVED.includes(v.status)).reduce((s, v) => s + amountOf(v), 0);
  const moving = shown.filter((v) => v.source === "app" && OPEN.includes(v.status));

  const opt = {
    type: optionsOf(vouchers, (v) => v.voucherType ?? "none", (x) => (x === "none" ? "Not yet a voucher" : x)),
    kind: optionsOf(vouchers, (v) => v.kind, (k) => KIND_LABEL[k as keyof typeof KIND_LABEL] ?? words(k)),
    status: optionsOf(vouchers, (v) => v.status, (s) => STATUS_LABEL[s as keyof typeof STATUS_LABEL] ?? words(s)),
    requester: optionsOf(vouchers, (v) => v.requestedBy, (id) => name(id) || "—"),
    signer: optionsOf(events, (e) => e.actor, (id) => name(id) || "—"),
    pay: optionsOf(vouchers, (v) => v.payMethod, (p) => PAY_LABEL[p] ?? p),
    recipient: optionsOf(vouchers, (v) => (v.toPerson ? v.recipientCategoryId : "none"), (id) => (id === "none" ? "Not to a person" : `To: ${String(categories.find((c) => c.id === id)?.name ?? "a person")}`)),
    flag: optionsOf(vouchers.flatMap((v) => flags(v)), (x) => x, (x) => FLAG_LABEL[x] ?? x),
  };
  const active = f.active;

  const numberOf = (v: Voucher) => v.voucherNumber ?? v.legacyNumber ?? v.requestNumber ?? "Draft";
  const requestColumns: ColumnDef<Voucher>[] = [
    { id: "number", header: "No.", accessorFn: numberOf, cell: ({ row }) => <span className="font-medium tabular-nums">{numberOf(row.original)}</span> },
    { id: "date", header: BASIS[basis], accessorFn: (v) => dateOf(v) ?? "", cell: ({ row }) => formatDate(dateOf(row.original)) },
    { id: "purpose", header: "For", accessorFn: (v) => v.purpose, cell: ({ row }) => <span className="line-clamp-2 max-w-72">{row.original.purpose}</span> },
    { id: "requester", header: "Requested by", accessorFn: (v) => name(v.requestedBy) || v.payeeText || "" },
    { id: "amount", header: "Amount", accessorFn: amountOf, cell: ({ row }) => <span className="tabular-nums">{formatCurrency(amountOf(row.original), "PHP", true)}</span> },
    { id: "status", header: "Status", accessorFn: (v) => v.status, cell: ({ row }) => <VoucherStatusBadge status={row.original.status} /> },
    {
      id: "waiting",
      header: "Waiting",
      accessorFn: (v) => (v.source === "app" && OPEN.includes(v.status) ? daysWaiting(lastMove(v), now) : -1),
      cell: ({ row }) => (row.original.source === "app" && OPEN.includes(row.original.status) ? `${daysWaiting(lastMove(row.original), now)} d` : "—"),
    },
  ];
  if (loading && vouchers.length === 0) return <LoadingState />;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Payment Requests"
        description="Ask for a payment, a reimbursement or a cash advance and follow it to approval. Signers find what waits for them here."
        action={
          <>
            {seesLedger ? <Button variant="outline" asChild><Link href="/finance/ledger"><ListTree /> Codes and totals: Ledger</Link></Button> : null}
            {canEdit("requests") ? <Button asChild><Link href="/requests/new"><Plus /> New request</Link></Button> : null}
          </>
        }
      />

      <CustodianFunds />

      <Tabs value={tab} onValueChange={(v) => setTab(v as "waiting" | "all")}>
        <TabsList>
          <TabsTrigger value="waiting">Waiting for me ({queue.length})</TabsTrigger>
          <TabsTrigger value="all">All I can see</TabsTrigger>
        </TabsList>
      </Tabs>

      <PeriodPresetsBar state={period.state} onChange={period.setState} today={period.today} allowAll years />

      <KpiGrid>
        <KpiCard label="Requests" value={shown.length} sublabel={period.label} icon={Inbox} />
        <KpiCard label="Amount" value={formatCurrency(total, "PHP", true)} sublabel={period.label} icon={Wallet} />
        <KpiCard label="Approved" value={formatCurrency(approved, "PHP", true)} sublabel={`${shown.filter((v) => APPROVED.includes(v.status)).length} requests, ${shown.filter((v) => v.status === "released").length} paid`} icon={FileCheck2} tone="positive" />
        <KpiCard
          label="Still moving"
          value={moving.length}
          sublabel={moving.length ? OPEN.map((st) => [st, moving.filter((v) => v.status === st).length] as const).filter(([, n]) => n > 0).map(([st, n]) => `${n} ${STATUS_LABEL[st].toLowerCase()}`).join(" · ") : "Nothing waiting"}
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
        <FilterSelect all="Everyone who asked" value={f.values.requester} onChange={f.set("requester")} options={opt.requester} className="w-48" />
        <FilterSelect all="Signed by anyone" value={f.values.signer} onChange={f.set("signer")} options={opt.signer} className="w-48" />
        <FilterSelect all="Any payment" value={f.values.pay} onChange={f.set("pay")} options={opt.pay} />
        <FilterSelect all="Paid to anyone" value={f.values.recipient} onChange={f.set("recipient")} options={opt.recipient} className="w-48" />
        <FilterSelect all="No flag" value={f.values.flag} onChange={f.set("flag")} options={opt.flag} className="w-48" />
        <ClearFilters
          active={active}
          onClear={f.clear}
        />
      </div>

      <DataTable columns={requestColumns} data={shown} onRowClick={(v) => router.push(`/requests/${v.id}`)} emptyMessage={tab === "waiting" ? "Nothing waits for you." : "No requests match."} />
    </div>
  );
}
