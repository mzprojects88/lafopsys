"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Plus, Send, Trash2 } from "lucide-react";
import { SectionCard } from "@/components/patterns/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import { setupChecklistStore, useSetupRows } from "@/lib/hooks/use-finance-setup";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";
import { actOnVoucher, saveVoucher, type DraftHeader, type DraftLine, type Voucher, type VoucherLine } from "@/lib/hooks/use-vouchers";
import { formatCurrency } from "@/lib/utils/currency";
import { fundAllows, KIND_LABEL, PAY_LABEL, REQUESTABLE } from "@/lib/utils/vouchers";
import { todayIso } from "@/lib/utils/date";

/** Suppliers by name only (ops.payee_choices: TINs stay with Finance). */
const payeeChoicesStore = createCollection<{ id: string; name: string }[]>({
  key: "ops.payee_choices",
  empty: [],
  tables: [{ schema: "ops", table: "payees" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("ops").rpc("payee_choices");
    if (error) throw new Error(error.message);
    return (data ?? []) as { id: string; name: string }[];
  },
});

interface LineDraft extends Omit<DraftLine, "qty" | "unit_cost"> {
  label: string;
  qty: string;
  unit_cost: string;
}
/** The patient a person-paid request is for, from Patients (loaded only for those who read Patients). */
function PatientPick({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const { patients } = usePatientsData();
  const sorted = [...patients].sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`));
  return (
    <Select value={value ?? "__none"} onValueChange={(v) => onChange(v === "__none" ? null : v)}>
      <SelectTrigger id="req-patient" className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="__none">Not picked (type the name)</SelectItem>
        {sorted.map((p) => (
          <SelectItem key={p.id} value={p.id}>{p.lastName}, {p.firstName} · {p.patientNumber}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const blankLine = (): LineDraft => ({ label: "", expense_type_id: "", description: "", qty: "1", unit_cost: "", or_number: "" });

/**
 * Step 1: what a staff member asks for. They answer plain questions (what kind, what for, who it serves, which
 * fund); the database codes each item from its expense type, and Finance confirms the coding when it prepares
 * the voucher. Used for a new request and for a draft or a request sent back.
 */
export function RequestForm({ voucher, lines }: { voucher?: Voucher; lines?: VoucherLine[] }) {
  const router = useRouter();
  const { data: types } = useSetupRows("expense_types");
  const { data: codes } = useSetupRows("fin_codes");
  const { data: accounts } = useSetupRows("coa_accounts");
  const { data: payees } = useCollection(payeeChoicesStore);
  const { data: checklist } = useCollection(setupChecklistStore);
  const { data: categories } = useSetupRows("recipient_categories");
  const { canView } = useModuleAccess();

  const funds = codes.filter((c) => c.tier === "T2" && c.active);
  const typeById = (id: string) => types.find((t) => t.id === id);
  const [header, setHeader] = React.useState<DraftHeader>(() => ({
    kind: voucher?.kind ?? "reimbursement",
    purpose: voucher?.purpose ?? "",
    payee_id: voucher?.payeeId ?? null,
    t2_id: voucher?.t2Id ?? "",
    pay_method: voucher?.payMethod ?? "cash",
    needed_by: voucher?.neededBy ?? null,
    urgent: voucher?.urgent ?? false,
    urgent_reason: voucher?.urgentReason ?? null,
    to_person: voucher?.toPerson ?? false,
    recipient_category_id: voucher?.recipientCategoryId ?? null,
    patient_id: voucher?.patientId ?? null,
    recipient_name: voucher?.recipientName ?? null,
  }));
  const [items, setItems] = React.useState<LineDraft[]>(() =>
    lines?.length
      ? lines.map((l) => ({ label: "", expense_type_id: l.expenseTypeId ?? "", description: l.description, qty: String(l.qty), unit_cost: String(l.unitCost), or_number: l.orNumber ?? "" }))
      : [blankLine()]
  );
  const [busy, setBusy] = React.useState(false);

  // Unrestricted unless the requester picks a donor's fund.
  const fundId = header.t2_id || String(funds.find((f) => f.code === "UNR")?.id ?? funds.find((f) => !f.restricted)?.id ?? "");
  const fund = funds.find((f) => f.id === fundId);
  // Paying a person: only the purposes Finance marks for it (burial aid, financial aid...).
  // A person is paid directly: a supplier payment or petty cash (an advance or a reimbursement pays the requester).
  const toPerson = header.to_person && (header.kind === "supplier" || header.kind === "petty_cash");
  const activeTypes = types.filter((t) => t.active !== false && (!toPerson || t.for_person));
  const category = categories.find((c) => c.id === header.recipient_category_id);
  const readsPatients = canView("patients") || canView("house_ops");
  const labels = [...new Set([...activeTypes].sort((a, b) => Number(a.sort) - Number(b.sort)).map((t) => String(t.label)))];
  const usesOf = (label: string) => activeTypes.filter((t) => t.label === label);
  const nameOfUse = (useId: unknown) => {
    const u = codes.find((c) => c.id === useId);
    return u ? (u.tier === "T1" ? `${u.name} (office)` : String(u.name)) : "";
  };
  const accountOf = (typeId: string) => accounts.find((a) => a.id === typeById(typeId)?.account_id);
  const labelOf = (item: LineDraft) => item.label || String(typeById(item.expense_type_id)?.label ?? "");
  const amount = (item: LineDraft) => Math.round((Number(item.qty) || 0) * (Number(item.unit_cost) || 0) * 100) / 100;
  const total = items.reduce((s, i) => s + amount(i), 0);
  const setItem = (n: number, patch: Partial<LineDraft>) => setItems((list) => list.map((x, i) => (i === n ? { ...x, ...patch } : x)));
  const set = <K extends keyof DraftHeader>(k: K, v: DraftHeader[K]) => setHeader((h) => ({ ...h, [k]: v }));

  async function save(send: boolean) {
    setBusy(true);
    const person = toPerson
      ? { to_person: true, recipient_category_id: header.recipient_category_id, patient_id: category?.kind === "patient" && readsPatients ? header.patient_id : null, recipient_name: header.recipient_name }
      : { to_person: false, recipient_category_id: null, patient_id: null, recipient_name: null };
    const saved = await saveVoucher(voucher?.id ?? null, { ...header, ...person, t2_id: fundId, payee_id: header.kind === "supplier" && !toPerson ? header.payee_id : null }, items.map((i) => ({ description: i.description, qty: Number(i.qty) || 0, unit_cost: Number(i.unit_cost), or_number: i.or_number, expense_type_id: i.expense_type_id })));
    if (!saved.ok) {
      setBusy(false);
      return void toast.error(saved.error);
    }
    if (send) {
      const sent = await actOnVoucher(saved.value, "submit");
      setBusy(false);
      if (!sent.ok) {
        toast.error(sent.error);
        return void router.push(`/requests/${saved.value}`);
      }
      toast.success(sent.value === "endorsed" ? "Sent to Finance" : "Sent for endorsement");
    } else {
      setBusy(false);
      toast.success("Draft saved");
    }
    router.push(`/requests/${saved.value}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionCard title="The request">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field className="sm:col-span-2">
            <FieldLabel>What kind of request?</FieldLabel>
            {header.kind === "liquidation" ? (
              <FieldDescription>Liquidation of an advance: list what was really spent, with the OR numbers. What is left is returned; an overspend is reimbursed.</FieldDescription>
            ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {REQUESTABLE.map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={header.kind === k}
                  onClick={() => set("kind", k)}
                  className="rounded-xl border border-border px-3 py-2.5 text-left text-theme-sm transition-colors hover:bg-muted/40 aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-primary"
                >
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
            )}
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="req-purpose">What is it for?</FieldLabel>
            <Textarea id="req-purpose" rows={2} maxLength={500} value={header.purpose} onChange={(e) => set("purpose", e.target.value)} placeholder="e.g. Diesel for the NCH runs this week" />
          </Field>
          {header.kind === "supplier" || header.kind === "petty_cash" ? (
            <Field className="sm:col-span-2">
              <label className="flex items-center gap-2 text-theme-sm font-medium">
                <Switch checked={header.to_person} onCheckedChange={(v) => set("to_person", v)} />
                Payment goes to a person (a patient&apos;s family, a service provider...)
              </label>
            </Field>
          ) : null}
          {toPerson ? (
            <>
              <Field>
                <FieldLabel htmlFor="req-category">Who is the person?</FieldLabel>
                <Select value={header.recipient_category_id ?? ""} onValueChange={(v) => setHeader((h) => ({ ...h, recipient_category_id: v, patient_id: null }))}>
                  <SelectTrigger id="req-category" className="w-full"><SelectValue placeholder="Pick a category" /></SelectTrigger>
                  <SelectContent>
                    {categories.filter((c) => c.active !== false).map((c) => (
                      <SelectItem key={String(c.id)} value={String(c.id)}>{String(c.name)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {category?.kind === "patient" && readsPatients ? (
                <Field>
                  <FieldLabel htmlFor="req-patient">Patient</FieldLabel>
                  <PatientPick value={header.patient_id} onChange={(v) => setHeader((h) => ({ ...h, patient_id: v, recipient_name: null }))} />
                </Field>
              ) : null}
              <Field>
                <FieldLabel htmlFor="req-person">Name of the person paid</FieldLabel>
                <Input id="req-person" maxLength={160} value={header.recipient_name ?? ""} onChange={(e) => set("recipient_name", e.target.value)} placeholder={header.patient_id ? "Leave empty to use the patient's name" : "Full name"} />
                <FieldDescription>Seen by you, Finance and the signers only.</FieldDescription>
              </Field>
            </>
          ) : null}
          {header.kind === "supplier" && !toPerson ? (
            <Field>
              <FieldLabel htmlFor="req-payee">Supplier to pay</FieldLabel>
              <Select value={header.payee_id ?? ""} onValueChange={(v) => set("payee_id", v)}>
                <SelectTrigger id="req-payee" className="w-full"><SelectValue placeholder="Pick the supplier" /></SelectTrigger>
                <SelectContent>
                  {payees.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>Not listed? Ask Finance to add the supplier.</FieldDescription>
            </Field>
          ) : null}
          <Field>
            <FieldLabel htmlFor="req-fund">Which fund pays?</FieldLabel>
            <Select value={fundId} onValueChange={(v) => set("t2_id", v)}>
              <SelectTrigger id="req-fund" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {funds.map((f) => (
                  <SelectItem key={String(f.id)} value={String(f.id)}>{String(f.name)}{f.restricted ? " (restricted)" : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>Finance can change it.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="req-pay">How should it be paid?</FieldLabel>
            <Select value={header.pay_method} onValueChange={(v) => set("pay_method", v as DraftHeader["pay_method"])}>
              <SelectTrigger id="req-pay" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(PAY_LABEL).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="req-needed">Needed by</FieldLabel>
            <Input id="req-needed" type="date" min={todayIso()} value={header.needed_by ?? ""} onChange={(e) => set("needed_by", e.target.value || null)} />
          </Field>
          <Field className="sm:col-span-2">
            <label className="flex items-center gap-2 text-theme-sm font-medium">
              <Switch checked={header.urgent} onCheckedChange={(v) => set("urgent", v)} />
              Urgent: it can&apos;t wait for the weekly approval
            </label>
            {header.urgent ? <Input aria-label="Why it is urgent" maxLength={300} value={header.urgent_reason ?? ""} onChange={(e) => set("urgent_reason", e.target.value)} placeholder="Why it can't wait" /> : null}
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="Items" description="One line per thing paid for. The receipts and quotations are added once the request is saved." actions={<span className="text-theme-sm font-medium tabular-nums">Total {formatCurrency(total, "PHP", true)}</span>}>
        <div className="flex flex-col gap-3">
          {items.map((item, n) => {
            const label = labelOf(item);
            const uses = label ? usesOf(label) : [];
            const account = item.expense_type_id ? accountOf(item.expense_type_id) : undefined;
            const blocked = fund?.restricted && account && !fundAllows((fund.account_prefixes as string[]) ?? [], String(account.code ?? ""));
            return (
              <div key={n} className="grid gap-3 rounded-xl border border-border p-3 sm:grid-cols-12">
                <Field className="sm:col-span-4">
                  <FieldLabel>What is it?</FieldLabel>
                  <Select
                    value={label}
                    onValueChange={(v) => {
                      const only = usesOf(v);
                      setItem(n, { label: v, expense_type_id: only.length === 1 ? String(only[0].id) : "" });
                    }}
                  >
                    <SelectTrigger className="w-full" aria-label={`Item ${n + 1}: what it is`}><SelectValue placeholder="Pick an expense type" /></SelectTrigger>
                    <SelectContent>
                      {labels.map((l) => (
                        <SelectItem key={l} value={l}>{l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field className="sm:col-span-4">
                  <FieldLabel>Who or what does it serve?</FieldLabel>
                  <Select value={item.expense_type_id} onValueChange={(v) => setItem(n, { expense_type_id: v })} disabled={uses.length === 0}>
                    <SelectTrigger className="w-full" aria-label={`Item ${n + 1}: what it serves`}><SelectValue placeholder={label ? "Pick one" : "Pick the type first"} /></SelectTrigger>
                    <SelectContent>
                      {uses.map((t) => (
                        <SelectItem key={String(t.id)} value={String(t.id)}>{nameOfUse(t.use_id)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field className="sm:col-span-4">
                  <FieldLabel>Description</FieldLabel>
                  <Input maxLength={300} value={item.description} onChange={(e) => setItem(n, { description: e.target.value })} placeholder="e.g. 20 L diesel" />
                </Field>
                <Field className="sm:col-span-2">
                  <FieldLabel>Qty</FieldLabel>
                  <Input type="number" inputMode="decimal" min={0} value={item.qty} onChange={(e) => setItem(n, { qty: e.target.value })} />
                </Field>
                <Field className="sm:col-span-3">
                  <FieldLabel>Unit cost (₱)</FieldLabel>
                  <Input type="number" inputMode="decimal" min={0} value={item.unit_cost} onChange={(e) => setItem(n, { unit_cost: e.target.value })} />
                </Field>
                <Field className="sm:col-span-3">
                  <FieldLabel>OR / invoice no.</FieldLabel>
                  <Input maxLength={60} value={item.or_number} onChange={(e) => setItem(n, { or_number: e.target.value })} placeholder="If there is one" />
                </Field>
                <div className="flex items-end justify-between gap-2 sm:col-span-4">
                  <div className="text-theme-xs text-muted-foreground">
                    {account ? <>Account {String(account.code)} · {String(account.name)}</> : "The account follows the type."}
                    <p className="text-theme-sm font-medium tabular-nums text-foreground">{formatCurrency(amount(item), "PHP", true)}</p>
                  </div>
                  {items.length > 1 ? (
                    <Button type="button" size="sm" variant="ghost" className="text-destructive" aria-label={`Remove item ${n + 1}`} onClick={() => setItems((list) => list.filter((_, i) => i !== n))}>
                      <Trash2 />
                    </Button>
                  ) : null}
                </div>
                {blocked ? (
                  <p className="flex items-center gap-2 text-theme-xs text-warning-foreground sm:col-span-12">
                    <AlertTriangle className="size-4 text-warning" /> {String(fund?.name)} is restricted and may not pay for account {String(account?.code)}. Pick another fund, or Finance will.
                  </p>
                ) : null}
              </div>
            );
          })}
          {items.length < 50 ? (
            <Button type="button" variant="outline" className="w-fit" onClick={() => setItems((list) => [...list, blankLine()])}>
              <Plus /> Add item
            </Button>
          ) : null}
        </div>
      </SectionCard>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {checklist && !checklist.ready ? <p className="mr-auto text-theme-xs text-muted-foreground">Requests can be sent once Finance has finished Financial Settings; a draft can be saved now.</p> : null}
        <Button variant="outline" disabled={busy} onClick={() => void save(false)}>Save draft</Button>
        <Button disabled={busy || !checklist?.ready} onClick={() => void save(true)}>
          <Send /> {busy ? "Sending…" : "Send for approval"}
        </Button>
      </div>
    </div>
  );
}
