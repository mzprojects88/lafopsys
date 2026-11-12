"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Banknote, Printer, Smartphone } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { SectionCard } from "@/components/patterns/section-card";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCollection } from "@/lib/data/collection-store";
import { advancesOpenStore, createTopUp, fundStatusStore, useVouchers } from "@/lib/hooks/use-vouchers";
import { useSetupRows } from "@/lib/hooks/use-finance-setup";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import { useStaffRoster } from "@/lib/hooks/use-staff-roster";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate, todayIso } from "@/lib/utils/date";
import { dayKey } from "@/lib/utils/dtr";
import { APPROVED, quarterOf, settlement, SPENDING } from "@/lib/utils/vouchers";
import { FundSetupDialog } from "@/components/modules/finance/fund-setup-dialog";
import { useRole } from "@/lib/rbac/use-role";
import { holdsPower } from "@/lib/rbac/roles";

const peso = (n: number) => formatCurrency(n, "PHP", true);

/**
 * Financial › Funds & advances (0138): each petty cash and GCash fund's cash on hand against its float, with a
 * top-up from the open slips; the cash advances still to liquidate, and which are overdue; and what LAF withheld
 * per payee each quarter, with the details for each 2307.
 */
export default function FundsPage() {
  const router = useRouter();
  const { canEdit } = useModuleAccess();
  const { data: funds } = useCollection(fundStatusStore);
  const { data: advances } = useCollection(advancesOpenStore);
  const { vouchers, lines, events } = useVouchers();
  const { data: payees } = useSetupRows("payees");
  const { data: fundRows } = useSetupRows("cash_funds");
  const { staff } = useStaffRoster();
  const [busy, setBusy] = React.useState<string | null>(null);
  // Whoever sets up Finance sets a fund up on its card (polish 5).
  const { roles } = useRole();
  const setsUp = holdsPower(roles, "finance_setup");
  const [settingUp, setSettingUp] = React.useState<string | null>(null);

  const name = (id: string) => {
    const s = staff.find((x) => x.id === id);
    return s ? `${s.firstName} ${s.lastName}` : "—";
  };
  const byId = new Map(vouchers.map((v) => [v.id, v]));

  // Withholding by quarter of the day Finance prepared the voucher.
  const preparedOn = new Map(events.filter((e) => e.action === "prepare").map((e) => [e.voucherId, e.at]));
  const withheld = vouchers.filter((v) => v.ewtTotal > 0 && v.payeeId && SPENDING.includes(v.status));
  const quarterOfVoucher = (id: string) => {
    const v = byId.get(id)!;
    return quarterOf(dayKey(preparedOn.get(id) ?? v.submittedAt ?? v.createdAt)).key;
  };
  const quarters = [...new Set([quarterOf(todayIso()).key, ...withheld.map((v) => quarterOfVoucher(v.id))])].sort().reverse();
  const [quarter, setQuarter] = React.useState(quarters[0]);
  const rows = [...withheld.filter((v) => quarterOfVoucher(v.id) === quarter).reduce((m, v) => {
    const ls = lines.filter((l) => l.voucherId === v.id && l.ewtAmount > 0);
    const r = m.get(v.payeeId!) ?? { payeeId: v.payeeId!, base: 0, tax: 0, atcs: new Set<string>() };
    for (const l of ls) {
      r.base += l.amount;
      r.tax += l.ewtAmount;
      if (l.ewtAtc) r.atcs.add(l.ewtAtc);
    }
    return m.set(r.payeeId, r);
  }, new Map<string, { payeeId: string; base: number; tax: number; atcs: Set<string> }>()).values()];

  // A fund's slips paid out and not yet refilled (their top-up not yet released), and a top-up on its way.
  const net = (v: { total: number; ewtTotal: number }) => v.total - v.ewtTotal;
  const slipsOf = new Map<string, typeof vouchers>();
  const topUpOf = new Map<string, (typeof vouchers)[number]>();
  for (const v of vouchers) {
    if (!v.fundId) continue;
    if (v.kind === "fund_topup") {
      if (!["released", "rejected", "cancelled"].includes(v.status)) topUpOf.set(v.fundId, v);
    } else if (v.status === "released" && (!v.replenishedBy || byId.get(v.replenishedBy)?.status !== "released")) {
      slipsOf.set(v.fundId, [...(slipsOf.get(v.fundId) ?? []), v]);
    }
  }
  for (const list of slipsOf.values()) list.sort((a, b) => (b.releasedAt ?? "").localeCompare(a.releasedAt ?? ""));
  const openSlips = (fundId: string) => slipsOf.get(fundId) ?? [];
  const topUpOnWay = (fundId: string) => topUpOf.get(fundId);
  // Advances settled by their liquidation: approved (the change or the overspend still to settle) or released;
  // what was advanced, spent and returned or reimbursed (latest 50). An approved one has left the list above.
  const settled = vouchers
    .filter((v) => v.kind === "liquidation" && (v.status === "released" || APPROVED.includes(v.status)) && v.advanceOf && byId.has(v.advanceOf))
    .sort((a, b) => (b.releasedAt ?? b.createdAt).localeCompare(a.releasedAt ?? a.createdAt))
    .slice(0, 50);

  async function topUp(fundId: string) {
    setBusy(fundId);
    const r = await createTopUp(fundId);
    setBusy(null);
    if (!r.ok) return void toast.error(r.error);
    toast.success("Top-up drafted: check it and send it");
    router.push(`/requests/${r.value}`);
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Funds & advances" description="Petty cash and GCash on hand, cash advances still to liquidate, and what LAF withheld for the 2307s." />

      <SectionCard title="Funds" description="Cash on hand = the float less the slips paid from it and not yet refilled. Below its top-up point, top it up from the open slips.">
        {funds.length ? (
          <KpiGrid>
            {funds.map((f) => (
              <div key={f.fundId} className="flex flex-col gap-2">
                <KpiCard
                  label={`${f.name}${f.custodianId ? ` · ${name(f.custodianId)}` : ""}`}
                  value={peso(f.cashOnHand)}
                  icon={f.kind === "gcash" ? Smartphone : Banknote}
                  tone={f.low ? "warning" : "default"}
                  sublabel={`${f.float == null ? "No float set yet" : `of ${peso(f.float)}`} · ${f.openCount} open slip${f.openCount === 1 ? "" : "s"} (${peso(f.openAmount)})${f.topUpPending ? " · a top-up is on its way" : f.low ? " · below the top-up point" : ""}`}
                />
                <div className="flex gap-2">
                  {canEdit("finance") ? (
                    <Button className="flex-1" variant={f.low ? "default" : "outline"} size="sm" disabled={busy === f.fundId || f.toRefill === 0} onClick={() => void topUp(f.fundId)}>
                      Top up
                    </Button>
                  ) : null}
                  {setsUp ? <Button variant="ghost" size="sm" disabled={!fundRows.some((r) => r.id === f.fundId)} onClick={() => setSettingUp(f.fundId)}>Set up</Button> : null}
                </div>
                {openSlips(f.fundId).length || topUpOnWay(f.fundId) ? (
                  <details className="rounded-xl border border-border px-3 py-2 text-theme-sm">
                    <summary className="cursor-pointer text-theme-xs font-medium text-muted-foreground">Slips not yet refilled ({openSlips(f.fundId).length})</summary>
                    <ul className="mt-2 flex flex-col gap-1">
                      {openSlips(f.fundId).map((v) => (
                        <li key={v.id} className="flex justify-between gap-2 text-theme-xs">
                          <Link className="text-primary hover:underline" href={`/requests/${v.id}`}>{v.voucherNumber ?? v.requestNumber}</Link>
                          <span className="text-muted-foreground">{v.releasedAt ? formatDate(v.releasedAt) : ""}</span>
                          <span className="tabular-nums">{peso(net(v))}</span>
                        </li>
                      ))}
                    </ul>
                    {topUpOnWay(f.fundId) ? (
                      <p className="mt-2 text-theme-xs">Top-up on its way: <Link className="text-primary hover:underline" href={`/requests/${topUpOnWay(f.fundId)!.id}`}>{topUpOnWay(f.fundId)!.voucherNumber ?? topUpOnWay(f.fundId)!.requestNumber ?? "draft"}</Link></p>
                    ) : null}
                  </details>
                ) : null}
              </div>
            ))}
          </KpiGrid>
        ) : (
          <p className="text-theme-sm text-muted-foreground">No fund in use: set them up in Financial Settings › Funds.</p>
        )}
      </SectionCard>

      {settingUp && fundRows.some((r) => r.id === settingUp) ? <FundSetupDialog key={settingUp} fund={fundRows.find((r) => r.id === settingUp)!} open onOpenChange={(o) => !o && setSettingUp(null)} /> : null}

      <SectionCard flush title="Cash advances to liquidate" description="Advances paid out and not yet settled by a liquidation, due within the days set in Financial Settings from the day they were paid.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-theme-sm">
            <thead>
              <tr className="border-b border-border text-left text-theme-xs text-muted-foreground">
                <th className="h-10 px-4 font-medium">Advance</th>
                <th className="h-10 px-4 font-medium">Requested by</th>
                <th className="h-10 px-4 text-right font-medium">Amount</th>
                <th className="h-10 px-4 font-medium">Due</th>
                <th className="h-10 px-4 font-medium">Liquidation</th>
              </tr>
            </thead>
            <tbody>
              {[...advances].sort((a, b) => a.due.localeCompare(b.due)).map((a) => {
                const v = byId.get(a.voucherId);
                return (
                  <tr key={a.voucherId} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5"><Link className="text-primary hover:underline" href={`/requests/${a.voucherId}`}>{v?.voucherNumber ?? v?.requestNumber ?? "Advance"}</Link></td>
                    <td className="px-4 py-2.5">{name(a.requestedBy)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{peso(a.amount)}</td>
                    <td className="px-4 py-2.5">{formatDate(a.due)} {a.overdue ? <Badge variant="destructive" className="ml-1">Overdue</Badge> : null}</td>
                    <td className="px-4 py-2.5">
                      {a.liquidationId ? <Link className="text-primary hover:underline" href={`/requests/${a.liquidationId}`}>{a.liquidationStatus === "draft" ? "Being written" : "Sent"}</Link> : <span className="text-muted-foreground">Not started</span>}
                    </td>
                  </tr>
                );
              })}
              {advances.length === 0 ? <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No advance waiting to be liquidated.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {settled.length ? (
        <SectionCard flush title="Settled advances" description="Advances closed by their liquidation: what was advanced, what was spent, and the change returned or the overspend reimbursed. The latest 50.">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-theme-sm">
              <thead>
                <tr className="border-b border-border text-left text-theme-xs text-muted-foreground">
                  <th className="h-10 px-4 font-medium">Advance</th>
                  <th className="h-10 px-4 font-medium">Requested by</th>
                  <th className="h-10 px-4 text-right font-medium">Advanced</th>
                  <th className="h-10 px-4 font-medium">Liquidation</th>
                  <th className="h-10 px-4 text-right font-medium">Spent</th>
                  <th className="h-10 px-4 font-medium">Settled</th>
                </tr>
              </thead>
              <tbody>
                {settled.map((l) => {
                  const a = byId.get(l.advanceOf!)!;
                  const left = settlement(a.total, net(l));
                  return (
                    <tr key={l.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-2.5"><Link className="text-primary hover:underline" href={`/requests/${a.id}`}>{a.voucherNumber ?? a.requestNumber}</Link></td>
                      <td className="px-4 py-2.5">{a.requestedBy ? name(a.requestedBy) : "—"}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{peso(a.total)}</td>
                      <td className="px-4 py-2.5"><Link className="text-primary hover:underline" href={`/requests/${l.id}`}>{l.voucherNumber ?? l.requestNumber}</Link></td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{peso(net(l))}</td>
                      <td className="px-4 py-2.5">
                        {l.releasedAt ? formatDate(l.releasedAt) : "Approved, to settle"} · {left.kind === "even" ? "spent exactly" : `${peso(left.amount)} ${left.kind === "return" ? (l.releasedAt ? "returned" : "to return") : (l.releasedAt ? "reimbursed" : "to reimburse")}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
      ) : null}

      <SectionCard
        flush
        title="Withheld (EWT) by payee"
        description="From the vouchers Finance prepared in the quarter. Print each payee's 2307 details and copy them onto the BIR form."
        actions={
          <Select value={quarter} onValueChange={setQuarter}>
            <SelectTrigger className="w-36" aria-label="Quarter"><SelectValue /></SelectTrigger>
            <SelectContent>
              {quarters.map((q) => <SelectItem key={q} value={q}>{q.replace("-", " ")}</SelectItem>)}
            </SelectContent>
          </Select>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-theme-sm">
            <thead>
              <tr className="border-b border-border text-left text-theme-xs text-muted-foreground">
                <th className="h-10 px-4 font-medium">Payee</th>
                <th className="h-10 px-4 font-medium">TIN</th>
                <th className="h-10 px-4 font-medium">ATC</th>
                <th className="h-10 px-4 text-right font-medium">Income paid</th>
                <th className="h-10 px-4 text-right font-medium">Withheld</th>
                <th className="h-10 px-4" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const p = payees.find((x) => x.id === r.payeeId);
                return (
                  <tr key={r.payeeId} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5 font-medium">{String(p?.name ?? "—")}</td>
                    <td className="px-4 py-2.5 tabular-nums">{String(p?.tin ?? "") || <span className="text-warning-foreground">No TIN</span>}</td>
                    <td className="px-4 py-2.5">{[...r.atcs].join(", ")}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{peso(r.base)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{peso(r.tax)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <Button variant="ghost" size="sm" onClick={() => window.open(`/finance/funds/2307?payee=${r.payeeId}&q=${quarter}`, "_blank", "noopener")}>
                        <Printer /> 2307
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 ? <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">Nothing withheld in this quarter.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
