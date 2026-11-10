"use client";

import * as React from "react";
import { toast } from "sonner";
import { CheckCircle2, CircleDashed } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { SectionCard } from "@/components/patterns/section-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SetupRows, type SetupColumn, type SetupField } from "@/components/modules/finance/setup-rows";
import { createClient } from "@/lib/supabase/client";
import { useCollection } from "@/lib/data/collection-store";
import { setupChecklistStore, setupLogStore, useSetupRows, type SetupRow } from "@/lib/hooks/use-finance-setup";
import { programsStore, useProgramsData } from "@/lib/hooks/use-programs-collection";
import { useStaffRoster } from "@/lib/hooks/use-staff-roster";
import { useRoleNames } from "@/lib/hooks/use-module-access";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/date";
import { STATUS_TONE_CLASSES } from "@/lib/utils/status-colors";

const TABS = [
  { value: "setup", label: "Setup checklist" },
  { value: "chart", label: "Chart of accounts" },
  { value: "codes", label: "Codes" },
  { value: "expense", label: "Expense types" },
  { value: "authority", label: "Authority" },
  { value: "funds", label: "Funds" },
  { value: "payees", label: "Payees & withholding" },
  { value: "general", label: "General" },
] as const;
/** Where each checklist item is fixed. */
const TAB_OF: Record<string, string> = { chart: "chart", codes: "codes", expense_types: "expense", authority: "authority", funds: "funds", general: "general" };

const STEPS = [
  { value: "endorse", label: "Endorse" },
  { value: "validate", label: "Validate (Finance)" },
  { value: "review", label: "Review" },
  { value: "approve", label: "Approve" },
  { value: "approve_payment", label: "Approve the payment" },
  { value: "release", label: "Release" },
];
const TABLE_LABEL: Record<string, string> = {
  coa_accounts: "Chart of accounts", fin_codes: "Codes", expense_types: "Expense types", finance_settings: "General",
  voucher_authority: "Authority", cash_funds: "Funds", ewt_rates: "Withholding rates", payees: "Payees",
};

const str = (v: unknown) => (v == null ? "" : String(v));
const peso = (v: unknown) => (v == null ? "—" : formatCurrency(Number(v)));
const off = (row: SetupRow) => (row.active === false ? <Badge className={STATUS_TONE_CLASSES.neutral}>Off</Badge> : null);

/**
 * Finance › Financial Settings (0133): everything the vouchers need before the first payment request.
 * Opened by the "Sets up Finance" power (the Super Admin always holds it). Imported rows that carry a note
 * wait for the Super Admin to settle them; the setup checklist says what is still open.
 */
export default function FinancialSettingsPage() {
  const [tab, setTab] = React.useState<string>("setup");
  const { data: accounts } = useSetupRows("coa_accounts");
  const { data: codes } = useSetupRows("fin_codes");
  const { data: expenseTypes } = useSetupRows("expense_types");
  const { data: settings } = useSetupRows("finance_settings");
  const { data: authority } = useSetupRows("voucher_authority");
  const { data: funds } = useSetupRows("cash_funds");
  const { data: rates } = useSetupRows("ewt_rates");
  const { data: payees } = useSetupRows("payees");
  const { data: checklist } = useCollection(setupChecklistStore);
  const { data: log } = useCollection(setupLogStore);
  const { programs } = useProgramsData();
  const { staff } = useStaffRoster();
  const { roles, name: roleName } = useRoleNames();

  const accountLabel = (id: unknown) => {
    const a = accounts.find((x) => x.id === id);
    return a ? [a.code, a.name].filter(Boolean).join(" ") : "—";
  };
  const codeLabel = (id: unknown) => {
    const c = codes.find((x) => x.id === id);
    return c ? `${c.code} · ${c.name}` : "—";
  };
  const personLabel = (id: unknown) => {
    const s = staff.find((x) => x.id === id);
    return s ? `${s.firstName} ${s.lastName}` : "—";
  };

  const postable = accounts.filter((a) => !a.is_header && a.code).map((a) => ({ value: str(a.id), label: accountLabel(a.id) }));
  const headings = accounts.filter((a) => a.is_header && a.code).map((a) => ({ value: str(a.id), label: accountLabel(a.id) }));
  const t1 = codes.filter((c) => c.tier === "T1").map((c) => ({ value: str(c.id), label: codeLabel(c.id) }));
  const t3 = codes.filter((c) => c.tier === "T3").map((c) => ({ value: str(c.id), label: codeLabel(c.id) }));
  const people = staff.filter((s) => s.active && s.role !== "partner_viewer").map((s) => ({ value: s.id, label: `${s.firstName} ${s.lastName}` }));
  const roleOptions = roles.filter((r) => !r.archived_at && r.key !== "partner_viewer").map((r) => ({ value: r.key, label: r.name }));

  const nextSort = (rows: SetupRow[]) => Math.max(0, ...rows.map((r) => Number(r.sort ?? 0))) + 1;

  const codeFields = (tier: "T1" | "T2" | "T3"): SetupField[] => [
    { key: "code", label: "Code", kind: "text", upper: true, hint: "2 to 8 capital letters or digits, as it should appear in QuickBooks." },
    { key: "name", label: "Name", kind: "text" },
    ...(tier === "T1" ? [{ key: "parent_id", label: "Part of", kind: "select", optional: true, options: t1 } as SetupField] : []),
    ...(tier === "T3" ? [{ key: "parent_id", label: "Cost center", kind: "select", options: t1 } as SetupField] : []),
    ...(tier === "T2" ? [{ key: "restricted", label: "Restricted by the donor", kind: "switch" } as SetupField] : []),
    ...(tier !== "T1"
      ? [{ key: "account_prefixes", label: tier === "T2" ? "Accounts it may pay for" : "Account groups of this program", kind: "list", hint: tier === "T2" ? "Codes or their first digits, separated by commas (e.g. 52, 5503). Leave empty to allow any account." : "The first digits of its accounts, separated by commas (e.g. 52 for the 5200s)." } as SetupField]
      : []),
    { key: "active", label: "In use", kind: "switch" },
    { key: "sort", label: "Order in the list", kind: "number" },
  ];
  const codeColumns: SetupColumn[] = [
    { label: "Code", render: (r) => <span className="font-medium">{str(r.code)}</span> },
    { label: "Name", render: (r) => <>{str(r.name)} {r.restricted ? <Badge className={STATUS_TONE_CLASSES.warning}>Restricted</Badge> : null} {off(r)}</> },
    { label: "Part of", render: (r) => (r.parent_id ? codeLabel(r.parent_id) : "—") },
    { label: "Accounts", render: (r) => ((r.account_prefixes as string[] | undefined)?.length ? (r.account_prefixes as string[]).join(", ") : "—") },
  ];

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Financial Settings" description="The chart of accounts, codes and rules the payment requests and vouchers follow. Requests open once the setup checklist is complete." />

      <Tabs value={tab} onValueChange={setTab}>
        <div className="overflow-x-auto">
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="setup" className="mt-4">
          <SectionCard
            title={checklist?.ready ? "Ready for payment requests" : "Before the first payment request"}
            description={checklist ? `${checklist.items.filter((i) => i.done).length} of ${checklist.items.length} done.` : "Checking…"}
          >
            <div className="flex flex-col gap-2">
              {(checklist?.items ?? []).map((i) => (
                <div key={i.key} className="flex flex-wrap items-center gap-3 rounded-xl border border-border px-3 py-2.5">
                  {i.done ? <CheckCircle2 className="size-5 text-success" /> : <CircleDashed className="size-5 text-muted-foreground" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{i.label}</p>
                    <p className="text-theme-xs text-muted-foreground">{i.detail}</p>
                  </div>
                  {!i.done && TAB_OF[i.key] ? (
                    <Button size="sm" variant="outline" onClick={() => setTab(TAB_OF[i.key])}>Open</Button>
                  ) : null}
                </div>
              ))}
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="chart" className="mt-4">
          <SetupRows
            table="coa_accounts"
            title="Chart of accounts"
            description="Imported from the LAF COA QB Standard COA workbook (18 Aug). Rows with a note need a decision before requests open."
            rows={accounts}
            search={(r) => `${str(r.code)} ${str(r.name)} ${str(r.old_qb_name)} ${str(r.description)}`}
            addLabel="Add account"
            blank={{ active: true, is_header: false, sort: nextSort(accounts) }}
            columns={[
              { label: "Code", render: (r) => <span className="font-medium tabular-nums">{str(r.code) || "—"}</span> },
              { label: "Account", render: (r) => <span className={r.is_header ? "font-semibold" : r.parent_id ? "pl-4" : ""}>{str(r.name)} {off(r)}</span> },
              { label: "Type", render: (r) => <span className="text-muted-foreground">{[r.account_type, r.detail_type].filter(Boolean).join(" · ") || "—"}</span> },
              { label: "Under", render: (r) => <span className="text-muted-foreground">{r.parent_id ? str(accounts.find((a) => a.id === r.parent_id)?.code) : "—"}</span> },
            ]}
            fields={[
              { key: "code", label: "Code", kind: "text", hint: "Four digits." },
              { key: "name", label: "Name", kind: "text" },
              { key: "parent_id", label: "Under (heading)", kind: "select", optional: true, options: headings },
              { key: "is_header", label: "A heading (groups accounts; not used on vouchers)", kind: "switch" },
              { key: "account_type", label: "Account type", kind: "text" },
              { key: "detail_type", label: "Detail type", kind: "text" },
              { key: "description", label: "Description / scope", kind: "textarea" },
              { key: "old_qb_name", label: "Name in the old QuickBooks file", kind: "text" },
              { key: "active", label: "In use", kind: "switch" },
              { key: "sort", label: "Order in the list", kind: "number" },
            ]}
          />
        </TabsContent>

        <TabsContent value="codes" className="mt-4 flex flex-col gap-4">
          {(["T1", "T2", "T3"] as const).map((tier) => (
            <SetupRows
              key={tier}
              table="fin_codes"
              title={tier === "T1" ? "T1 · Cost centers (QuickBooks Classes)" : tier === "T2" ? "T2 · Donor funds (QuickBooks Projects)" : "T3 · Programs (QuickBooks sub-classes)"}
              rows={codes.filter((c) => c.tier === tier)}
              columns={codeColumns}
              fields={codeFields(tier)}
              blank={{ active: true, restricted: false, account_prefixes: [], sort: nextSort(codes.filter((c) => c.tier === tier)) }}
              fixed={{ tier }}
              addLabel="Add code"
            />
          ))}
          <SectionCard title="ArkOS programs" description="The voucher program each ArkOS program's spending counts under.">
            <div className="flex flex-col gap-2">
              {programs.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-theme-sm font-medium">{p.name}</span>
                  <Select
                    value={p.t3Id ?? "__none"}
                    onValueChange={async (v) => {
                      const { error } = await createClient().schema("ops").from("programs").update({ t3_id: v === "__none" ? null : v }).eq("id", p.id);
                      if (error) return void toast.error(error.message);
                      await programsStore.refetch();
                    }}
                  >
                    <SelectTrigger className="w-64" aria-label={`Voucher program for ${p.name}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">Not set</SelectItem>
                      {t3.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="expense" className="mt-4">
          <SetupRows
            table="expense_types"
            title="Expense types"
            description="What a requester picks, and the account it means for each use. Proposed by the app from the chart's descriptions."
            rows={expenseTypes}
            search={(r) => `${str(r.label)} ${accountLabel(r.account_id)}`}
            addLabel="Add expense type"
            blank={{ active: true, sort: nextSort(expenseTypes) }}
            columns={[
              { label: "Expense type", render: (r) => <span className="font-medium">{str(r.label)} {off(r)}</span> },
              { label: "Used for", render: (r) => codeLabel(r.use_id) },
              { label: "Account", render: (r) => accountLabel(r.account_id) },
            ]}
            fields={[
              { key: "label", label: "Expense type (as the requester reads it)", kind: "text" },
              { key: "use_id", label: "Used for", kind: "select", options: [...t3, ...t1], hint: "A program (T3), or a cost center such as Admin (T1)." },
              { key: "account_id", label: "Account", kind: "select", options: postable },
              { key: "active", label: "In use", kind: "switch" },
              { key: "sort", label: "Order in the list", kind: "number" },
            ]}
          />
        </TabsContent>

        <TabsContent value="authority" className="mt-4">
          <SetupRows
            table="voucher_authority"
            title="Approval authority"
            description="Who signs each step, for which amounts (from the lower amount to under the upper one). Endorsement is set per requester's role. The vouchers keep the same person from signing steps that must stay apart (for example approving their own request)."
            rows={[...authority].sort((a, b) => STEPS.findIndex((s) => s.value === a.step) - STEPS.findIndex((s) => s.value === b.step) || Number(a.min_amount) - Number(b.min_amount))}
            addLabel="Add signer"
            blank={{ step: "approve", min_amount: 0, urgent: false }}
            columns={[
              { label: "Step", render: (r) => <span className="font-medium">{STEPS.find((s) => s.value === r.step)?.label}{r.requester_role ? ` · ${roleName(str(r.requester_role))}` : ""}{r.urgent ? " · urgent" : ""}</span> },
              { label: "Amount", render: (r) => <span className="tabular-nums">{peso(r.min_amount)} to {r.max_amount == null ? "any amount" : `under ${peso(r.max_amount)}`}</span> },
              { label: "Signer", render: (r) => (r.staff_id ? personLabel(r.staff_id) : "No endorsement needed") },
              { label: "Alternate", render: (r) => (r.alternate_staff_id ? personLabel(r.alternate_staff_id) : "—") },
            ]}
            fields={[
              { key: "step", label: "Step", kind: "select", options: STEPS },
              { key: "requester_role", label: "Requester's role (endorse only)", kind: "select", optional: true, options: roleOptions },
              { key: "min_amount", label: "From (₱)", kind: "number" },
              { key: "max_amount", label: "Up to, not including (₱)", kind: "number", hint: "Leave empty for no upper limit." },
              { key: "staff_id", label: "Signer", kind: "select", optional: true, options: people, hint: "For an endorse row, leave it empty when this role's requests need no endorsement." },
              { key: "alternate_staff_id", label: "Alternate (signs when the signer is away)", kind: "select", optional: true, options: people },
              { key: "urgent", label: "Urgent approver: signs urgent requests between the weekly approvals (Approve step only)", kind: "switch" },
            ]}
          />
        </TabsContent>

        <TabsContent value="funds" className="mt-4">
          <SetupRows
            table="cash_funds"
            title="Petty cash and GCash funds"
            description="Each fund is a fixed float: cash plus the slips not yet topped up always equal it. A top-up is offered when the cash falls below the top-up point."
            rows={funds}
            addLabel="Add fund"
            blank={{ kind: "petty_cash", active: true }}
            columns={[
              { label: "Fund", render: (r) => <span className="font-medium">{str(r.name)} {off(r)}</span> },
              { label: "Account", render: (r) => accountLabel(r.account_id) },
              { label: "Float", render: (r) => <span className="tabular-nums">{peso(r.float_amount)}</span> },
              { label: "Top up below", render: (r) => <span className="tabular-nums">{peso(r.top_up_below)}</span> },
              { label: "Custodian", render: (r) => personLabel(r.custodian_staff_id) },
            ]}
            fields={[
              { key: "kind", label: "Kind", kind: "select", options: [{ value: "petty_cash", label: "Petty cash" }, { value: "gcash", label: "GCash" }] },
              { key: "name", label: "Name", kind: "text" },
              { key: "account_id", label: "Account", kind: "select", optional: true, options: postable, hint: "The chart has no GCash account yet: add one (e.g. 1105 GCash Fund) under Chart of accounts first." },
              { key: "float_amount", label: "Float (₱)", kind: "number" },
              { key: "top_up_below", label: "Top up when the cash falls below (₱)", kind: "number" },
              { key: "custodian_staff_id", label: "Custodian (holds the cash)", kind: "select", optional: true, options: people },
              { key: "active", label: "In use", kind: "switch" },
            ]}
          />
        </TabsContent>

        <TabsContent value="payees" className="mt-4 flex flex-col gap-4">
          <SetupRows
            table="ewt_rates"
            title="Withholding tax rates (EWT)"
            description="As the accountant gives them: the BIR code (ATC), what it covers and the rate."
            rows={rates}
            addLabel="Add rate"
            blank={{ active: true }}
            columns={[
              { label: "ATC", render: (r) => <span className="font-medium">{str(r.atc)}</span> },
              { label: "Covers", render: (r) => <>{str(r.description)} {off(r)}</> },
              { label: "Rate", render: (r) => <span className="tabular-nums">{str(r.rate)}%</span> },
            ]}
            fields={[
              { key: "atc", label: "ATC (e.g. WI010)", kind: "text", upper: true },
              { key: "description", label: "What it covers", kind: "text" },
              { key: "rate", label: "Rate (%)", kind: "number" },
              { key: "active", label: "In use", kind: "switch" },
            ]}
          />
          <SetupRows
            table="payees"
            title="Payees"
            description="Suppliers and others LAF pays. Staff are paid as themselves and need no row here."
            rows={payees}
            search={(r) => `${str(r.name)} ${str(r.tin)}`}
            addLabel="Add payee"
            blank={{ active: true }}
            columns={[
              { label: "Payee", render: (r) => <span className="font-medium">{str(r.name)} {off(r)}</span> },
              { label: "TIN", render: (r) => <span className="tabular-nums">{str(r.tin) || "—"}</span> },
              { label: "Withholding", render: (r) => str(r.ewt_atc) || "None" },
            ]}
            fields={[
              { key: "name", label: "Name", kind: "text" },
              { key: "tin", label: "TIN", kind: "text", hint: "Digits only: 9, or 9 plus the 3- or 5-digit branch code." },
              { key: "address", label: "Address", kind: "textarea" },
              { key: "ewt_atc", label: "Withholding tax", kind: "select", optional: true, options: rates.filter((r) => r.active !== false).map((r) => ({ value: str(r.atc), label: `${str(r.atc)} · ${str(r.description)} (${str(r.rate)}%)` })) },
              { key: "active", label: "In use", kind: "switch" },
            ]}
          />
        </TabsContent>

        <TabsContent value="general" className="mt-4 flex flex-col gap-4">
          <SetupRows
            table="finance_settings"
            title="General"
            rows={settings}
            canAdd={false}
            canDelete={false}
            blank={{}}
            columns={[
              { label: "Requests start", render: (r) => (r.start_date ? formatDate(str(r.start_date), "MMMM d, yyyy") : "Not set") },
              { label: "Liquidate advances within", render: (r) => (r.liquidation_days ? `${str(r.liquidation_days)} days` : "Not set") },
              { label: "History to the cash book", render: (r) => (r.history_to_cash_book ? "On" : "Off") },
            ]}
            fields={[
              { key: "start_date", label: "Payment requests start on", kind: "date", hint: "Vouchers before this date come from the registers (history)." },
              { key: "liquidation_days", label: "Liquidate a cash advance within (days)", kind: "number" },
              { key: "history_to_cash_book", label: "Imported (history) vouchers post to the cash book", kind: "switch", hint: "Off until the accountant decides. When on, entries already in the cash book are skipped, not counted twice." },
            ]}
          />
          <SectionCard flush title="Changes" description="The last 100 changes to these settings, with who made them.">
            <ul className="divide-y divide-border">
              {log.map((l) => {
                const changed = l.action === "UPDATE" && l.before && l.after ? Object.keys(l.after).filter((k) => k !== "updated_at" && JSON.stringify(l.after?.[k]) !== JSON.stringify(l.before?.[k])) : [];
                const row = l.after ?? l.before;
                return (
                  <li key={l.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-2.5 text-theme-sm">
                    <span className="tabular-nums text-muted-foreground">{formatDate(l.changed_at, "MMM d, yyyy h:mm a")}</span>
                    <span className="font-medium">{personLabel(l.changed_by)}</span>
                    <span>
                      {l.action === "INSERT" ? "added" : l.action === "DELETE" ? "removed" : "changed"} · {TABLE_LABEL[l.table_name] ?? l.table_name}
                      {row?.code || row?.name || row?.label || row?.atc ? `: ${[row?.code, row?.name ?? row?.label ?? row?.atc].filter(Boolean).join(" ")}` : ""}
                      {changed.length ? ` (${changed.map((k) => (k === "review_note" ? "note settled" : k.replace(/_/g, " "))).join(", ")})` : ""}
                    </span>
                  </li>
                );
              })}
              {log.length === 0 ? <li className="px-5 py-6 text-center text-theme-sm text-muted-foreground">No changes yet.</li> : null}
            </ul>
          </SectionCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}
